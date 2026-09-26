import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {authoringService,analyzeSdsPdf,splitDrafts,mergeDrafts,normalizeDrafts} from '../src/index.js';
import {nodeSqlite,nodeFiles} from '../../sync/src/node.js';
import {REPLICA_SCHEMA_SQL} from '../../sync/src/sqlite.js';

const migration3=await readFile(new URL('../../../database/migrations/003_authoring.sql',import.meta.url),'utf8');
const migration4=await readFile(new URL('../../../database/migrations/004_bulk_sds_import.sql',import.meta.url),'utf8');
function pdf(pages){
 const objects=['1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj'];
 const kids=[];
 for(let i=0;i<pages.length;i++){const pageId=3+i*2,contentId=pageId+1;kids.push(pageId+' 0 R');const safe=String(pages[i]??'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');const stream=safe?`BT (${safe}) Tj ET`:'q Q';objects.push(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents ${contentId} 0 R >>\nendobj`);objects.push(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj`);}
 objects.splice(1,0,`2 0 obj\n<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>\nendobj`);
 return new TextEncoder().encode('%PDF-1.4\n'+objects.join('\n')+'\n%%EOF');
}
const coverage=(pageCount,drafts)=>normalizeDrafts(pageCount,drafts).flatMap(d=>Array.from({length:d.endPage-d.startPage+1},(_,i)=>d.startPage+i));

test('one text SDS stays one review candidate',async()=>{
 const a=await analyzeSdsPdf(pdf(['Safety Data Sheet SECTION 1: IDENTIFICATION Product Name: Synthetic Cleaner Page 1 of 1 SECTION 16 OTHER INFORMATION']));
 assert.equal(a.pageCount,1);assert.equal(a.drafts.length,1);assert.equal(a.drafts[0].startPage,1);assert.equal(a.drafts[0].endPage,1);assert.equal(a.pages[0].ocrRequired,false);
});

test('several SDSs use repeated Section 1, page reset and Section 16 conservatively',async()=>{
 const a=await analyzeSdsPdf(pdf([
  'Safety Data Sheet SECTION 1: IDENTIFICATION Product Name: Alpha Page 1 of 2',
  'SECTION 16 OTHER INFORMATION Page 2 of 2',
  'Safety Data Sheet SECTION 1: IDENTIFICATION Product Name: Beta Page 1 of 2',
  'SECTION 16 OTHER INFORMATION Page 2 of 2',
  'SECTION 1 IDENTIFICATION Product Name: Gamma Page 1 of 1'
 ]));
 assert.deepEqual(a.drafts.map(d=>[d.startPage,d.endPage]),[[1,2],[3,4],[5,5]]);
 assert.match(a.drafts[1].reason,/SECTION 1/);assert.match(a.drafts[1].reason,/page numbering restarted/);assert.equal(a.drafts[2].confidence,'likely');
 assert.deepEqual(coverage(a.pageCount,a.drafts),[1,2,3,4,5]);
});

test('weak repeated Section 1 creates an uncertain boundary rather than silently mixing documents',async()=>{
 const a=await analyzeSdsPdf(pdf(['Safety Data Sheet SECTION 1 IDENTIFICATION Product Name: Alpha','continuation text','SECTION 1 IDENTIFICATION Product Name: Maybe New']));
 assert.equal(a.drafts.length,2);assert.equal(a.drafts[1].startPage,3);assert.equal(a.drafts[1].confidence,'uncertain');
});

test('image-only PDF is imported as OCR-required and remains manually splittable',async()=>{
 const a=await analyzeSdsPdf(pdf(['','','']));
 assert.equal(a.pages.every(p=>p.ocrRequired),true);assert.deepEqual(a.drafts.map(d=>[d.startPage,d.endPage]),[[1,3]]);
 const split=splitDrafts(3,a.drafts,a.drafts[0].id,2);assert.deepEqual(split.map(d=>[d.startPage,d.endPage]),[[1,1],[2,3]]);
 const mergedNext=mergeDrafts(3,split,split[0].id,'next');assert.deepEqual(mergedNext.map(d=>[d.startPage,d.endPage]),[[1,3]]);
 const splitAgain=splitDrafts(3,mergedNext,mergedNext[0].id,3);const mergedPrevious=mergeDrafts(3,splitAgain,splitAgain[1].id,'previous');assert.deepEqual(mergedPrevious.map(d=>[d.startPage,d.endPage]),[[1,3]]);
 assert.deepEqual(coverage(3,mergedPrevious),[1,2,3]);
});

async function setup(){
 const folder=await mkdtemp(path.join(tmpdir(),'hazcom-bulk-import-'));const sql=nodeSqlite(path.join(folder,'author.db'),REPLICA_SCHEMA_SQL+migration3+migration4),files=await nodeFiles(path.join(folder,'attachments'));
 for(const id of ['company-a','company-b'])sql.db.prepare('INSERT INTO company(id,name,contact_email) VALUES (?,?,?)').run(id,id,'safety@example.test');
 const service=companyId=>authoringService({sql,files,companyId,authorize:async()=>({companyId,role:'manager',active:true})});
 return {sql,files,service};
}

test('batch session persists source integrity and segmentation across restart with Company isolation',async()=>{
 const f=await setup();const bytes=pdf(['','','','']);const expectedHash=createHash('sha256').update(bytes).digest('hex');
 try{
  const first=f.service('company-a');await first.importSdsBatch(bytes,'stack.pdf','batch-one');let d=await first.snapshot();
  const session=d.sds_import_session[0];assert.equal(session.source_filename,'stack.pdf');assert.equal(session.source_sha256,expectedHash);assert.equal(Number(session.source_size_bytes),bytes.length);assert.equal(session.page_count,4);assert.equal(d.sds_import_page.length,4);assert.equal(d.sds_import_page.every(p=>p.ocr_required===1),true);
  assert.deepEqual(await f.files.read(session.managed_source_path),bytes);
  let draft=d.sds_import_draft[0];await first.splitSdsImportDraft('batch-one',draft.id,2);d=await first.snapshot();assert.deepEqual(d.sds_import_draft.map(x=>[x.start_page,x.end_page]),[[1,1],[2,4]]);
  await first.splitSdsImportDraft('batch-one',d.sds_import_draft[1].id,4);d=await first.snapshot();assert.deepEqual(d.sds_import_draft.map(x=>[x.start_page,x.end_page]),[[1,1],[2,3],[4,4]]);
  await first.mergeSdsImportDraft('batch-one',d.sds_import_draft[1].id,'previous');d=await first.snapshot();assert.deepEqual(d.sds_import_draft.map(x=>[x.start_page,x.end_page]),[[1,3],[4,4]]);
  await first.mergeSdsImportDraft('batch-one',d.sds_import_draft[0].id,'next');await first.saveSdsImportDrafts('batch-one');
  const restarted=f.service('company-a'),after=await restarted.snapshot();assert.equal(after.sds_import_session[0].status,'review_drafts_saved');assert.deepEqual(after.sds_import_draft.map(x=>[x.start_page,x.end_page]),[[1,4]]);assert.deepEqual(after.sds_import_page.map(x=>x.page_number),[1,2,3,4]);
  const other=await f.service('company-b').snapshot();assert.equal(other.sds_import_session.length,0);assert.equal(other.sds_import_draft.length,0);assert.equal(other.sds_import_page.length,0);
  await assert.rejects(f.service('company-b').splitSdsImportDraft('batch-one',after.sds_import_draft[0].id,2),/Company/);
 }finally{f.sql.close();}
});
