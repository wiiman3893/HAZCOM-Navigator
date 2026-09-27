import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './fixtures.mjs';
import {nodeSqlite,nodeFiles} from '../src/node.js';
import {exportCompanyBackup,importCompanyBackup,prepareNativeCompanyRestore,validateCompanyBackup} from '../src/backup.js';
import {REPLICA_SCHEMA_SQL} from '../src/sqlite.js';
import {InMemoryBackupDelivery} from '@hazcom/core';
const migration=await readFile(new URL('../../../database/migrations/003_authoring.sql',import.meta.url),'utf8');

test('backup rejects authoring and Company metadata changes during SDS reads',async()=>{
 const source=await fixture('small','backup-race');source.sql.db.exec(migration);
 try{
  for(const mutate of [
   ()=>source.sql.db.prepare('INSERT INTO authoring_versions(company_id,version) VALUES (?,1)').run(source.company.id),
   ()=>source.sql.db.prepare("UPDATE company SET name='Changed during export' WHERE id=?").run(source.company.id)
  ]){
   let changed=false;
   await assert.rejects(exportCompanyBackup(source.sql,{read:async path=>{if(!changed){changed=true;mutate();}return source.files.read(path);}},source.company.id),/changed during backup/);
  }
  assert.equal((await exportCompanyBackup(source.sql,source.files,source.company.id)).tables.company[0].name,'Changed during export');
 }finally{source.sql.close();}
});

test('versioned Company backup restores structured history and SDS into an independent SQLite database',async()=>{
 const source=await fixture('small','backup-source');source.sql.db.exec(migration);
 source.sql.db.prepare('UPDATE work_area SET deleted_at=? WHERE id=?').run('2026-09-01T00:00:00Z','area-0000');
 source.sql.db.prepare('INSERT INTO dm_change_history(id,record_type,record_id,changed_at,action,changes_json) VALUES (?,?,?,?,?,?)').run('history-one','work_area','area-0000','2026-09-01T00:00:00Z','delete',JSON.stringify({companyId:source.company.id}));
 const folder=await mkdtemp(path.join(tmpdir(),'hazcom-backup-target-'));
 const target=nodeSqlite(path.join(folder,'replica.db'),REPLICA_SCHEMA_SQL+migration),files=await nodeFiles(path.join(folder,'attachments'));
 try{
  const backup=await exportCompanyBackup(source.sql,source.files,source.company.id);
  assert.equal(backup.manifest.format,'hazcom-company-backup');
  assert.equal(backup.manifest.version,2);
  assert.equal(backup.manifest.schemaVersion,3);
  const native=await prepareNativeCompanyRestore(backup);
  assert.equal(native.companyId,source.company.id);
  assert.deepEqual(native.manifest,backup.manifest);
  assert.equal(native.files.length,20);
  assert.equal(native.files[0].ownerId,backup.attachments[0].ownerId);
  assert.equal(native.statements.filter(row=>row.statement.startsWith('INSERT INTO dm_attachments ')).length,20);
  assert.equal(native.statements.find(row=>row.statement.startsWith('INSERT INTO dm_attachments ')).values.includes(`${source.company.id}/${native.files[0].attachmentId}.pdf`),true);
  const legacy=structuredClone(backup);legacy.manifest.version=1;delete legacy.manifest.attachmentHash;
  assert.equal((await validateCompanyBackup(legacy)).companyId,source.company.id);
  assert.equal(backup.attachments.length,20);
  assert.equal(JSON.stringify(backup).includes('firebaseCredential'),false);
  const sent=[],delivery=new InMemoryBackupDelivery({send:async message=>sent.push(message)},1);
  const packageBytes=new TextEncoder().encode(JSON.stringify(backup));
  await delivery.deliverForVerifiedCompany({id:source.company.id,backupEmail:'holder@example.test',backupEmailVerified:true,coverageStatus:'grace'},'holder@example.test',packageBytes);
  const delivered=JSON.parse(new TextDecoder().decode(await delivery.download(source.company.id,sent[0].token)));
  const restored=await importCompanyBackup(delivered,target,files);
  assert.equal(restored.attachmentCount,20);
  for(const table of ['work_area','chemical_product','worker','work_area_product','work_area_assignment','sds_verification','hazcom_review','training_event'])
   assert.equal(target.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,backup.tables[table].length);
  assert.equal(target.db.prepare('PRAGMA foreign_key_check').all().length,0);
  assert.equal(target.db.prepare("SELECT deleted_at FROM work_area WHERE id='area-0000'").get().deleted_at,'2026-09-01T00:00:00Z');
  assert.equal(target.db.prepare('SELECT count(*) n FROM dm_change_history').get().n,1);
  const sds=backup.attachments[0],metadata=target.db.prepare('SELECT relative_path FROM dm_attachments WHERE id=?').get(sds.attachmentId);
  assert.deepEqual(Buffer.from(await files.read(metadata.relative_path)),Buffer.from(sds.base64,'base64'));
  await assert.rejects(importCompanyBackup(backup,target,files));
 }finally{source.sql.close();target.close();}
});

test('backup rejects corrupted records, SDS bytes, ownership and unsupported schema before SQLite activation',async()=>{
 const source=await fixture('small','backup-corrupt');source.sql.db.exec(migration);
 try{
  const original=await exportCompanyBackup(source.sql,source.files,source.company.id);
  const altered=mutate=>{const copy=structuredClone(original);mutate(copy);return copy;};
  for(const bad of [
   altered(b=>b.manifest.version=3),
   altered(b=>b.manifest.schemaVersion=99),
   altered(b=>b.tables.worker[0].name='tampered'),
   altered(b=>b.attachments[0].base64=Buffer.from('%PDF-bad').toString('base64')),
   altered(b=>b.attachments[0].ownerId='foreign'),
   altered(b=>{b.attachments[0].sha256='0'.repeat(64);b.attachments[0].base64=Buffer.from('%PDF-changed').toString('base64');}),
   altered(b=>{b.attachments[0].sizeBytes+=1;}),
   altered(b=>{b.tables.work_area_product__ownership[0].work_area_id='foreign';b.manifest.recordHash=createHash('sha256').update(JSON.stringify(b.tables)).digest('hex');})
  ]){
   const folder=await mkdtemp(path.join(tmpdir(),'hazcom-backup-reject-'));
   const target=nodeSqlite(path.join(folder,'replica.db'),REPLICA_SCHEMA_SQL+migration),files=await nodeFiles(path.join(folder,'attachments'));
   try{await assert.rejects(importCompanyBackup(bad,target,files));assert.equal(target.db.prepare('SELECT count(*) n FROM company').get().n,0);}
   finally{target.close();}
  }
  const broken=altered(b=>{b.tables.work_area__ownership[0].company_id='foreign';b.manifest.recordHash=createHash('sha256').update(JSON.stringify(b.tables)).digest('hex');});
  const folder=await mkdtemp(path.join(tmpdir(),'hazcom-backup-fk-'));
  const target=nodeSqlite(path.join(folder,'replica.db'),REPLICA_SCHEMA_SQL+migration),files=await nodeFiles(path.join(folder,'attachments'));
  try{await assert.rejects(importCompanyBackup(broken,target,files));assert.equal(target.db.prepare('SELECT count(*) n FROM company').get().n,0);}
  finally{target.close();}
 }finally{source.sql.close();}
});

test('backup preflight rejects cross-Company references and missing links before managed files are staged',async()=>{
 const source=await fixture('small','backup-preflight');source.sql.db.exec(migration);
 try{
  const original=await exportCompanyBackup(source.sql,source.files,source.company.id);
  const alter=mutate=>{const copy=structuredClone(original);mutate(copy);copy.manifest.recordHash=createHash('sha256').update(JSON.stringify(copy.tables)).digest('hex');return copy;};
  await assert.rejects(validateCompanyBackup(alter(b=>b.tables.rel_chemical_product_work_area_product_9d42d6cd[0].chemical_product_id='other-company')),/relationship mismatch/);
  await assert.rejects(validateCompanyBackup(alter(b=>b.tables.rel_worker_work_area_assignment_d30ac2b9.pop())),/relationship mismatch/);
  await assert.rejects(validateCompanyBackup(alter(b=>b.tables.authoring_versions.push({company_id:'other-company',version:1}))),/crosses Company/);
  const folder=await mkdtemp(path.join(tmpdir(),'hazcom-backup-preflight-'));
  const target=nodeSqlite(path.join(folder,'replica.db'),REPLICA_SCHEMA_SQL+migration);
  let staged=0;
  try{
   await assert.rejects(importCompanyBackup(alter(b=>b.tables.rel_worker_work_area_assignment_d30ac2b9.pop()),target,{stage:async()=>{staged++;return 'unexpected';}}));
   assert.equal(staged,0);
   assert.equal(target.db.prepare('SELECT count(*) n FROM company').get().n,0);
  }finally{target.close();}
 }finally{source.sql.close();}
});
