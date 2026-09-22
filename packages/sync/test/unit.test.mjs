import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {stat,writeFile} from 'node:fs/promises';
import {fixture} from './fixtures.mjs';
import {nodeSqlite,nodeFiles} from '../src/node.js';
import {buildPublication,normalizeDataset,serverRows,capacity,limits,digest,day,REPLICA_SCHEMA_SQL,sqliteReplica,sqliteJournal,scopeKey,publishLegacy as publish,receiver,attachmentPath} from '../src/index.js';

test('Company-scoped deterministic SQLite projection, deletion and relationship checks',async()=>{
  const f=await fixture();
  try {
    const a=await buildPublication(f.sql,f.company.id,f.files);
    assert.equal(a.metrics.records,140); assert.equal(a.attachments.length,20);
    f.sql.db.exec("INSERT INTO worker(id,name) VALUES ('orphan','Unowned')");
    await assert.rejects(buildPublication(f.sql,f.company.id,f.files),/Unowned/);
    f.sql.db.exec("UPDATE worker SET deleted_at='2026-01-01' WHERE id='orphan'");
    f.sql.db.exec("INSERT INTO company(id,name,contact_email) VALUES ('other','Other','other@example.test'); INSERT INTO chemical_product(id,product_name,manufacturer,sds_date) VALUES ('foreign','Private','Other','2026-01-01'); INSERT INTO chemical_product__ownership(id,child_id,relationship_id,company_id) VALUES ('foreign-owner','foreign','940a4d09-5250-4b89-9911-1ac6f4ba64cf','other');");
    f.sql.db.exec('PRAGMA reverse_unordered_selects=ON');
    const b=await buildPublication(f.sql,f.company.id,f.files); assert.equal(a.fingerprint,b.fingerprint);
    f.sql.db.exec("UPDATE chemical_product SET sds_date='2026-01-01T12:00:00Z' WHERE id='product-0000'");
    assert.equal((await buildPublication(f.sql,f.company.id,f.files)).fingerprint,a.fingerprint);
    f.sql.db.exec("UPDATE rel_chemical_product_work_area_product_9d42d6cd SET chemical_product_id='foreign' WHERE work_area_product_id='area-product-0000'");
    await assert.rejects(buildPublication(f.sql,f.company.id,f.files),/Broken/);
    f.sql.db.exec("UPDATE rel_chemical_product_work_area_product_9d42d6cd SET chemical_product_id='product-0000' WHERE work_area_product_id='area-product-0000'; DELETE FROM rel_worker_work_area_assignment_d30ac2b9 WHERE work_area_assignment_id='assignment-0000'");
    await assert.rejects(buildPublication(f.sql,f.company.id,f.files),/Unsafe stable ID/);
    f.sql.db.exec("UPDATE work_area SET deleted_at='2026-02-01' WHERE id='area-0000'");
    const c=await buildPublication(f.sql,f.company.id,f.files);
    assert.equal(c.dataset.workAreas.length,4); assert(!c.dataset.workAreaAssignments.some(a=>a.id==='assignment-0000'));
    f.sql.db.exec("UPDATE dm_attachments SET size_bytes=1 WHERE id='sds-0000'");
    await assert.rejects(buildPublication(f.sql,f.company.id,f.files),/size mismatch/);
    f.sql.db.exec("UPDATE dm_attachments SET size_bytes=NULL,relative_path='../outside.pdf' WHERE id='sds-0000'");
    await assert.rejects(buildPublication(f.sql,f.company.id,f.files),/Unsafe/);
    f.sql.db.exec("UPDATE dm_attachments SET relative_path='source/missing.pdf' WHERE id='sds-0000'");
    await assert.rejects(buildPublication(f.sql,f.company.id,f.files),/ENOENT/);
    assert.throws(()=>day('2026-02-31'),/calendar/); assert.throws(()=>day('2026-01-01 12:00'),/Ambiguous/);
  } finally {f.sql.close();}
});

test('Small, Medium, Large capacity and local SQLite performance evidence',async()=>{
  const measurements=[];
  for(const size of ['small','medium','large']) {
    const f=await fixture(size), target=nodeSqlite(path.join(f.folder,'replica.db'),REPLICA_SCHEMA_SQL);
    try {
      const p=await buildPublication(f.sql,f.company.id,f.files), data=serverRows(p.dataset);
      const destination=await nodeFiles(path.join(f.folder,'replica-files')), staged=[];
      for(const a of p.attachments) staged.push({...a,localPath:await destination.stage('benchmark',a.attachmentId,await f.files.read(a.localPath))});
      const access={uid:'benchmark',companyId:f.company.id,role:'manager',workerId:null};
      const start=performance.now();
      await sqliteReplica(target).activate({previous:null,access,metadata:{company:f.company,revisionId:'local-benchmark',revisionNumber:1},dataset:data,attachments:staged});
      const importMs=performance.now()-start;
      assert.deepEqual((await buildPublication(target,f.company.id,destination)).dataset,p.dataset);
      assert.equal(target.db.prepare('PRAGMA foreign_key_check').all().length,0);
      if(size==='small') assert.deepEqual(p.metrics.violations,[]);
      else {assert(p.metrics.violations.some(v=>v.startsWith('Records'))); assert(p.metrics.violations.some(v=>v.startsWith('Attachments')));}
      target.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      measurements.push({size,...p.metrics,importMs,authorDbBytes:await f.dbSize(),replicaDbBytes:(await stat(path.join(f.folder,'replica.db'))).size,mode:'Local SQLite benchmark against legacy schema 1 limits; schema 2 scale evidence is recorded separately'});
    } finally {target.close();f.sql.close();}
  }
  await writeFile(new URL('../../../docs/publication-sync-measurements.json',import.meta.url),JSON.stringify({measuredAt:new Date().toISOString(),node:process.version,limits,measurements},null,2)+'\n');
  console.log(JSON.stringify(measurements));
});

test('receiver preserves prior replica for failed and partial imports, validates integrity and races',async()=>{
  const f=await fixture(), db=nodeSqlite(path.join(f.folder,'device.db'),REPLICA_SCHEMA_SQL), files=await nodeFiles(path.join(f.folder,'device-files'));
  try {
    const p=await buildPublication(f.sql,f.company.id,f.files), data=serverRows(p.dataset);
    const access={uid:'test-user',companyId:f.company.id,role:'manager',workerId:null,active:true,currentRevisionId:'rev1',currentRevisionNumber:1};
    const meta=async()=>({company:f.company,companyId:f.company.id,revisionId:access.currentRevisionId,revisionNumber:access.currentRevisionNumber,status:'published',schemaVersion:1,recordCounts:p.metrics.counts,attachmentCount:p.attachments.length,payloadHash:await digest({rows:data,attachmentIds:p.attachments.map(a=>a.attachmentId).sort()})});
    const transport={access:async()=>({...access}),metadata:meta,records:async(c,r,k)=>structuredClone(data[k]),attachments:async()=>p.attachments.map(a=>({...a,published:true,relativePath:attachmentPath(f.company.id,access.currentRevisionId,a)})),download:async path=>{const id=path.split('/').at(-2);return f.files.read(p.attachments.find(a=>a.attachmentId===id).localPath);}};
    const replica=sqliteReplica(db), client=receiver({transport,replica,files});
    assert.equal((await client.sync(f.company.id)).changed,true);
    assert.equal((await client.sync(f.company.id)).changed,false);
    const prior=await replica.state(); access.currentRevisionId='rev2';access.currentRevisionNumber=2;
    for(const at of [0,40,160,380]) {db.beforeStatement=i=>{if(i===at) throw Error('Injected SQLite import failure');}; await assert.rejects(client.sync(f.company.id),/Injected/); assert.deepEqual(await replica.state(),prior);assert.equal(db.db.prepare('SELECT count(*) n FROM chemical_product').get().n,20);}
    db.beforeStatement=null;
    const fails=async(patch,pattern)=>{const broken=receiver({transport:{...transport,...patch},replica,files}); await assert.rejects(broken.sync(f.company.id),pattern);assert.deepEqual(await replica.state(),prior);};
    await fails({download:async()=>{throw Error('Interrupted download');}},/Interrupted/);
    await fails({download:async path=>{const b=await transport.download(path); b[b.length-1]^=1; return b;}},/SHA-256/);
    await fails({download:async path=>(await transport.download(path)).slice(0,-1)},/size mismatch/);
    await fails({attachments:async()=>(await transport.attachments()).slice(1)},/Incomplete SDS/);
    await fails({attachments:async()=>{const a=await transport.attachments();a[0].ownerId='other-company-product';return a;}},/ownership/);
    await fails({attachments:async()=>{const a=await transport.attachments();a[0].sizeBytes++;return a;}},/size mismatch/);
    await fails({attachments:async()=>{const a=await transport.attachments();a[0].sha256='0'.repeat(64);a[0].relativePath=attachmentPath(f.company.id,'rev2',a[0]);return a;}},/SHA-256/);
    await fails({attachments:async()=>{const a=await transport.attachments();a[0].relativePath=a[0].relativePath.replace('rev2','foreign');return a;}},/path mismatch/);
    await fails({metadata:async()=>({...await meta(),revisionId:'wrong'})},/identity/);
    await fails({records:async(c,r,k)=>k==='workers'?[]:transport.records(c,r,k)},/Broken/);
    let reads=0; await fails({access:async()=>({...access,currentRevisionId:++reads===1?'rev2':'rev3'})},/Revision changed/);
    reads=0;await fails({access:async()=>({...access,active:++reads===1})},/Inactive/);
    const observer=nodeSqlite(path.join(f.folder,'device.db'));
    let observed=false;
    db.beforeStatement=i=>{if(i===160){observed=true;assert.equal(observer.db.prepare('SELECT count(*) n FROM chemical_product').get().n,20);assert.equal(JSON.parse(observer.db.prepare('SELECT value FROM replica_state').get().value).revisionId,'rev1');}};
    try {assert.equal((await client.sync(f.company.id)).changed,true);assert(observed);}finally{observer.close();db.beforeStatement=null;}
    assert.equal((await replica.state()).revisionId,'rev2');
    // Stale independent importers cannot overwrite the new pointer.
    await assert.rejects(replica.activate({previous:prior,access,metadata:await meta(),dataset:data,attachments:[]}),/CHECK/);
  } finally {db.close();f.sql.close();}
});

test('publication durable journal rejects changed data and cancellation before transport',async()=>{
  const f=await fixture();
  try {
    const projection=await buildPublication(f.sql,f.company.id,f.files), journal=sqliteJournal(f.sql), signal=AbortSignal.abort();
    await assert.rejects(publish({projection,revisionId:'cancel',files:f.files,journal,signal,transport:{call:()=>assert.fail('No request after cancellation')}}),/cancelled/);
    f.sql.db.exec("UPDATE work_area SET name='Changed' WHERE id='area-0000'");
    const changed=await buildPublication(f.sql,f.company.id,f.files);
    await assert.rejects(publish({projection:changed,revisionId:'cancel',files:f.files,journal,transport:{}}),/new revision ID/);
    const malformed=structuredClone(projection); malformed.dataset.workers[0].name='Tampered';
    await assert.rejects(publish({projection:malformed,revisionId:'tampered',files:f.files,journal,transport:{}}),/changed after build/);
  } finally {f.sql.close();}
});
