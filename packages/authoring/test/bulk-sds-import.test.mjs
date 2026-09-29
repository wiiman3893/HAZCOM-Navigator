import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {authoringService,analyzeSdsPdf,analyzeSdsCandidate,normalizePageText,splitDrafts,mergeDrafts,normalizeDrafts} from '../src/index.js';
import {nodeSqlite,nodeFiles} from '../../sync/src/node.js';
import {REPLICA_SCHEMA_SQL} from '../../sync/src/sqlite.js';
import {buildPublication} from '../../sync/src/projection.js';

const migration3=await readFile(new URL('../../../database/migrations/003_authoring.sql',import.meta.url),'utf8');
const migration4=await readFile(new URL('../../../database/migrations/004_bulk_sds_import.sql',import.meta.url),'utf8');
const migration5=await readFile(new URL('../../../database/migrations/005_bulk_sds_extraction.sql',import.meta.url),'utf8');
const migration6=await readFile(new URL('../../../database/migrations/006_bulk_sds_materialization.sql',import.meta.url),'utf8');
function pdf(pages){
 const objects=['1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj'];
 const kids=[];
 for(let i=0;i<pages.length;i++){const pageId=3+i*2,contentId=pageId+1;kids.push(pageId+' 0 R');const safe=String(pages[i]??'').replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');const stream=safe?`BT (${safe}) Tj ET`:'q Q';objects.push(`${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /Contents ${contentId} 0 R >>\nendobj`);objects.push(`${contentId} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj`);}
 objects.splice(1,0,`2 0 obj\n<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>\nendobj`);
 return new TextEncoder().encode('%PDF-1.4\n'+objects.join('\n')+'\n%%EOF');
}
const coverage=(pageCount,drafts)=>normalizeDrafts(pageCount,drafts).flatMap(d=>Array.from({length:d.endPage-d.startPage+1},(_,i)=>d.startPage+i));

test('candidate extraction normalizes headings and preserves field provenance',()=>{
 const pages=[
  {pageNumber:1,textSource:'embedded',text:'S E C T I O N  1: Identification\nProduct Name: Synthetic Degreaser\nManufacturer: Example Safety Products'},
  {pageNumber:2,textSource:'embedded',text:'SECTION 3: Composition\nAcetone 67-64-1'},
  {pageNumber:3,textSource:'embedded',text:'SECTION 16: Other information\nRevision date: 09/28/2026'}
 ];
 assert.match(normalizePageText(pages[0].text),/^SECTION 1:/);
 const result=analyzeSdsCandidate(pages),fields=Object.fromEntries(result.fields.map(row=>[row.fieldName,row]));
 assert.deepEqual(result.sections.map(section=>section.number),[1,3,16]);
 assert.equal(fields.product_name.proposedValue,'Synthetic Degreaser');
 assert.equal(fields.product_name.sourceSection,1);
 assert.equal(fields.manufacturer.proposedValue,'Example Safety Products');
 assert.equal(fields.sds_date.proposedValue,'2026-09-28');
 assert.equal(fields.sds_date.sourceSection,16);
 assert.equal(fields.cas_numbers.proposedValue,'67-64-1');
 assert.equal(fields.cas_numbers.sourceSection,3);
 assert.equal(result.status,'ready');
});

test('candidate extraction rejects bad CAS checksums and leaves unknown fields unresolved',()=>{
 const result=analyzeSdsCandidate([{pageNumber:1,textSource:'ocr',text:'SECTION 3 Composition\nBad CAS 67-64-2'}]);
 const fields=Object.fromEntries(result.fields.map(row=>[row.fieldName,row]));
 assert.equal(fields.cas_numbers.proposedValue,null);
 assert.equal(fields.cas_numbers.confidence,'unresolved');
 assert.equal(result.status,'needs_review');
});

test('mixed candidates preserve field-level evidence methods',()=>{
 const result=analyzeSdsCandidate([
  {pageNumber:1,textSource:'embedded',text:'SECTION 1: Identification\nProduct Name: Embedded Cleaner'},
  {pageNumber:2,textSource:'ocr',text:'Manufacturer: OCR Safety Products'},
  {pageNumber:3,textSource:'embedded',text:'SECTION 3: Composition\nAcetone 67-64-1'},
  {pageNumber:4,textSource:'ocr',text:'Additional component 64-17-5'},
  {pageNumber:5,textSource:'embedded',text:'SECTION 16: Other information\nRevision date: 2026-09-28'}
 ]),fields=Object.fromEntries(result.fields.map(row=>[row.fieldName,row]));
 assert.equal(fields.product_name.method,'embedded');assert.equal(fields.product_name.sourcePage,1);
 assert.equal(fields.manufacturer.method,'ocr');assert.equal(fields.manufacturer.sourcePage,2);
 assert.equal(fields.sds_date.method,'embedded');assert.equal(fields.sds_date.sourcePage,5);
 assert.equal(fields.cas_numbers.method,'mixed');assert.equal(fields.cas_numbers.sourcePage,3);
});

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
 const folder=await mkdtemp(path.join(tmpdir(),'hazcom-bulk-import-'));const sql=nodeSqlite(path.join(folder,'author.db'),REPLICA_SCHEMA_SQL+migration3+migration4+migration5+migration6),files=await nodeFiles(path.join(folder,'attachments'));
 files.materialize=async(_sessionId,startPage,endPage)=>{const bytes=pdf(Array.from({length:endPage-startPage+1},(_,index)=>`Child page ${startPage+index}`));return {bytes,sha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length,pageCount:endPage-startPage+1,materializationVersion:1};};
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
  assert.equal(after.sds_import_page.filter(row=>row.ocr_status==='pending').length,4);assert.equal(after.sds_import_draft.filter(row=>row.approval_status==='unapproved').length,1);assert.equal(after.sds_import_field.length,4);
  await restarted.reviewSdsImportCandidate(after.sds_import_draft[0].id,{product_name:'Reviewed Cleaner',manufacturer:'Example Maker',sds_date:'2026-09-28',cas_numbers:'67-64-1'});
  const reviewed=await restarted.snapshot(),reviewFields=Object.fromEntries(reviewed.sds_import_field.map(row=>[row.field_name,row]));
  assert.equal(reviewed.sds_import_draft[0].extraction_status,'ready');assert.equal(reviewFields.product_name.reviewed_value,'Reviewed Cleaner');assert.equal(reviewFields.cas_numbers.review_status,'corrected');
  const candidateDraft=reviewed.sds_import_draft[0];await restarted.approveSdsImportCandidate(candidateDraft.id,{productId:'bulk-product-one',attachmentId:'bulk-sds-one'});
  const approved=await restarted.snapshot();assert.equal(approved.chemical_product.find(row=>row.id==='bulk-product-one').product_name,'Reviewed Cleaner');assert.equal(approved.attachments.find(row=>row.id==='bulk-sds-one').slot_key,'sds');assert.equal(approved.sds_import_materialization[0].source_start_page,1);assert.equal(approved.sds_import_materialization[0].source_end_page,4);assert.equal(approved.sds_import_draft[0].approval_status,'materialized');
  const publication=await buildPublication(f.sql,'company-a',f.files);assert.equal(publication.dataset.chemicalProducts.find(row=>row.id==='bulk-product-one').product_name,'Reviewed Cleaner');assert.equal(publication.attachments[0].attachmentId,'bulk-sds-one');assert.equal(publication.attachments[0].sha256,approved.sds_import_materialization[0].child_sha256);assert.equal(publication.attachments[0].sizeBytes,approved.sds_import_materialization[0].child_size_bytes);
  assert.equal(await restarted.approveSdsImportCandidate(candidateDraft.id,{productId:'bulk-product-one',attachmentId:'bulk-sds-one'}),'bulk-product-one');
  const other=await f.service('company-b').snapshot();assert.equal(other.sds_import_session.length,0);assert.equal(other.sds_import_draft.length,0);assert.equal(other.sds_import_page.length,0);
  await assert.rejects(f.service('company-b').splitSdsImportDraft('batch-one',after.sds_import_draft[0].id,2),/Company/);
 }finally{f.sql.close();}
});

test('failed child PDF verification creates no Product, attachment, or approval',async()=>{
 const f=await setup();try{
  const service=f.service('company-a');await service.importSdsBatch(pdf(['Safety Data Sheet SECTION 1 Identification']),'failed.pdf','failed-batch');let snapshot=await service.snapshot(),draft=snapshot.sds_import_draft[0];
  await service.reviewSdsImportCandidate(draft.id,{product_name:'Failed Cleaner',manufacturer:'Example',sds_date:'2026-09-28',cas_numbers:null});
  f.files.materialize=async()=>{const bytes=pdf(['child']);return {bytes,sha256:'0'.repeat(64),sizeBytes:bytes.length,pageCount:1,materializationVersion:1};};
  await assert.rejects(service.approveSdsImportCandidate(draft.id,{productId:'must-not-exist',attachmentId:'must-not-exist-sds'}),/hash mismatch/);
  snapshot=await service.snapshot();assert.equal(snapshot.chemical_product.some(row=>row.id==='must-not-exist'),false);assert.equal(snapshot.attachments.some(row=>row.id==='must-not-exist-sds'),false);assert.equal(snapshot.sds_import_materialization.length,0);assert.equal(snapshot.sds_import_draft[0].approval_status,'unapproved');
 }finally{f.sql.close();}
});

test('OCR processes only pending pages, persists results, and refreshes extraction across restart',async()=>{
 const f=await setup();let calls=0;f.files.ocrPage=async(_session,page)=>{calls++;return {rawText:page===1?'SECTION 1: Identification\nProduct Name: Scanned Cleaner\nManufacturer: OCR Safety Products':'SECTION 3: Composition\nAcetone 67-64-1\nSECTION 16: Other information\nRevision date: 2026-09-28',language:'en-US',ocrVersion:1};};
 try{const service=f.service('company-a');await service.importSdsBatch(pdf(['','']),'scan.pdf','ocr-batch');const results=await service.processSdsImportOcr('ocr-batch');assert.equal(results.length,2);assert.equal(calls,2);let snapshot=await f.service('company-a').snapshot();assert.equal(snapshot.sds_import_page.every(row=>row.ocr_status==='completed'&&row.text_source==='ocr'),true);const fields=Object.fromEntries(snapshot.sds_import_field.map(row=>[row.field_name,row]));assert.equal(fields.product_name.proposed_value,'Scanned Cleaner');assert.equal(fields.product_name.extraction_method,'ocr');assert.equal(fields.manufacturer.extraction_method,'ocr');assert.equal(fields.cas_numbers.proposed_value,'67-64-1');assert.equal(fields.sds_date.proposed_value,'2026-09-28');assert.deepEqual(await service.processSdsImportOcr('ocr-batch'),[]);assert.equal(calls,2);
 }finally{f.sql.close();}
});

test('OCR language failure remains manual and creates no authoritative data',async()=>{
 const f=await setup();f.files.ocrPage=async()=>{throw Error('OCR_LANGUAGE_SUPPORT_MISSING');};try{const service=f.service('company-a');await service.importSdsBatch(pdf(['']),'manual.pdf','manual-batch');const result=await service.ocrSdsImportPage('manual-batch',1);assert.equal(result.status,'manual_required');assert.equal(result.failureCode,'OCR_LANGUAGE_SUPPORT_MISSING');const snapshot=await service.snapshot();assert.equal(snapshot.sds_import_page[0].ocr_status,'manual_required');assert.equal(snapshot.sds_import_page[0].ocr_required,1);assert.equal(snapshot.chemical_product.length,0);assert.equal(snapshot.sds_import_draft[0].approval_status,'unapproved');}finally{f.sql.close();}
});

test('OCR preserves sparse embedded text on mixed pages and rejects unusable output safely',async()=>{
 const f=await setup();let output='SECTION 1: Identification\nProduct Name: Mixed Source Cleaner';f.files.ocrPage=async()=>({rawText:output,language:'en-US',ocrVersion:1});
 try{const service=f.service('company-a');await service.importSdsBatch(pdf(['Seed']),'mixed.pdf','mixed-batch');let result=await service.ocrSdsImportPage('mixed-batch',1);assert.equal(result.status,'completed');let snapshot=await service.snapshot(),page=snapshot.sds_import_page[0];assert.equal(page.text_source,'mixed');assert.match(page.raw_text,/Seed/);assert.match(page.raw_text,/Mixed Source Cleaner/);
  await service.importSdsBatch(pdf(['']),'unusable.pdf','unusable-batch');output='...';result=await service.ocrSdsImportPage('unusable-batch',1);assert.equal(result.status,'manual_required');assert.equal(result.failureCode,'OCR_TEXT_UNUSABLE');snapshot=await service.snapshot();page=snapshot.sds_import_page.find(row=>row.session_id==='unusable-batch');assert.equal(page.ocr_required,1);assert.equal(page.ocr_status,'manual_required');assert.equal(snapshot.chemical_product.length,0);
 }finally{f.sql.close();}
});
