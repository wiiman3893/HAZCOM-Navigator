import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fixture} from './fixtures.mjs';
import {nodeSqlite,nodeFiles} from '../src/node.js';
import {exportCompanyBackup,importCompanyBackup} from '../src/backup.js';
import {REPLICA_SCHEMA_SQL} from '../src/sqlite.js';
import {InMemoryBackupDelivery} from '@hazcom/core';
const migration=await readFile(new URL('../../../database/migrations/003_authoring.sql',import.meta.url),'utf8');

test('versioned Company backup restores structured history and SDS into an independent SQLite database',async()=>{
 const source=await fixture('small','backup-source');source.sql.db.exec(migration);
 source.sql.db.prepare('UPDATE work_area SET deleted_at=? WHERE id=?').run('2026-09-01T00:00:00Z','area-0000');
 source.sql.db.prepare('INSERT INTO dm_change_history(id,record_type,record_id,changed_at,action,changes_json) VALUES (?,?,?,?,?,?)').run('history-one','work_area','area-0000','2026-09-01T00:00:00Z','delete',JSON.stringify({companyId:source.company.id}));
 const folder=await mkdtemp(path.join(tmpdir(),'hazcom-backup-target-'));
 const target=nodeSqlite(path.join(folder,'replica.db'),REPLICA_SCHEMA_SQL+migration),files=await nodeFiles(path.join(folder,'attachments'));
 try{
  const backup=await exportCompanyBackup(source.sql,source.files,source.company.id);
  assert.equal(backup.manifest.format,'hazcom-company-backup');
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
   altered(b=>b.manifest.version=2),
   altered(b=>b.tables.worker[0].name='tampered'),
   altered(b=>b.attachments[0].base64=Buffer.from('%PDF-bad').toString('base64')),
   altered(b=>b.attachments[0].ownerId='foreign')
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
