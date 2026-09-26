import {RELATIONSHIP_IDS,verificationDue,nextReviewDue,trainingStatus,latestDate,findPermission,mayCreateWithinLimit} from '@hazcom/core';
import {analyzeSdsPdf,splitDrafts,mergeDrafts,normalizeDrafts} from './pdf-import.js';
export {analyzeSdsPdf,splitDrafts,mergeDrafts,normalizeDrafts} from './pdf-import.js';

export const fields={
 work_area:['name','location','poc_name','poc_email','poc_phone_number','description'],
 chemical_product:['product_name','chemical_names','cas_numbers','manufacturer','sds_date'],
 worker:['name','email','phone'],
 work_area_product:['quantity','storage_location','added_date'],
 work_area_assignment:['assigned_date','ended_date'],
 sds_verification:['verified_at'],hazcom_review:['review_date'],training_event:['training_date']
};
const config={
 work_area:['company','companyWorkArea'],chemical_product:['company','companyChemicalProduct'],worker:['company','companyWorker'],
 work_area_product:['work_area','workAreaWorkAreaProduct','chemical_product','rel_chemical_product_work_area_product_9d42d6cd'],
 work_area_assignment:['work_area','workAreaAssignment','worker','rel_worker_work_area_assignment_d30ac2b9'],
 sds_verification:['chemical_product','chemicalProductSdsVerification'],hazcom_review:['work_area','workAreaHazcomReview'],training_event:['work_area_assignment','assignmentTrainingEvent']
};
const events=['sds_verification','hazcom_review','training_event'];
const need=(value,message)=>{if(!value)throw Error(message);};
export const stableId=value=>{need(typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value),'Invalid stable ID');return value;};
export const localDate=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const dateOnly=value=>{need(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value,'Use a valid date (YYYY-MM-DD)');return value;};
export function validate(kind,input){
 need(fields[kind],'Unknown authoring record');const row={};
 for(const key of fields[kind]){
  let v=input[key];const optional=['chemical_names','cas_numbers','email','phone','ended_date'].includes(key);
  if(v==null||String(v).trim()===''){if(optional){row[key]=null;continue;}need(!['name','product_name','manufacturer','sds_date','assigned_date','quantity','storage_location','added_date','verified_at','review_date','training_date'].includes(key),`${key.replaceAll('_',' ')} is required`);v='';}
  need(typeof v==='string',`Invalid ${key}`);v=v.trim();need(v.length<=(key==='description'?8000:1000),`${key} is too long`);
  if(key.endsWith('_date')||key==='verified_at')dateOnly(v);
  if(key.includes('email')&&v)need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),'Enter a valid email address');
  if(key==='cas_numbers'&&v)need(v.split(/[;,\n]+/).every(n=>/^\d{2,7}-\d{2}-\d$/.test(n.trim())),'Use CAS numbers such as 67-64-1, separated by commas');
  row[key]=v;
 }
 if(kind==='work_area_assignment'&&row.ended_date)need(row.ended_date>=row.assigned_date,'End date must not precede assignment');
 return row;
}
const statement=(sql,values=[])=>({statement:sql,values});
const insert=(table,row)=>statement(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`,Object.values(row));
const joins=kind=>{const [parent,,link,linkTable]=config[kind];return `JOIN ${kind}__ownership o ON o.child_id=e.id ${link?`JOIN ${linkTable} l ON l.${kind}_id=e.id`:''}`;};
function scope(kind,alias='o'){
 const parent=config[kind][0];
 if(parent==='company')return `${alias}.company_id=?`;
 if(parent==='work_area_assignment')return `${alias}.work_area_assignment_id IN (SELECT a.child_id FROM work_area_assignment__ownership a JOIN work_area__ownership w ON w.child_id=a.work_area_id WHERE w.company_id=?)`;
 return `${alias}.${parent}_id IN (SELECT child_id FROM ${parent}__ownership WHERE company_id=?)`;
}
export function dueState(due,today){if(!due)return 'required';if(due<=today)return 'overdue';const soon=new Date(`${today}T00:00:00Z`);soon.setUTCDate(soon.getUTCDate()+30);return due<=soon.toISOString().slice(0,10)?'approaching':'current';}
export function decorate(data,today){
 const grouped=(kind,key)=>{const map=new Map();for(const r of data[kind]){const rows=map.get(r[key])??[];rows.push(r);map.set(r[key],rows);}return map;};
 const verifications=grouped('sds_verification','chemical_product_id'),reviews=grouped('hazcom_review','work_area_id'),training=grouped('training_event','work_area_assignment_id');
 for(const r of data.chemical_product){const dates=(verifications.get(r.id)??[]).map(e=>e.verified_at);r.latest=latestDate(dates);r.due=verificationDue(dates);r.status=dueState(r.due,today);r.hasSds=data.attachments.some(a=>a.owner_id===r.id&&a.slot_key==='sds');}
 for(const r of data.work_area){const dates=(reviews.get(r.id)??[]).map(e=>e.review_date);r.latest=latestDate(dates);r.due=nextReviewDue(dates);r.status=dueState(r.due,today);}
 const activeAreas=new Set(data.work_area.filter(r=>!r.deleted_at).map(r=>r.id)),activeWorkers=new Set(data.worker.filter(r=>!r.deleted_at).map(r=>r.id));
 for(const r of data.work_area_assignment){const dates=(training.get(r.id)??[]).map(e=>e.training_date);r.latest=latestDate(dates);r.active=!r.deleted_at&&(!r.ended_date||r.ended_date>today)&&r.assigned_date<=today&&activeAreas.has(r.work_area_id)&&activeWorkers.has(r.worker_id);r.status=trainingStatus(r.training_required_since,dates)==='current'?'current':r.training_required_since<today?'overdue':'required';}
 return data;
}
export function filterRows(kind,rows,filter={}){
 const q=(filter.query??'').trim().toLowerCase();
 return rows.filter(r=>Boolean(r.deleted_at)===Boolean(filter.trash)&&(!q||fields[kind].some(k=>String(r[k]??'').toLowerCase().includes(q)))&&(!filter.status||r.status===filter.status||(filter.status==='needs-training'&&r.status!=='current')||(filter.status==='missing-sds'&&!r.hasSds))&&(!filter.manufacturer||r.manufacturer===filter.manufacturer)&&(!filter.workAreaId||r.work_area_id===filter.workAreaId)&&(!filter.workerId||r.worker_id===filter.workerId)&&(!filter.assignmentState||(filter.assignmentState==='active'?r.active:!r.active))).sort((a,b)=>{const x=String(a.name??a.product_name??a.assigned_date??a.id).toLowerCase(),y=String(b.name??b.product_name??b.assigned_date??b.id).toLowerCase();return x<y?-1:x>y?1:a.id<b.id?-1:1;});
}
export function summary(data){const active=k=>data[k].filter(r=>!r.deleted_at),a=active('work_area'),c=active('chemical_product'),assign=data.work_area_assignment.filter(r=>r.active);return {areas:a.length,chemicals:c.length,workers:active('worker').length,assignments:assign.length,sdsOverdue:c.filter(r=>r.status==='overdue').length,sdsApproaching:c.filter(r=>r.status==='approaching').length,sdsRequired:c.filter(r=>r.status==='required').length,reviewsOverdue:a.filter(r=>r.status==='overdue').length,reviewsApproaching:a.filter(r=>r.status==='approaching').length,reviewsRequired:a.filter(r=>r.status==='required').length,training:assign.filter(r=>r.status!=='current').length,missingSds:c.filter(r=>!r.hasSds).length};}

/** All operations require live authority for the captured active Company. sql.batch must be atomic. */
export function authoringService({sql,companyId,authorize,files,today=localDate}){
 stableId(companyId);let tail=Promise.resolve();
 const locked=fn=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;};
 const check=async(kind='work_area',verb='read')=>{const a=await authorize();need(a.companyId===companyId&&a.active&&['manager','administrator'].includes(a.role)&&findPermission(a.role,verb,kind),'Active Company authoring permission required');return a;};
 const list=async kind=>{const [parent,,link]=config[kind];return sql.select(`SELECT e.*,o.${parent}_id${link?`,l.${link}_id`:''} FROM ${kind} e ${joins(kind)} WHERE ${scope(kind)} ORDER BY e.id`,[companyId]);};
 const creationLimit=async(kind,authority)=>{
  const key={work_area:'maxWorkAreasPerCompany',chemical_product:'maxChemicalProductsPerCompany',worker:'maxWorkersPerCompany'}[kind];
  if(!key||!authority.capabilities)return;
  const limit=authority.capabilities[key];
  need(limit===null||(Number.isInteger(limit)&&limit>=0),'Invalid commercial limit');
  const active=(await list(kind)).filter(row=>!row.deleted_at).length;
  need(mayCreateWithinLimit(limit,active),`${kind.replaceAll('_',' ')} limit reached for this Company`);
 };
 const get=async(kind,id,active=true)=>{stableId(id);need(config[kind],'Unknown record');const [parent,,link]=config[kind];const rows=await sql.select(`SELECT e.*,o.${parent}_id${link?`,l.${link}_id`:''} FROM ${kind} e ${joins(kind)} WHERE ${scope(kind)} AND e.id=?`,[companyId,id]);need(rows.length===1&&(!active||!rows[0].deleted_at),'Record not available in this Company');return rows[0];};
 const version=async()=>{await sql.batch([statement('INSERT OR IGNORE INTO authoring_versions(company_id) VALUES (?)',[companyId])]);return (await sql.select('SELECT version FROM authoring_versions WHERE company_id=?',[companyId]))[0].version;};
 const commit=async(v,kind,id,action,changes,statements)=>{
  await check(kind,action==='create'?'create':action==='delete'?'delete':'update');
  await sql.batch([statement('INSERT INTO authoring_guard SELECT CASE WHEN (SELECT version FROM authoring_versions WHERE company_id=?)=? THEN 1 ELSE 0 END',[companyId,v]),...statements,insert('dm_change_history',{id:crypto.randomUUID(),record_type:kind,record_id:id,changed_at:new Date().toISOString(),action,changes_json:JSON.stringify({companyId,...changes})}),statement('UPDATE authoring_versions SET version=version+1 WHERE company_id=?',[companyId]),statement('DELETE FROM authoring_guard')]);
 };
 async function relations(kind,input){const [parent,,link]=config[kind];if(parent!=='company')await get(parent,input[`${parent}_id`]);if(link)await get(link,input[`${link}_id`]);}
 async function conflict(kind,input,id){if(!['work_area_product','work_area_assignment'].includes(kind))return;const [,,link]=config[kind];const rows=await list(kind);need(!rows.some(r=>r.id!==id&&!r.deleted_at&&r.work_area_id===input.work_area_id&&r[`${link}_id`]===input[`${link}_id`]&&(kind!=='work_area_assignment'||!r.ended_date||r.ended_date>today())),'An active relationship already exists; edit or restore it instead');}
 const trigger=(area,date)=>statement(`UPDATE work_area_assignment SET training_required_since=? WHERE deleted_at IS NULL AND (ended_date IS NULL OR ended_date>?) AND id IN (SELECT child_id FROM work_area_assignment__ownership WHERE work_area_id=?)`,[date,today(),area]);
 const importSession=async id=>{stableId(id);const rows=await sql.select('SELECT * FROM sds_import_session WHERE id=? AND company_id=?',[id,companyId]);need(rows.length===1,'SDS import session not available in this Company');return rows[0];};
 const importDrafts=async sessionId=>(await sql.select('SELECT * FROM sds_import_draft WHERE session_id=? ORDER BY ordinal',[sessionId])).map(r=>({id:r.id,sessionId:r.session_id,ordinal:r.ordinal,startPage:r.start_page,endPage:r.end_page,confidence:r.confidence,reason:r.reason,detectedTitle:r.detected_title,status:r.status}));
 const rewriteDrafts=async(session,drafts)=>{
  const normalized=normalizeDrafts(Number(session.page_count),drafts);
  const statements=[statement('DELETE FROM sds_import_draft WHERE session_id=?',[session.id])];
  for(const d of normalized)statements.push(insert('sds_import_draft',{id:d.id,session_id:session.id,ordinal:d.ordinal,start_page:d.startPage,end_page:d.endPage,confidence:d.confidence,reason:d.reason,detected_title:d.detectedTitle??null,status:'review'}));
  await sql.batch(statements);return normalized;
 };
 const api={
  async snapshot(){return locked(async()=>{await check();const data={companyId};for(const kind of Object.keys(config))data[kind]=await list(kind);data.attachments=await sql.select("SELECT a.*,i.sha256 FROM dm_attachments a LEFT JOIN authoring_sds_integrity i ON i.attachment_id=a.id JOIN chemical_product__ownership o ON o.child_id=a.owner_id WHERE a.owner_type='chemical_product' AND o.company_id=? ORDER BY a.created_at DESC,a.id",[companyId]);data.activity=await sql.select("SELECT * FROM dm_change_history WHERE json_extract(changes_json,'$.companyId')=? ORDER BY changed_at DESC,id DESC LIMIT 20",[companyId]);data.sds_import_session=await sql.select('SELECT * FROM sds_import_session WHERE company_id=? ORDER BY imported_at DESC,id DESC',[companyId]);data.sds_import_page=await sql.select('SELECT p.* FROM sds_import_page p JOIN sds_import_session s ON s.id=p.session_id WHERE s.company_id=? ORDER BY p.session_id,p.page_number',[companyId]);data.sds_import_draft=await sql.select('SELECT d.* FROM sds_import_draft d JOIN sds_import_session s ON s.id=d.session_id WHERE s.company_id=? ORDER BY d.session_id,d.ordinal',[companyId]);await check();return decorate(data,today());});},
  async create(kind,input,id=crypto.randomUUID()){return locked(async()=>{const authority=await check(kind,'create');stableId(id);const row=validate(kind,input),v=await version();await relations(kind,input);await conflict(kind,input,id);
   const existing=await sql.select(`SELECT id FROM ${kind} WHERE id=?`,[id]);if(existing.length){const old=await get(kind,id,false);need(Object.entries(row).every(([k,val])=>old[k]===val)&&config[kind].filter((_,i)=>i===0||i===2).every(p=>p==='company'||old[`${p}_id`]===input[`${p}_id`]),'ID already belongs to different data');return id;}
   await creationLimit(kind,authority);
   if(events.includes(kind)){const d=row[fields[kind][0]];need(d<=today(),'Completion cannot be dated in the future');if(kind==='training_event'){const assignment=await get('work_area_assignment',input.work_area_assignment_id);need(d>=assignment.assigned_date&&(!assignment.ended_date||d<=assignment.ended_date),'Training date must fall within the assignment');}}
   if(kind==='work_area_assignment')row.training_required_since=row.assigned_date;
   const [parent,relation,link,table]=config[kind],statements=[insert(kind,{id,...row}),insert(`${kind}__ownership`,{id:crypto.randomUUID(),child_id:id,relationship_id:RELATIONSHIP_IDS[relation],[`${parent}_id`]:parent==='company'?companyId:input[`${parent}_id`]})];
   if(link)statements.push(insert(table,{id:crypto.randomUUID(),[`${kind}_id`]:id,[`${link}_id`]:input[`${link}_id`]}));
   if(kind==='work_area_product')statements.push(trigger(input.work_area_id,row.added_date));
   await commit(v,kind,id,'create',row,statements);return id;});},
  async update(kind,id,input){return locked(async()=>{await check(kind,'update');need(!events.includes(kind),'Historical events are append-only');const v=await version(),old=await get(kind,id),row=validate(kind,input);await relations(kind,old);
   if(kind==='work_area_product')need(row.added_date===old.added_date,'Added date is historical; remove and re-add the product');
   if(kind==='work_area_assignment'){need(row.assigned_date===old.assigned_date,'Assigned date is historical');if(row.ended_date){const history=await list('training_event');need(history.filter(e=>e.work_area_assignment_id===id).every(e=>e.training_date<=row.ended_date),'End date precedes recorded training');}await conflict(kind,{...old,...row},id);}
   await commit(v,kind,id,'update',{before:old,after:row},[statement(`UPDATE ${kind} SET ${Object.keys(row).map(k=>`${k}=?`).join(',')} WHERE id=?`,[...Object.values(row),id])]);});},
  async trash(kind,id,restore=false){return locked(async()=>{const authority=await check(kind,restore?'update':'delete');need(!events.includes(kind),'Historical events are append-only');const v=await version(),old=await get(kind,id,false);if(Boolean(old.deleted_at)!==restore)return; if(restore){await creationLimit(kind,authority);await relations(kind,old);await conflict(kind,old,id);}const statements=[statement(`UPDATE ${kind} SET deleted_at=? WHERE id=?`,[restore?null:new Date().toISOString(),id])];
   if(!restore){
    if(kind==='chemical_product')statements.push(statement("UPDATE work_area_product SET deleted_at=? WHERE deleted_at IS NULL AND id IN (SELECT work_area_product_id FROM rel_chemical_product_work_area_product_9d42d6cd WHERE chemical_product_id=?)",[new Date().toISOString(),id]));
    if(kind==='worker')statements.push(statement("UPDATE work_area_assignment SET deleted_at=? WHERE deleted_at IS NULL AND id IN (SELECT work_area_assignment_id FROM rel_worker_work_area_assignment_d30ac2b9 WHERE worker_id=?)",[new Date().toISOString(),id]));
    if(kind==='work_area')for(const child of ['work_area_product','work_area_assignment'])statements.push(statement(`UPDATE ${child} SET deleted_at=? WHERE deleted_at IS NULL AND id IN (SELECT child_id FROM ${child}__ownership WHERE work_area_id=?)`,[new Date().toISOString(),id]));
   }
   if(restore&&kind==='work_area_product')statements.push(trigger(old.work_area_id,today()));
   await commit(v,kind,id,restore?'restore':'delete',{before:old},statements);});},
  async importSds(productId,bytes,filename,id=crypto.randomUUID()){return locked(async()=>{await check('chemical_product','update');stableId(id);await get('chemical_product',productId);need(bytes instanceof Uint8Array&&bytes.length<=5*1024*1024&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-','Choose a PDF no larger than 5 MiB');const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');const v=await version();const prior=await sql.select('SELECT * FROM dm_attachments WHERE id=?',[id]);if(prior.length){need(prior[0].owner_id===productId&&prior[0].slot_key==='sds','Attachment ID conflict');const integrity=await sql.select('SELECT sha256 FROM authoring_sds_integrity WHERE attachment_id=?',[id]);need(integrity[0]?.sha256===sha256,'Attachment content changed');return id;}
   const relativePath=await files.stage(companyId,id,bytes);need(typeof relativePath==='string'&&!relativePath.includes('..')&&!relativePath.includes(':'),'Unsafe managed SDS path');
   await commit(v,'chemical_product',productId,'update',{sds:{id,sha256,sizeBytes:bytes.length,originalFilename:filename}},[statement("UPDATE dm_attachments SET slot_key='sds_history' WHERE owner_type='chemical_product' AND owner_id=? AND slot_key='sds'",[productId]),insert('dm_attachments',{id,owner_type:'chemical_product',owner_id:productId,slot_key:'sds',relative_path:relativePath,original_filename:String(filename).split(/[\\/]/).at(-1).slice(0,255),mime_type:'application/pdf',size_bytes:bytes.length,created_at:new Date().toISOString()}),insert('authoring_sds_integrity',{attachment_id:id,sha256})]);return id;});},
  async unlinkSds(productId){return locked(async()=>{await check('chemical_product','update');const v=await version();await get('chemical_product',productId);await commit(v,'chemical_product',productId,'update',{sds:'unlinked; retained in local history'},[statement("UPDATE dm_attachments SET slot_key='sds_history' WHERE owner_type='chemical_product' AND owner_id=? AND slot_key='sds'",[productId])]);});},
  async readSds(productId,attachmentId){return locked(async()=>{await check();await get('chemical_product',productId,false);const rows=await sql.select("SELECT a.*,i.sha256 FROM dm_attachments a LEFT JOIN authoring_sds_integrity i ON i.attachment_id=a.id WHERE a.id=? AND a.owner_type='chemical_product' AND a.owner_id=?",[stableId(attachmentId),productId]);need(rows.length===1,'SDS does not belong to this Product');const bytes=await files.read(rows[0].relative_path);need(bytes.length===rows[0].size_bytes,'Managed SDS size changed');if(rows[0].sha256){const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');need(sha===rows[0].sha256,'Managed SDS hash changed');}await check();return bytes;});},
  async importSdsBatch(bytes,filename,id=crypto.randomUUID()){return locked(async()=>{
   await check('chemical_product','create');stableId(id);need(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=250*1024*1024,'Choose a PDF no larger than 250 MiB');
   const cleanName=String(filename??'').split(/[\\/]/).at(-1).slice(0,255);need(cleanName.toLowerCase().endsWith('.pdf'),'Choose a PDF file');
   const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
   const prior=await sql.select('SELECT * FROM sds_import_session WHERE id=?',[id]);if(prior.length){need(prior[0].company_id===companyId&&prior[0].source_sha256===sha256&&Number(prior[0].source_size_bytes)===bytes.length,'Import session ID conflict');return id;}
   const analysis=await analyzeSdsPdf(bytes);const relativePath=await (files.stageImport??files.stage)(companyId,`import-${id}`,bytes);need(typeof relativePath==='string'&&!relativePath.includes('..')&&!relativePath.includes(':'),'Unsafe managed import path');
   const importedAt=new Date().toISOString(),statements=[insert('sds_import_session',{id,company_id:companyId,source_filename:cleanName,managed_source_path:relativePath,source_sha256:sha256,source_size_bytes:bytes.length,page_count:analysis.pageCount,imported_at:importedAt,status:'review'})];
   for(const p of analysis.pages)statements.push(insert('sds_import_page',{session_id:id,page_number:p.pageNumber,text_snippet:p.textSnippet,has_text:p.hasText?1:0,ocr_required:p.ocrRequired?1:0,signals_json:JSON.stringify(p.signals)}));
   for(const d of analysis.drafts)statements.push(insert('sds_import_draft',{id:d.id,session_id:id,ordinal:d.ordinal,start_page:d.startPage,end_page:d.endPage,confidence:d.confidence,reason:d.reason,detected_title:d.detectedTitle??null,status:'review'}));
   await sql.batch(statements);return id;
  });},
  async splitSdsImportDraft(sessionId,draftId,splitPage){return locked(async()=>{await check('chemical_product','create');const session=await importSession(sessionId),drafts=await importDrafts(sessionId);return rewriteDrafts(session,splitDrafts(Number(session.page_count),drafts,draftId,Number(splitPage)));});},
  async mergeSdsImportDraft(sessionId,draftId,direction){return locked(async()=>{await check('chemical_product','create');need(direction==='previous'||direction==='next','Invalid merge direction');const session=await importSession(sessionId),drafts=await importDrafts(sessionId);return rewriteDrafts(session,mergeDrafts(Number(session.page_count),drafts,draftId,direction));});},
  async saveSdsImportDrafts(sessionId){return locked(async()=>{await check('chemical_product','create');const session=await importSession(sessionId),drafts=await importDrafts(sessionId);normalizeDrafts(Number(session.page_count),drafts);await sql.batch([statement("UPDATE sds_import_session SET status='review_drafts_saved' WHERE id=? AND company_id=?",[sessionId,companyId])]);});}
 };
 return api;
}
