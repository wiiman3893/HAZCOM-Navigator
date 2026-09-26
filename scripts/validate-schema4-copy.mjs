import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {authoringService} from '@hazcom/authoring';
import {nodeFiles,nodeSqlite} from '@hazcom/sync/node';

const databasePath=process.env.HAZCOM_SCHEMA4_COPY_DB;
const companyId=process.env.HAZCOM_SCHEMA4_COMPANY_ID;
if(!databasePath||!companyId)throw Error('Set HAZCOM_SCHEMA4_COPY_DB and HAZCOM_SCHEMA4_COMPANY_ID to a temporary migrated copy and its Company ID.');
const tempRoot=await realpath(os.tmpdir());
const databaseRealPath=await realpath(databasePath);
const relative=path.relative(tempRoot,databaseRealPath);
if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('Refusing to write: schema-4 validation database must be under the OS temporary directory.');

const sql=nodeSqlite(databaseRealPath,'');
const ledger=sql.db.prepare('SELECT max(version) AS version FROM _sqlx_migrations WHERE success=1').get();
assert.equal(Number(ledger?.version),4,'copied database must have schema-4 migration ledger');
for(const table of ['sds_import_session','sds_import_page','sds_import_draft'])
  assert.ok(sql.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table),`missing ${table}`);
assert.ok(sql.db.prepare('SELECT 1 FROM company WHERE id=?').get(companyId),'Company must exist in copied workspace');

function makePdf(pages){
  const objects=['1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj'];
  const kids=[];
  for(let i=0;i<pages.length;i++){
    const pageId=3+i*2,contentId=pageId+1;
    kids.push(`${pageId} 0 R`);
    const text=String(pages[i]).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
    const stream=text?`BT (${text}) Tj ET`:'q Q';
    objects.push(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents ${contentId} 0 R >>\nendobj`);
    objects.push(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj`);
  }
  objects.splice(1,0,`2 0 obj\n<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>\nendobj`);
  return new TextEncoder().encode('%PDF-1.4\n'+objects.join('\n')+'\n%%EOF');
}

const attachmentRoot=path.join(path.dirname(databaseRealPath),'schema4-import-attachments');
const files=await nodeFiles(attachmentRoot);
const service=authoringService({sql,files,companyId,authorize:async()=>({companyId,role:'manager',active:true})});
const productCount=sql.db.prepare('SELECT count(*) AS count FROM chemical_product').get().count;
const pdf=makePdf([
  'Safety Data Sheet SECTION 1: IDENTIFICATION Product Name: Synthetic Alpha Page 1 of 2',
  'SECTION 16 OTHER INFORMATION Page 2 of 2',
  'Safety Data Sheet SECTION 1: IDENTIFICATION Product Name: Synthetic Beta Page 1 of 1',
]);
const sessionId=randomUUID();
try{
  await service.importSdsBatch(pdf,'synthetic-schema4-batch.pdf',sessionId);
  let snapshot=await service.snapshot();
  let session=snapshot.sds_import_session.find(row=>row.id===sessionId);
  assert.ok(session,'import session persisted');
  assert.equal(session.company_id,companyId,'session ownership stays within selected Company');
  assert.equal(Number(session.source_size_bytes),pdf.byteLength);
  assert.equal(session.source_sha256,createHash('sha256').update(pdf).digest('hex'));
  assert.equal(Number(session.page_count),3);
  assert.deepEqual(snapshot.sds_import_page.filter(row=>row.session_id===sessionId).map(row=>Number(row.page_number)),[1,2,3]);
  assert.equal(sql.db.prepare('SELECT count(*) AS count FROM chemical_product').get().count,productCount,'review import must not create Products');
  let draft=snapshot.sds_import_draft.find(row=>row.session_id===sessionId&&Number(row.start_page)===1);
  assert.ok(draft&&Number(draft.end_page)>=2,'first SDS is conservatively grouped');
  await service.splitSdsImportDraft(sessionId,draft.id,2);
  snapshot=await service.snapshot();
  draft=snapshot.sds_import_draft.find(row=>row.session_id===sessionId&&Number(row.start_page)===1);
  const next=snapshot.sds_import_draft.find(row=>row.session_id===sessionId&&Number(row.start_page)===2);
  assert.ok(draft&&next,'manual split persisted');
  await service.mergeSdsImportDraft(sessionId,next.id,'previous');
  await service.saveSdsImportDrafts(sessionId);
  sql.close();

  const reopened=nodeSqlite(databaseRealPath,'');
  const restarted=authoringService({sql:reopened,files,companyId,authorize:async()=>({companyId,role:'manager',active:true})});
  snapshot=await restarted.snapshot();
  session=snapshot.sds_import_session.find(row=>row.id===sessionId);
  assert.equal(session.status,'review_drafts_saved');
  const pages=snapshot.sds_import_page.filter(row=>row.session_id===sessionId).map(row=>Number(row.page_number));
  assert.deepEqual(pages,[1,2,3]);
  const drafts=snapshot.sds_import_draft.filter(row=>row.session_id===sessionId).sort((a,b)=>a.ordinal-b.ordinal);
  const covered=drafts.flatMap(row=>Array.from({length:Number(row.end_page)-Number(row.start_page)+1},(_,i)=>Number(row.start_page)+i));
  assert.deepEqual(covered,[1,2,3],'saved draft ranges remain contiguous without loss or duplicates');
  assert.equal(reopened.db.prepare('SELECT count(*) AS count FROM chemical_product').get().count,productCount,'no draft created a Product after reopen');
  assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(reopened.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  const persistedBytes=await files.read(session.managed_source_path);
  assert.equal(persistedBytes.byteLength,pdf.byteLength);
  assert.equal(createHash('sha256').update(persistedBytes).digest('hex'),session.source_sha256);
  reopened.close();
  console.log(JSON.stringify({status:'PASS',schemaVersion:4,companyScoped:true,pages:3,sourceSizeBytes:session.source_size_bytes,sha256:session.source_sha256,draftPages:covered,productCountUnchanged:true,reopened:true}));
}catch(error){try{sql.close()}catch{};throw error;}
