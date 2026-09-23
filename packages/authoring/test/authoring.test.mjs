import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {authoringService,summary,filterRows,validate,dateOnly,dueState} from '../src/index.js';
import {nodeSqlite,nodeFiles} from '../../sync/src/node.js';
import {REPLICA_SCHEMA_SQL} from '../../sync/src/sqlite.js';
import {buildPublication} from '../../sync/src/projection.js';
import {publicationPlan} from '../../sync/src/staged.js';
import {manifest,chunkRows,descriptor,hash} from '../../../firebase/functions/lib/staged-contract.js';
import {dummyPdf,fixture} from '../../sync/test/fixtures.mjs';
const migration=await readFile(new URL('../../../database/migrations/003_authoring.sql',import.meta.url),'utf8');
const area=n=>({name:`Area ${n}`,location:'Building 1',poc_name:'Safety lead',poc_email:'safety@example.test',poc_phone_number:'+1 (555) 123-4567',description:'Local fixture'});
const chemical=n=>({product_name:`Cleaner ${n}`,chemical_names:'Acetone',cas_numbers:'67-64-1',manufacturer:'Test manufacturer',sds_date:'2026-01-01'});
async function setup(){const folder=await mkdtemp(path.join(tmpdir(),'hazcom-authoring-'));const sql=nodeSqlite(path.join(folder,'author.db'),REPLICA_SCHEMA_SQL+migration),files=await nodeFiles(path.join(folder,'attachments'));sql.db.prepare('INSERT INTO company(id,name,contact_email) VALUES (?,?,?)').run('company-a','Authoring Company','safety@example.test');sql.db.prepare('INSERT INTO company(id,name,contact_email) VALUES (?,?,?)').run('company-b','Other Company','other@example.test');let active='company-a',role='manager';const create=c=>authoringService({sql,files,companyId:c,authorize:async()=>({companyId:active,role,active:true}),today:()=> '2026-09-22'});return {sql,files,service:create('company-a'),other:create('company-b'),switchTo(c){active=c;},role(r){role=r;}};}

test('Full authoring scenario: 3 areas, 10 Chemicals with SDS, 5 Workers, retraining, trash/restore and validated publication',async()=>{
 const f=await setup(),s=f.service;
 try{
  for(let i=0;i<3;i++)await s.create('work_area',area(i),`area-${i}`);
  for(let i=0;i<10;i++){await s.create('chemical_product',chemical(i),`chemical-${i}`);await s.importSds(`chemical-${i}`,dummyPdf(`Authoring ${i}`),`same filename.pdf`,`sds-${i}`);await s.create('work_area_product',{quantity:'2 bottles',storage_location:'Cabinet A',added_date:'2026-09-01',work_area_id:`area-${i%3}`,chemical_product_id:`chemical-${i}`},`placement-${i}`);await s.create('sds_verification',{chemical_product_id:`chemical-${i}`,verified_at:'2026-09-01'},`verification-${i}`);}
  for(let i=0;i<5;i++){await s.create('worker',{name:`Worker ${i}`,email:`worker${i}@example.test`,phone:null},`worker-${i}`);await s.create('work_area_assignment',{assigned_date:'2026-09-01',ended_date:null,work_area_id:`area-${i%3}`,worker_id:`worker-${i}`},`assignment-${i}`);await s.create('training_event',{work_area_assignment_id:`assignment-${i}`,training_date:'2026-09-02'},`training-${i}`);}
  for(let i=0;i<3;i++)await s.create('hazcom_review',{work_area_id:`area-${i}`,review_date:'2026-09-01'},`review-${i}`);
  assert.equal(summary(await s.snapshot()).training,0);
  await s.create('work_area_product',{quantity:'1 bottle',storage_location:'Cabinet B',added_date:'2026-09-20',work_area_id:'area-0',chemical_product_id:'chemical-1'},'new-placement');
  let snapshot=await s.snapshot();assert.equal(summary(snapshot).training,2);assert.equal(snapshot.work_area_assignment.find(r=>r.id==='assignment-0').training_required_since,'2026-09-20');
  for(const id of ['assignment-0','assignment-3'])await s.create('training_event',{work_area_assignment_id:id,training_date:'2026-09-22'},`retrain-${id}`);
  assert.equal(summary(await s.snapshot()).training,0);
  await s.trash('chemical_product','chemical-9');assert.equal(filterRows('chemical_product',(await s.snapshot()).chemical_product).length,9);
  await buildPublication(f.sql,'company-a',f.files); // No broken active references during deletion.
  await s.trash('chemical_product','chemical-9',true);await s.trash('work_area_product','placement-9',true);
  const projection=await buildPublication(f.sql,'company-a',f.files),plan=await publicationPlan(projection,'authoring-proof',null,'manager-uid');
  assert.equal(hash(manifest(plan.manifest,'manager-uid')),plan.manifestHash);
  for(const c of plan.chunks)assert.deepEqual(descriptor(c.descriptor.kind,c.descriptor.chunkId,chunkRows(c.descriptor.kind,c.rows)),c.descriptor);
  assert.equal(projection.dataset.chemicalProducts.length,10);assert.equal(projection.attachments.length,10);assert.equal(projection.dataset.workers.length,5);assert.equal(projection.dataset.trainingEvents.length,7);
  assert.equal(f.sql.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{f.sql.close();}
});

test('CRUD, trash isolation, duplicate submissions, append-only events, end dates and cross-Company/role guards',async()=>{
 const f=await setup(),s=f.service;
 try{
  for(const [kind,row,id] of [['work_area',area(0),'a'],['chemical_product',chemical(0),'c'],['worker',{name:'Worker',email:'worker@example.test',phone:'123'},'w']]){
   await Promise.all([s.create(kind,row,id),s.create(kind,row,id)]);assert.equal((await s.snapshot())[kind].length,1);
   const field=kind==='chemical_product'?'product_name':'name';await s.update(kind,id,{...row,[field]:'Edited'});assert.equal((await s.snapshot())[kind][0][field],'Edited');
   await s.trash(kind,id);assert.equal(filterRows(kind,(await s.snapshot())[kind]).length,0);assert.equal(filterRows(kind,(await s.snapshot())[kind],{trash:true}).length,1);await s.trash(kind,id,true);
  }
  await s.create('work_area_assignment',{assigned_date:'2026-01-01',ended_date:null,work_area_id:'a',worker_id:'w'},'as');
  assert.equal((await s.snapshot()).work_area_assignment[0].training_required_since,'2026-01-01');
  await s.create('training_event',{training_date:'2026-02-01',work_area_assignment_id:'as'},'te');
  assert.equal((await s.snapshot()).work_area_assignment[0].status,'current');
  await assert.rejects(s.update('training_event','te',{training_date:'2026-03-01'}));await assert.rejects(s.trash('training_event','te'));
  await assert.rejects(s.update('work_area_assignment','as',{assigned_date:'2026-01-01',ended_date:'2026-01-02'}),/training/);
  await s.update('work_area_assignment','as',{assigned_date:'2026-01-01',ended_date:'2026-02-02'});assert.equal((await s.snapshot()).work_area_assignment[0].active,false);assert.equal((await s.snapshot()).training_event.length,1);
  await s.create('sds_verification',{chemical_product_id:'c',verified_at:'2026-03-22'},'sv');await s.create('hazcom_review',{work_area_id:'a',review_date:'2025-09-22'},'hr');
  let d=await s.snapshot();assert.equal(d.chemical_product[0].due,'2026-09-22');assert.equal(d.chemical_product[0].status,'overdue');assert.equal(d.work_area[0].due,'2026-09-22');assert.equal(d.work_area[0].status,'overdue');
  for(const k of ['sds_verification','hazcom_review']){await assert.rejects(s.update(k,k==='hazcom_review'?'hr':'sv',{}));await assert.rejects(s.trash(k,k==='hazcom_review'?'hr':'sv'));}
  await assert.rejects(s.create('training_event',{training_date:'2027-01-01',work_area_assignment_id:'as'}),/future/);
  f.switchTo('company-b');await f.other.create('work_area',area('foreign'),'foreign');assert.equal((await f.other.snapshot()).work_area.length,1);await assert.rejects(f.other.update('work_area','a',area(3)),/Company/);await assert.rejects(s.snapshot(),/Company/);
  f.switchTo('company-a');await assert.rejects(s.create('work_area_product',{quantity:'1',storage_location:'A',added_date:'2026-01-01',work_area_id:'foreign',chemical_product_id:'c'}),/Company/);
  f.role('member');await assert.rejects(s.snapshot(),/permission/);await assert.rejects(s.create('worker',{name:'No'}),/permission/);
 }finally{f.sql.close();}
});

test('Managed SDS replacement, integrity, unlink, retry and rollback retain valid history',async()=>{
 const f=await setup(),s=f.service;
 try{
  await s.create('chemical_product',chemical(0),'c');const bytes=dummyPdf('Original');await s.importSds('c',bytes,'same.pdf','file-a');await s.importSds('c',bytes,'same.pdf','file-a');
  await assert.rejects(s.importSds('c',dummyPdf('Changed'),'same.pdf','file-a'),/changed/);await assert.rejects(s.importSds('c',new Uint8Array([1,2]),'fake.pdf'),/PDF/);
  await s.importSds('c',dummyPdf('Replacement'),'same.pdf','file-b');let d=await s.snapshot();assert.equal(d.attachments.filter(a=>a.slot_key==='sds').length,1);assert.equal(d.attachments.filter(a=>a.slot_key==='sds_history').length,1);assert.equal(d.attachments.find(a=>a.id==='file-a').sha256.length,64);
  assert.deepEqual(await s.readSds('c','file-a'),bytes);
  f.sql.beforeStatement=(i,st)=>{if(st.statement.startsWith('INSERT INTO dm_change_history'))throw Error('injected failure');};
  await assert.rejects(s.unlinkSds('c'),/injected/);f.sql.beforeStatement=null;assert.equal((await s.snapshot()).attachments.filter(a=>a.slot_key==='sds').length,1);
  await s.unlinkSds('c');assert.equal((await buildPublication(f.sql,'company-a',f.files)).attachments.length,0);assert.equal((await s.snapshot()).attachments.length,2);
  f.sql.beforeStatement=(i,st)=>{if(st.statement.startsWith('INSERT INTO work_area__ownership'))throw Error('partial create');};await assert.rejects(s.create('work_area',area(0),'rollback'),/partial/);f.sql.beforeStatement=null;assert.equal(f.sql.db.prepare("SELECT count(*) n FROM work_area WHERE id='rollback'").get().n,0);
 }finally{f.sql.close();}
});

test('Shared validation, due boundaries, deterministic filtering and restoration conflicts',async()=>{
 assert.throws(()=>dateOnly('2026-02-30'));assert.throws(()=>validate('worker',{name:'x',email:'invalid'}));assert.throws(()=>validate('chemical_product',{...chemical(0),cas_numbers:'invalid'}));assert.equal(dueState('2026-10-01','2026-09-22'),'approaching');assert.equal(dueState(null,'2026-09-22'),'required');
 const f=await setup(),s=f.service;try{await s.create('work_area',area(0),'a');await s.create('chemical_product',chemical(0),'c');const row={work_area_id:'a',chemical_product_id:'c',quantity:'1',storage_location:'Cabinet',added_date:'2026-09-01'};await s.create('work_area_product',row,'one');await s.trash('work_area_product','one');await s.create('work_area_product',row,'two');await assert.rejects(s.trash('work_area_product','one',true),/already exists/);const snapshot=await s.snapshot();assert.equal(filterRows('chemical_product',snapshot.chemical_product,{query:'67-64-1'}).length,1);assert.equal(filterRows('chemical_product',snapshot.chemical_product,{manufacturer:'unknown'}).length,0);assert.equal(filterRows('work_area',snapshot.work_area,{status:'required'}).length,1);}finally{f.sql.close();}
});

test('Small / Medium / Large authoring query, filter and edit measurements',async()=>{
 const measurements=[];
 for(const size of ['small','medium','large']){const f=await fixture(size,`authoring-${size}`);f.sql.db.exec(migration);const service=authoringService({sql:f.sql,files:f.files,companyId:f.company.id,authorize:async()=>({companyId:f.company.id,role:'manager',active:true}),today:()=> '2026-09-22'});try{const start=performance.now(),snapshot=await service.snapshot(),snapshotMs=performance.now()-start;const filterStart=performance.now();const rows=filterRows('chemical_product',snapshot.chemical_product,{query:'Cleaner 19'});const filterMs=performance.now()-filterStart;const editStart=performance.now();await service.update('chemical_product','product-0000',{...snapshot.chemical_product[0],manufacturer:'Updated test manufacturer'});measurements.push({size,records:Object.keys(fieldsForCount).reduce((n,k)=>n+snapshot[k].length,0),snapshotMs,filterMs,editMs:performance.now()-editStart,matched:rows.length});assert.equal((await service.snapshot()).chemical_product.find(r=>r.id==='product-0000').manufacturer,'Updated test manufacturer');}finally{f.sql.close();}}
 await writeFile(new URL('../../../docs/windows-authoring-measurements.json',import.meta.url),JSON.stringify({executedAt:new Date().toISOString(),node:process.version,measurements},null,2)+'\n');console.log(JSON.stringify(measurements));
});
const fieldsForCount={work_area:1,chemical_product:1,worker:1,work_area_product:1,work_area_assignment:1,sds_verification:1,hazcom_review:1,training_event:1};
