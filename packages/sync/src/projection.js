import {schemas,kinds,normalizeDataset,stableId,demand,sha256,digest,capacity,pdf} from './contract.js';

// One SELECT is a consistent SQLite snapshot, including when the driver uses a pool.
const roots={work_area:'workAreas',chemical_product:'chemicalProducts',worker:'workers',work_area_assignment:'workAreaAssignments'};
const selects=[];
for(const [kind,s] of Object.entries(schemas)) {
  const columns=['id',...s.fields,...s.optional??[]];
  const expressions=columns.map(f=>`'${f}',${f===s.parentField?`o.${s.parent}_id`:s.link?.[0]===f?`l.${s.link[2]}`:`e.${f}`}`).join(',');
  const join=s.link?`LEFT JOIN ${s.link[1]} l ON l.${s.table}_id=e.id`:'';
  const scope=s.parent==='company'?'o.company_id=$1':`o.${s.parent}_id IN (SELECT json_extract(value,'$.id') FROM json_each((SELECT data FROM ${roots[s.parent]})))`;
  selects.push(`${kind} AS (SELECT json_group_array(json_object(${expressions})) AS data FROM ${s.table} e JOIN ${s.table}__ownership o ON o.child_id=e.id ${join} WHERE e.deleted_at IS NULL AND ${scope})`);
}
const orphanCount=Object.values(schemas).map(s=>`(SELECT count(*) FROM ${s.table} e WHERE e.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM ${s.table}__ownership o WHERE o.child_id=e.id))`).join('+');
export const SNAPSHOT_SQL=`WITH ${selects.join(',')} SELECT json_object('orphans',${orphanCount},'foreignKeyErrors',(SELECT count(*) FROM pragma_foreign_key_check),'company',(SELECT json_object('id',id,'name',name,'contact_email',contact_email) FROM company WHERE id=$1 AND deleted_at IS NULL),'dataset',json_object(${kinds.map(k=>`'${k}',json((SELECT data FROM ${k}))`).join(',')}),'attachments',json((SELECT json_group_array(json_object('attachmentId',id,'ownerType',owner_type,'ownerId',owner_id,'slotKey',slot_key,'localPath',relative_path,'declaredSize',size_bytes)) FROM dm_attachments WHERE owner_type='chemical_product' AND owner_id IN (SELECT json_extract(value,'$.id') FROM json_each((SELECT data FROM chemicalProducts)))))) AS snapshot`;

export async function buildPublication(sql,companyId,files) {
  stableId(companyId);
  const start=performance.now();
  const result=await sql.select(SNAPSHOT_SQL,[companyId]);
  const snapshot=JSON.parse(result[0].snapshot), exportMs=performance.now()-start;
  demand(snapshot.orphans===0,'Unowned active records cannot be scoped; repair ownership');
  demand(snapshot.foreignKeyErrors===0,'Source SQLite foreign key violation');
  demand(snapshot.company?.id===companyId,'Active Company missing');
  demand(typeof snapshot.company.name==='string' && snapshot.company.name.trim() && snapshot.company.name.length<=200,'Invalid Company name');
  demand(typeof snapshot.company.contact_email==='string' && snapshot.company.contact_email.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(snapshot.company.contact_email),'Invalid Company email');
  const dataset=normalizeDataset(snapshot.dataset), attachments=[], owners=new Set();
  for(const raw of snapshot.attachments.sort((a,b)=>a.attachmentId<b.attachmentId?-1:1)) {
    if(raw.slotKey!=='sds') continue;
    stableId(raw.attachmentId); demand(!owners.has(raw.ownerId),'Multiple SDS attachments for Product'); owners.add(raw.ownerId);
    demand(dataset.chemicalProducts.some(p=>p.id===raw.ownerId),'SDS owner outside Company');
    const bytes=await files.read(raw.localPath); pdf(bytes);
    demand(raw.declaredSize==null || raw.declaredSize===bytes.length,'SDS declared size mismatch');
    attachments.push({attachmentId:raw.attachmentId,ownerType:'chemical_product',ownerId:raw.ownerId,slotKey:'sds',localPath:raw.localPath,sha256:await sha256(bytes),sizeBytes:bytes.length});
  }
  const logical={company:snapshot.company,dataset,attachments:attachments.map(({localPath,...a})=>a)};
  return {...logical,attachments,fingerprint:await digest(logical),metrics:{...capacity(dataset,attachments),exportMs,projectionMs:performance.now()-start}};
}
