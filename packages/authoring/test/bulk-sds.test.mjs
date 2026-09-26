import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {analyzeSdsBatchPdf,assertDraftCoverage,authoringService,sha256Hex} from '../src/index.js';
import {nodeFiles,nodeSqlite} from '../../sync/src/node.js';
import {REPLICA_SCHEMA_SQL} from '../../sync/src/sqlite.js';

const migration=(await readFile(new URL('../../../database/migrations/003_authoring.sql',import.meta.url),'utf8'))+(await readFile(new URL('../../../database/migrations/004_bulk_sds_import.sql',import.meta.url),'utf8'));

async function textPdf(pageTexts){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);
 for(const text of pageTexts){
  const page=doc.addPage([612,792]);
  page.drawText(text,{x:40,y:740,size:11,font,lineHeight:15,maxWidth:530});
 }
 return new Uint8Array(await doc.save({useObjectStreams:false}));
}

async function blankPdf(pageCount){
 const doc=await PDFDocument.create();
 for(let i=0;i<pageCount;i++)doc.addPage([612,792]);
 return new Uint8Array(await doc.save({useObjectStreams:false}));
}

const sds=(name,page,total,section)=>[
 'SAFETY DATA SHEET',
 section,
 `Product identifier: ${name}`,
 `Page ${page} of ${total}`
].filter(Boolean).join('\n');

test('Bulk PDF analysis keeps a single text SDS together and labels it',async()=>{
 const bytes=await textPdf([
  sds('Synthetic Degreaser',1,3,'SECTION 1: IDENTIFICATION'),
  'SECTION 8: EXPOSURE CONTROLS\nPage 2 of 3',
  'SECTION 16: OTHER INFORMATION\nPage 3 of 3'
 ]);
 const result=await analyzeSdsBatchPdf(bytes);
 assert.equal(result.pageCount,3);
 assert.equal(result.candidates.length,1);
 assert.deepEqual([result.candidates[0].startPage,result.candidates[0].endPage],[1,3]);
 assert.equal(result.candidates[0].confidence,'likely');
 assert.match(result.candidates[0].detectedTitle??'',/Synthetic Degreaser/);
 assert.equal(result.pages.every(p=>p.textStatus==='embedded'),true);
});

test('Bulk PDF analysis finds several SDSs and repeated Section 1 boundaries',async()=>{
 const bytes=await textPdf([
  sds('Product Alpha',1,3,'SECTION 1: IDENTIFICATION'),
  'SECTION 8\nPage 2 of 3',
  'SECTION 16\nPage 3 of 3',
  sds('Product Beta',1,3,'SECTION 1 IDENTIFICATION'),
  'SECTION 9\nPage 2 of 3',
  'SECTION 16\nPage 3 of 3'
 ]);
 const result=await analyzeSdsBatchPdf(bytes);
 assert.deepEqual(result.candidates.map(c=>[c.startPage,c.endPage]),[[1,3],[4,6]]);
 assert.equal(result.candidates[1].confidence,'likely');

 const repeated=await analyzeSdsBatchPdf(await textPdf([
  'SECTION 1: IDENTIFICATION\nProduct name: First',
  'SECTION 4: FIRST-AID MEASURES',
  'SECTION 1: IDENTIFICATION\nProduct name: Second',
  'SECTION 16: OTHER INFORMATION'
 ]));
 assert.deepEqual(repeated.candidates.map(c=>c.startPage),[1,3]);
});

test('Page-number reset can propose an uncertain boundary without claiming certainty',async()=>{
 const result=await analyzeSdsBatchPdf(await textPdf([
  'Safety information\nPage 1 of 2',
  'Other information\nPage 2 of 2',
  'Page 1 of 2\nProduct name: Possible second document',
  'Page 2 of 2'
 ]));
 assert.deepEqual(result.candidates.map(c=>c.startPage),[1,3]);
 assert.equal(result.candidates[1].confidence,'uncertain');
 assert.match(result.candidates[1].reason,/page numbering restarted/i);
});

test('No reliable text boundary remains uncertain and no-text pages require OCR',async()=>{
 const uncertain=await analyzeSdsBatchPdf(await textPdf(['General safety information','Handling information','Revision notes']));
 assert.equal(uncertain.candidates.length,1);
 assert.equal(uncertain.candidates[0].confidence,'uncertain');
 assert.deepEqual([uncertain.candidates[0].startPage,uncertain.candidates[0].endPage],[1,3]);

 const noText=await analyzeSdsBatchPdf(await blankPdf(5));
 assert.equal(noText.pages.every(p=>p.textStatus==='ocr_required'),true);
 assert.deepEqual(noText.candidates.map(c=>[c.startPage,c.endPage]),[[1,5]]);
 assert.equal(noText.candidates[0].confidence,'uncertain');
});

async function setup(){
 const folder=await mkdtemp(path.join(tmpdir(),'hazcom-bulk-sds-'));
 const sql=nodeSqlite(path.join(folder,'author.db'),REPLICA_SCHEMA_SQL+migration);
 const files=await nodeFiles(path.join(folder,'attachments'));
 for(const [id,name] of [['company-a','Company A'],['company-b','Company B']])sql.db.prepare('INSERT INTO company(id,name,contact_email) VALUES (?,?,?)').run(id,name,`${id}@example.test`);
 const make=companyId=>authoringService({sql,files,companyId,authorize:async()=>({companyId,role:'manager',active:true}),today:()=> '2026-09-26'});
 return {folder,sql,files,a:make('company-a'),b:make('company-b'),make};
}

const coverage=(drafts,pageCount)=>assertDraftCoverage(drafts.map(d=>({startPage:Number(d.start_page),endPage:Number(d.end_page)})),pageCount);

test('Image/no-text batch remains manually splittable, mergeable, persistent, scoped and materialized',async()=>{
 const f=await setup();
 try{
  const bytes=await blankPdf(6),expectedHash=await sha256Hex(bytes);
  await f.a.importSdsBatch(bytes,'scanner-stack.pdf','session-a');
  let snapshot=await f.a.snapshot(),session=snapshot.sds_import_session[0];
  assert.equal(session.source_filename,'scanner-stack.pdf');
  assert.equal(session.source_sha256,expectedHash);
  assert.equal(Number(session.source_size_bytes),bytes.length);
  assert.equal(Number(session.page_count),6);
  assert.equal(session.status,'review');
  assert.equal(snapshot.chemical_product.length,0);
  assert.equal(snapshot.sds_import_page.every(p=>p.text_status==='ocr_required'),true);
  coverage(snapshot.sds_import_draft,6);

  let draft=snapshot.sds_import_draft[0];
  await f.a.splitImportDraft('session-a',draft.id,3,'draft-right');
  snapshot=await f.a.snapshot();
  assert.deepEqual(snapshot.sds_import_draft.map(d=>[Number(d.start_page),Number(d.end_page)]),[[1,2],[3,6]]);
  coverage(snapshot.sds_import_draft,6);

  await f.a.splitImportDraft('session-a','draft-right',5,'draft-third');
  snapshot=await f.a.snapshot();
  assert.deepEqual(snapshot.sds_import_draft.map(d=>[Number(d.start_page),Number(d.end_page)]),[[1,2],[3,4],[5,6]]);
  await f.a.mergeImportDraft('session-a','draft-third','previous');
  snapshot=await f.a.snapshot();
  assert.deepEqual(snapshot.sds_import_draft.map(d=>[Number(d.start_page),Number(d.end_page)]),[[1,2],[3,6]]);

  const second=snapshot.sds_import_draft[1];
  await f.a.splitImportDraft('session-a',second.id,5,'draft-third-again');
  snapshot=await f.a.snapshot();
  await f.a.mergeImportDraft('session-a',snapshot.sds_import_draft[0].id,'next');
  snapshot=await f.a.snapshot();
  assert.deepEqual(snapshot.sds_import_draft.map(d=>[Number(d.start_page),Number(d.end_page)]),[[1,4],[5,6]]);
  coverage(snapshot.sds_import_draft,6);

  const restarted=f.make('company-a');
  const persisted=await restarted.snapshot();
  assert.deepEqual(persisted.sds_import_draft.map(d=>[Number(d.start_page),Number(d.end_page)]),[[1,4],[5,6]]);
  assert.equal((await f.b.snapshot()).sds_import_session.length,0);
  await assert.rejects(f.b.readImportSource('session-a'),/Company/);

  await restarted.saveImportReview('session-a');
  snapshot=await restarted.snapshot();
  assert.equal(snapshot.sds_import_session[0].status,'reviewed');
  assert.equal(snapshot.sds_import_draft.every(d=>d.child_sha256?.length===64&&Number(d.child_size_bytes)>0),true);
  coverage(snapshot.sds_import_draft,6);
  const firstBytes=await restarted.readImportDraft('session-a',snapshot.sds_import_draft[0].id);
  const firstChild=await PDFDocument.load(firstBytes);
  assert.equal(firstChild.getPageCount(),4);
  const secondBytes=await restarted.readImportDraft('session-a',snapshot.sds_import_draft[1].id);
  const secondChild=await PDFDocument.load(secondBytes);
  assert.equal(secondChild.getPageCount(),2);
  await assert.rejects(restarted.splitImportDraft('session-a',snapshot.sds_import_draft[0].id,2),/already saved/);

  const sourcePath=path.join(f.folder,'attachments',snapshot.sds_import_session[0].source_relative_path);
  await writeFile(sourcePath,await blankPdf(1));
  await assert.rejects(restarted.readImportSource('session-a'),/(size|hash) changed/i);
 }finally{f.sql.close();}
});
