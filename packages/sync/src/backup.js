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
 return {manifest:{format:'hazcom-company-backup',version:1,companyId,recordHash,attachmentCount:attachments.length,createdAt:new Date().toISOString()},tables,attachments};
}

/** Import into a separate fresh database; caller switches to it only after this succeeds. */
export async function importCompanyBackup(packageData,sql,files){
 const {manifest,tables,attachments}=packageData??{};
 need(manifest?.format==='hazcom-company-backup'&&manifest.version===1&&validId(manifest.companyId),'Unsupported backup manifest');
 need(tables&&typeof tables==='object'&&Array.isArray(attachments),'Malformed backup');
 const expected=['company',...entitySpec.flatMap(([kind])=>[kind,`${kind}__ownership`]),...links.map(([name])=>name),'dm_attachments','authoring_sds_integrity','dm_change_history','authoring_versions'];
 need(Object.keys(tables).sort().join('|')===expected.sort().join('|')&&expected.every(t=>Array.isArray(tables[t])),'Unsupported backup tables');
 need(await digest(new TextEncoder().encode(JSON.stringify(tables)))===manifest.recordHash,'Backup records hash changed');
 need(tables.company.length===1&&tables.company[0].id===manifest.companyId,'Backup Company mismatch');
 need(attachments.length===manifest.attachmentCount&&tables.dm_attachments.length===attachments.length,'Backup SDS count mismatch');
 const prepared=[];
 for(const file of attachments){
  need(validId(file.attachmentId)&&validId(file.ownerId)&&typeof file.base64==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64),'Invalid SDS payload');
  const bytes=decodeBase64(file.base64);
  need(bytes.length===file.sizeBytes&&await digest(bytes)===file.sha256,'Backup SDS size or hash changed');
  const row=tables.dm_attachments.find(a=>a.id===file.attachmentId);
  need(row&&row.owner_id===file.ownerId&&row.owner_type==='chemical_product'&&row.size_bytes===file.sizeBytes&&tables.chemical_product.some(p=>p.id===file.ownerId),'Backup SDS ownership mismatch');
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
