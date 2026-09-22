import {mkdtemp,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {nodeSqlite,nodeFiles} from '../src/node.js';
import {REPLICA_SCHEMA_SQL,recordStatements} from '../src/sqlite.js';
import {normalizeDataset} from '../src/contract.js';
export const sizes={small:[5,20,10],medium:[30,250,100],large:[100,2000,500],stress:[250,5000,1500],stress:[250,5000,1500],stress:[250,5000,1500],stress:[250,5000,1500],stress:[250,5000,1500]};
// Original generated one-page PDF, no external content or copyrighted SDS.
export function dummyPdf(label) {
  const text=`BT /F1 12 Tf 40 740 Td (SYNTHETIC TEST ONLY - ${label}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${text.length} >>\nstream\n${text}\nendstream`];
  let output='%PDF-1.4\n'; const offsets=[0];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(output)); output+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xref=Buffer.byteLength(output);
  output+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(output));
}
export async function fixture(size='small',companyId=`fixture-${size}`) {
  const folder=await mkdtemp(path.join(tmpdir(),'hazcom-sync-'));
  const sql=nodeSqlite(path.join(folder,'author.db'),REPLICA_SCHEMA_SQL), files=await nodeFiles(path.join(folder,'author-files'));
  const [areas,products,workers]=sizes[size], data={};
  const id=(prefix,n)=>`${prefix}-${String(n).padStart(4,'0')}`;
  data.workAreas=Array.from({length:areas},(_,i)=>({id:id('area',i),name:`Shop ${i}`,location:`Building ${i%4}`,poc_name:'Synthetic Safety Contact',poc_email:'safety@example.test',poc_phone_number:'555-0100',description:'Synthetic maintenance, storage and handling area.'}));
  data.chemicalProducts=Array.from({length:products},(_,i)=>({id:id('product',i),product_name:`Synthetic Cleaner ${i}`,manufacturer:'Example Test Manufacturer',sds_date:'2026-01-01',chemical_names:'Test mixture',cas_numbers:null}));
  data.workers=Array.from({length:workers},(_,i)=>({id:id('worker',i),name:`Synthetic Worker ${i}`,email:`worker${i}@example.test`,phone:null}));
  data.workAreaProducts=Array.from({length:products*2},(_,i)=>({id:id('area-product',i),quantity:`${i%10+1} bottles`,storage_location:`Cabinet ${i%8}`,added_date:'2026-01-02',workAreaId:id('area',i%areas),chemicalProductId:id('product',Math.floor(i/2))}));
  data.workAreaAssignments=Array.from({length:workers*2},(_,i)=>({id:id('assignment',i),assigned_date:'2026-01-02',training_required_since:'2026-01-02',ended_date:null,workAreaId:id('area',i%areas),workerId:id('worker',Math.floor(i/2))}));
  data.sdsVerifications=Array.from({length:products},(_,i)=>({id:id('verification',i),verified_at:'2026-01-03',chemicalProductId:id('product',i)}));
  data.hazcomReviews=Array.from({length:areas},(_,i)=>({id:id('review',i),review_date:'2026-01-03',workAreaId:id('area',i)}));
  data.trainingEvents=Array.from({length:workers*2},(_,i)=>({id:id('training',i),training_date:'2026-01-04',assignmentId:id('assignment',i)}));
  const dataset=normalizeDataset(data), company={id:companyId,name:`Synthetic ${size} Company`,contact_email:'safety@example.test'}, attachments=[];
  for(let i=0;i<products;i++) {const bytes=dummyPdf(`Product ${i}`); attachments.push({attachmentId:id('sds',i),ownerType:'chemical_product',ownerId:id('product',i),localPath:await files.stage('source',id('sds',i),bytes),sizeBytes:bytes.length});}
  await sql.batch(recordStatements(company,dataset,attachments));
  return {folder,sql,files,dataset,company,attachments,async dbSize(){sql.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); return (await stat(path.join(folder,'author.db'))).size;}};
}
