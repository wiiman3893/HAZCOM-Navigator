const entitySpec=[
 ['work_area','company'],['chemical_product','company'],['worker','company'],
 ['work_area_product','work_area'],['work_area_assignment','work_area'],
 ['sds_verification','chemical_product'],['hazcom_review','work_area'],['training_event','work_area_assignment']
];
const links=[['rel_chemical_product_work_area_product_9d42d6cd','work_area_product_id','work_area_product'],['rel_worker_work_area_assignment_d30ac2b9','work_area_assignment_id','work_area_assignment']];
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
const encodeBase64=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);};
const decodeBase64=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
const need=(condition,message)=>{if(!condition)throw Error(message);};
const placeholders=values=>values.map(()=>'?').join(',');
const ordered=rows=>rows.sort((a,b)=>String(a.id).localeCompare(String(b.id)));
const selectIds=async(sql,table,column,ids)=>ids.length?await sql.select(`SELECT * FROM ${table} WHERE ${column} IN (${placeholders(ids)}) ORDER BY ${table==='authoring_sds_integrity'?'attachment_id':'id'}`,ids):[];
const attachmentDescriptors=attachments=>attachments.map(({attachmentId,ownerId,sizeBytes,sha256})=>({attachmentId,ownerId,sizeBytes,sha256})).sort((a,b)=>a.attachmentId.localeCompare(b.attachmentId));
const expectedTables=['company',...entitySpec.flatMap(([kind])=>[kind,`${kind}__ownership`]),...links.map(([name])=>name),'dm_attachments','authoring_sds_integrity','dm_change_history','authoring_versions'];

function validateRelationships(tables,companyId){
 const ids={company:new Set([companyId])};
 for(const [kind,parent] of entitySpec){
  const entities=tables[kind],owners=tables[`${kind}__ownership`],entityIds=new Set(entities.map(row=>row.id));
  need(entityIds.size===entities.length&&entities.every(row=>validId(row.id))&&owners.length===entities.length,`Invalid ${kind} IDs or ownership count`);
  need(new Set(owners.map(row=>row.child_id)).size===owners.length&&owners.every(row=>entityIds.has(row.child_id)&&ids[parent].has(row[`${parent}_id`])),`Backup ${kind} crosses Company ownership`);
  ids[kind]=entityIds;
 }
 for(const [table,childColumn,child] of links){
  const parent=table.startsWith('rel_chemical_')?'chemical_product':'worker';
  const rows=tables[table];
  need(rows.length===ids[child].size&&new Set(rows.map(row=>row[childColumn])).size===rows.length&&rows.every(row=>ids[child].has(row[childColumn])&&ids[parent].has(row[`${parent}_id`])),`Backup ${table} relationship mismatch`);
 }
 need(tables.dm_attachments.every(row=>validId(row.id)&&row.owner_type==='chemical_product'&&ids.chemical_product.has(row.owner_id)&&Number.isSafeInteger(row.size_bytes)&&row.size_bytes>=0),'Backup SDS ownership mismatch');
 const attachmentIds=new Set(tables.dm_attachments.map(row=>row.id));
 need(attachmentIds.size===tables.dm_attachments.length,'Duplicate backup SDS ID');
 need(tables.authoring_sds_integrity.every(row=>attachmentIds.has(row.attachment_id)&&/^[a-f0-9]{64}$/.test(row.sha256)),'Backup SDS integrity metadata mismatch');
 need(tables.authoring_versions.every(row=>row.company_id===companyId),'Backup authoring version crosses Company');
 need(tables.dm_change_history.every(row=>{
  try{return JSON.parse(row.changes_json).companyId===companyId;}catch{return false;}
 }),'Backup history crosses Company');
}

/** Validate a portable package before any SQLite or managed-file mutation. */
export async function validateCompanyBackup(packageData){
 const {manifest,tables,attachments}=packageData??{};
 need(manifest?.format==='hazcom-company-backup'&&[1,2].includes(manifest.version)&&validId(manifest.companyId),'Unsupported backup manifest');
 need(tables&&typeof tables==='object'&&Array.isArray(attachments),'Malformed backup');
 need(Object.keys(tables).sort().join('|')===expectedTables.slice().sort().join('|')&&expectedTables.every(t=>Array.isArray(tables[t])),'Unsupported backup tables');
 need(await digest(new TextEncoder().encode(JSON.stringify(tables)))===manifest.recordHash,'Backup records hash changed');
 need(tables.company.length===1&&tables.company[0].id===manifest.companyId,'Backup Company mismatch');
 need(attachments.length===manifest.attachmentCount&&tables.dm_attachments.length===attachments.length,'Backup SDS count mismatch');
 if(manifest.version===2)need(await digest(new TextEncoder().encode(JSON.stringify(attachmentDescriptors(attachments))))===manifest.attachmentHash,'Backup SDS manifest changed');
 validateRelationships(tables,manifest.companyId);
 const rows=new Map(tables.dm_attachments.map(row=>[row.id,row]));
 const integrity=new Map(tables.authoring_sds_integrity.map(row=>[row.attachment_id,row.sha256]));
 for(const file of attachments){
  need(validId(file.attachmentId)&&validId(file.ownerId)&&Number.isSafeInteger(file.sizeBytes)&&file.sizeBytes>=0&&/^[a-f0-9]{64}$/.test(file.sha256)&&typeof file.base64==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64),'Invalid SDS payload');
  const row=rows.get(file.attachmentId);
  need(row&&row.owner_id===file.ownerId&&row.size_bytes===file.sizeBytes&&(!integrity.has(file.attachmentId)||integrity.get(file.attachmentId)===file.sha256),'Backup SDS ownership mismatch');
  const bytes=decodeBase64(file.base64);
  need(bytes.length===file.sizeBytes&&await digest(bytes)===file.sha256,'Backup SDS size or hash changed');
 }
 need(new Set(attachments.map(file=>file.attachmentId)).size===attachments.length,'Duplicate backup SDS payload');
 return {companyId:manifest.companyId,attachmentCount:attachments.length};
}

/** Node/dev adapter. Export is scoped by ownership, never by an unqualified table dump. */
export async function exportCompanyBackup(sql,files,companyId){
 need(validId(companyId),'Invalid Company ID');
 const companies=await sql.select('SELECT * FROM company WHERE id=?',[companyId]);need(companies.length===1,'Company missing');
 const tables={company:companies},ids={company:[companyId]};
 for(const [kind,parent] of entitySpec){
  const owners=await selectIds(sql,`${kind}__ownership`,`${parent}_id`,ids[parent]);
  const entities=await selectIds(sql,kind,'id',owners.map(r=>r.child_id));
  need(entities.length===owners.length,`Missing ${kind} ownership target`);
  tables[kind]=entities;tables[`${kind}__ownership`]=owners;ids[kind]=entities.map(r=>r.id);
 }
 for(const [table,column,parent] of links)tables[table]=await selectIds(sql,table,column,ids[parent]);
 tables.dm_attachments=await selectIds(sql,'dm_attachments','owner_id',ids.chemical_product);
 need(tables.dm_attachments.every(a=>a.owner_type==='chemical_product'),'Foreign attachment ownership');
 tables.authoring_sds_integrity=await selectIds(sql,'authoring_sds_integrity','attachment_id',tables.dm_attachments.map(a=>a.id));
 tables.dm_change_history=ordered(await sql.select("SELECT * FROM dm_change_history WHERE json_extract(changes_json,'$.companyId')=? ORDER BY id",[companyId]));
 tables.authoring_versions=await sql.select('SELECT * FROM authoring_versions WHERE company_id=?',[companyId]);
 const integrity=new Map(tables.authoring_sds_integrity.map(r=>[r.attachment_id,r.sha256]));
 const attachments=[];
 for(const a of tables.dm_attachments){
  const bytes=await files.read(a.relative_path),sha256=await digest(bytes);
  need(bytes.length===a.size_bytes&&(!integrity.has(a.id)||integrity.get(a.id)===sha256),'Source SDS integrity failed');
  attachments.push({attachmentId:a.id,ownerId:a.owner_id,sizeBytes:bytes.length,sha256,base64:encodeBase64(bytes)});
 }
 const recordHash=await digest(new TextEncoder().encode(JSON.stringify(tables)));
 validateRelationships(tables,companyId);
 const attachmentHash=await digest(new TextEncoder().encode(JSON.stringify(attachmentDescriptors(attachments))));
 return {manifest:{format:'hazcom-company-backup',version:2,companyId,recordHash,attachmentHash,attachmentCount:attachments.length,createdAt:new Date().toISOString()},tables,attachments};
}

/** Import into a separate fresh database; caller switches to it only after this succeeds. */
export async function importCompanyBackup(packageData,sql,files){
 const {manifest,tables,attachments}=packageData??{};
 await validateCompanyBackup(packageData);
 const existing=await sql.select('SELECT id FROM company LIMIT 1');
 need(existing.length===0,'Restore destination must be a fresh SQLite workspace');
 const prepared=[];
 for(const file of attachments){
  const bytes=decodeBase64(file.base64);
  const row=tables.dm_attachments.find(a=>a.id===file.attachmentId);
  const localPath=await files.stage(manifest.companyId,file.attachmentId,bytes);
  prepared.push({...row,relative_path:localPath});
 }
 const statements=[];
 const append=(table,rows)=>{for(const row of rows){const keys=Object.keys(row);need(keys.length>0&&keys.every(k=>/^[a-z_]+$/i.test(k)),'Invalid backup column');statements.push({statement:`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`,values:keys.map(k=>row[k])});}};
 append('company',tables.company);
 for(const [kind] of entitySpec){append(kind,tables[kind]);append(`${kind}__ownership`,tables[`${kind}__ownership`]);}
 for(const [table] of links)append(table,tables[table]);
 append('dm_attachments',prepared);append('authoring_sds_integrity',tables.authoring_sds_integrity);
 append('dm_change_history',tables.dm_change_history);append('authoring_versions',tables.authoring_versions);
 await sql.batch(statements);
 return {companyId:manifest.companyId,recordCount:statements.length,attachmentCount:prepared.length};
}
