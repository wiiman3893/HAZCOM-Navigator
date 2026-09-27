// Test-only pipe bridge: actual authoring/backup services call the native session
// implementation against disposable SQLite/files. No Firebase or user data.
import assert from 'node:assert/strict';
import {createInterface} from 'node:readline';
import {authoringService} from '../../../packages/authoring/src/index.js';
import {exportCompanyBackup,prepareNativeCompanyRestore} from '../../../packages/sync/src/backup.js';
import {buildPublication} from '../../../packages/sync/src/projection.js';
const lines=createInterface({input:process.stdin})[Symbol.asyncIterator]();
async function request(value){process.stdout.write(JSON.stringify(value)+'\n');const response=JSON.parse((await lines.next()).value);if(response.error)throw Error(response.error);return response.value;}
const companyId='roundtrip-company';
async function open(id){
 const lease=await request({op:'activate',id}),token=lease.token;
 const sql={select:(statement,values=[])=>request({op:'select',token,statement,values}),batch:statements=>request({op:'batch',token,statements})};
 const files={stage:(company,id,bytes)=>request({op:'stage',token,company,id,bytes:[...bytes]}),stageImport:(company,id,bytes)=>request({op:'stage',token,company,id,bytes:[...bytes],import:true}),read:async path=>new Uint8Array(await request({op:'read',token,path}))};
 const service=authoringService({sql,files,companyId,authorize:async()=>({companyId,role:'manager',active:true}),today:()=> '2026-09-27'});
 return {sql,files,service,backup:()=>exportCompanyBackup(sql,files,companyId),projection:()=>buildPublication(sql,companyId,files)};
}
const pdf=new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF');
try{
 let primary=await open('primary');
 await primary.sql.batch([{statement:'INSERT INTO company(id,name,contact_email) VALUES (?,?,?)',values:[companyId,'Native round trip','qa@example.test']}]);
 const s=primary.service;
 await s.create('work_area',{name:'Mixing',location:'Building A'},'area');
 await s.create('chemical_product',{product_name:'Synthetic cleaner',manufacturer:'Test',sds_date:'2026-09-01'},'product');
 await s.importSds('product',pdf,'same.pdf','sds-original');
 await s.create('worker',{name:'Synthetic Worker'},'worker');
 await s.create('work_area_product',{work_area_id:'area',chemical_product_id:'product',quantity:'1 bottle',storage_location:'Cabinet',added_date:'2026-09-01'},'placement');
 await s.create('work_area_assignment',{work_area_id:'area',worker_id:'worker',assigned_date:'2026-09-01'},'assignment');
 await s.create('training_event',{work_area_assignment_id:'assignment',training_date:'2026-09-02'},'training');
 await s.create('sds_verification',{chemical_product_id:'product',verified_at:'2026-09-02'},'verification');
 await s.create('hazcom_review',{work_area_id:'area',review_date:'2026-09-02'},'review');
 const original=await primary.backup();
 await request({op:'restore',id:'copy-a',plan:await prepareNativeCompanyRestore(original)});
 let a=await open('restored-copy-a');
 await assert.rejects(primary.service.snapshot(),/STALE/);
 await a.service.update('work_area','area',{name:'Edited restore A',location:'Building B'});
 await a.service.trash('work_area_product','placement');
 assert.ok((await a.service.snapshot()).work_area_product[0].deleted_at);
 await a.service.trash('work_area_product','placement',true);
 await a.service.importSds('product',new Uint8Array([...pdf,10]),'same.pdf','sds-added');
 await a.service.importSdsBatch(pdf,'bulk.pdf','bulk-a');
 assert.equal((await a.service.snapshot()).sds_import_session.length,1);
 await request({op:'close'});
 a=await open('restored-copy-a');
 assert.equal((await a.service.snapshot()).sds_import_session.length,1);
 const edited=await a.backup(),projection=await a.projection();
 assert.equal(edited.attachments.length,2);
 assert.equal(projection.dataset.trainingEvents.length,1);
 assert.equal(projection.dataset.workAreas[0].name,'Edited restore A');
 await request({op:'restore',id:'copy-b',plan:await prepareNativeCompanyRestore(edited)});
 let b=await open('restored-copy-b');
 const copied=await b.backup();
 assert.deepEqual(copied.tables,edited.tables);
 assert.deepEqual(copied.attachments,edited.attachments);
 assert.deepEqual((await b.projection()).dataset,projection.dataset);
 // Backup v2 covers committed authoring/SDS, not unfinished Bulk review sessions.
 assert.equal((await b.service.snapshot()).sds_import_session.length,0);
 await b.service.update('worker','worker',{name:'Only B'});
 a=await open('restored-copy-a');
 assert.equal((await a.service.snapshot()).worker[0].name,'Synthetic Worker');
 assert.deepEqual((await a.backup()).tables,edited.tables);
 primary=await open('primary');
 assert.deepEqual((await primary.backup()).tables,original.tables);
 assert.deepEqual((await primary.backup()).attachments,original.attachments);
 // Coordinate real mutations at known export read boundaries, without sleeps.
 b=await open('restored-copy-b');
 let changed=false;
 await assert.rejects(exportCompanyBackup({select:async(statement,values)=>{
  const rows=await b.sql.select(statement,values);
  if(!changed&&statement.startsWith('SELECT * FROM work_area ')){changed=true;await b.service.update('worker','worker',{name:'Changed during row export'});}
  return rows;
 }},b.files,companyId),/changed during backup/);
 for(const mutate of [
  ()=>b.service.importSds('product',new Uint8Array([...pdf,10,10]),'replacement.pdf','sds-race'),
  async()=>{await b.service.trash('work_area_product','placement');await b.service.trash('work_area_product','placement',true);}
 ]){
  changed=false;
  await assert.rejects(exportCompanyBackup(b.sql,{read:async path=>{const bytes=await b.files.read(path);if(!changed){changed=true;await mutate();}return bytes;}},companyId),/changed during backup/);
 }
 await prepareNativeCompanyRestore(await b.backup()); // Retry produces a valid coherent package.
 changed=false;
 await assert.rejects(exportCompanyBackup({select:async(statement,values)=>{const rows=await b.sql.select(statement,values);if(!changed){changed=true;await request({op:'close'});}return rows;}},b.files,companyId),/STALE/);
 primary=await open('primary');assert.deepEqual((await primary.backup()).tables,original.tables);
 await request({op:'close'});
 console.error('PASS native authoring, SDS, events, trash/restore, Bulk restart, A/B isolation and backup v2 round trip');
 process.exit(0);
}catch(error){console.error(error);process.exit(1);}
