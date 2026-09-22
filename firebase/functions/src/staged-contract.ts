import {createHash} from 'node:crypto';
import {object,keys,id,text,date,companyFields,schemas,fail} from './validation.js';

export const STAGED_LIMITS={chunkRecords:100,filePlanRecords:50,chunkBytes:256_000,manifestBytes:512_000,chunks:1000,records:100_000,attachments:20_000,pdfBytes:5*1024*1024,validationChunks:4} as const;
export const entityKinds=Object.keys(schemas);
export const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const bytesHash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function assert(ok:unknown,message:string):asserts ok {if(!ok)fail(message);}
export function integer(value:unknown,max:number) {assert(Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=max,'Invalid count/size');return Number(value);}
export function sha(value:unknown) {assert(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'Invalid SHA-256');return value;}
export function attachment(raw:unknown) {
  const a=object(raw);keys(a,['attachmentId','ownerType','ownerId','slotKey','sha256','sizeBytes']);
  assert(a.ownerType==='chemical_product'&&a.slotKey==='sds','Invalid SDS owner/slot');
  const sizeBytes=integer(a.sizeBytes,STAGED_LIMITS.pdfBytes);assert(sizeBytes>0,'Empty SDS');
  return {attachmentId:id(a.attachmentId),ownerType:'chemical_product',ownerId:id(a.ownerId),slotKey:'sds',sha256:sha(a.sha256),sizeBytes};
}
export function rows(kind:string,value:unknown):Record<string,any>[] {
  assert(entityKinds.includes(kind),'Unknown entity kind');assert(Array.isArray(value)&&value.length<=STAGED_LIMITS.chunkRecords,'Too many chunk rows');
  const s=schemas[kind],seen=new Set<string>();
  return value.map(raw=>{
    const r=object(raw),fields=['id',...s.required,...s.optional??[],...(kind==='trainingEvents'?['workerId']:[])];keys(r,fields);
    const stable=id(r.id);assert(!seen.has(stable),'Duplicate row ID');seen.add(stable);
    const out:Record<string,any>={id:stable};
    for(const field of [...s.required,...s.optional??[]]) {
      const v=r[field];
      out[field]=v==null&&s.optional?.includes(field)?null:s.refs?.[field]?id(v):s.dates?.includes(field)?date(v):text(v,field,field==='description'?8000:1000,true);
    }
    if(kind==='trainingEvents')out.workerId=id(r.workerId);
    if(kind==='workAreaAssignments')assert(!out.ended_date||out.ended_date>=out.assigned_date,'Assignment ends before start');
    return out;
  });
}
export function chunkRows(kind:string,value:unknown):Record<string,any>[] {
  assert(Array.isArray(value),'Expected chunk rows');
  assert(Buffer.byteLength(JSON.stringify(value))<=STAGED_LIMITS.chunkBytes,'Chunk byte limit exceeded');
  const result:Record<string,any>[]=kind==='attachments'?value.map(attachment):rows(kind,value);
  assert(result.length>0&&result.length<=(kind==='attachments'?STAGED_LIMITS.filePlanRecords:STAGED_LIMITS.chunkRecords),'Invalid chunk count');
  const key=kind==='attachments'?'attachmentId':'id';
  for(let i=1;i<result.length;i++)assert(result[i-1][key]<result[i][key],'Chunk IDs must be strictly ordered');
  return result;
}
export function descriptor(kind:string,chunkId:string,records:Record<string,any>[]) {
  const key=kind==='attachments'?'attachmentId':'id';
  return {chunkId,kind,count:records.length,firstId:records[0][key],lastId:records.at(-1)![key],bytes:Buffer.byteLength(JSON.stringify(records)),sha256:hash(records)};
}
export function manifest(raw:unknown,uid:string) {
  const m=object(raw);keys(m,['schemaVersion','companyId','revisionId','parentRevisionId','creatorUid','company','recordCounts','attachmentCount','chunks','contentHash']);
  assert(Buffer.byteLength(JSON.stringify(m))<=STAGED_LIMITS.manifestBytes,'Manifest byte limit exceeded');
  assert(m.schemaVersion===2&&m.creatorUid===uid,'Manifest identity/schema mismatch');
  const companyId=id(m.companyId),revisionId=id(m.revisionId),parentRevisionId=m.parentRevisionId==null?null:id(m.parentRevisionId);
  const c=object(m.company);keys(c,['id','name','contact_email']);assert(c.id===companyId,'Cross-Company manifest');
  const company={id:companyId,...companyFields({name:c.name,contact_email:c.contact_email})};
  const counts=object(m.recordCounts);keys(counts,entityKinds);
  const recordCounts=Object.fromEntries(entityKinds.map(k=>[k,integer(counts[k],STAGED_LIMITS.records)]));
  assert(Object.values(recordCounts).reduce((a,b)=>a+b,0)<=STAGED_LIMITS.records,'Staged record safety ceiling exceeded');
  const attachmentCount=integer(m.attachmentCount,STAGED_LIMITS.attachments);
  assert(Array.isArray(m.chunks)&&m.chunks.length<=STAGED_LIMITS.chunks,'Manifest chunk safety ceiling exceeded');
  const seen=new Set(),last:Record<string,string>={},totals:Record<string,number>=Object.fromEntries([...entityKinds,'attachments'].map(k=>[k,0]));
  let previousKind=-1;
  const chunks=m.chunks.map((raw:unknown,index:number)=>{
    const d=object(raw);keys(d,['chunkId','kind','count','firstId','lastId','bytes','sha256']);
    const kindIndex=[...entityKinds,'attachments'].indexOf(d.kind);assert(kindIndex>=previousKind&&kindIndex>=0,'Noncanonical chunk kind order');previousKind=kindIndex;
    const chunkId=id(d.chunkId);assert(chunkId===`chunk-${String(index).padStart(5,'0')}`&&!seen.has(chunkId),'Noncanonical chunk ID');seen.add(chunkId);
    const count=integer(d.count,d.kind==='attachments'?STAGED_LIMITS.filePlanRecords:STAGED_LIMITS.chunkRecords);assert(count>0,'Empty chunk');
    const firstId=id(d.firstId),lastId=id(d.lastId);assert(firstId<=lastId&&(!last[d.kind]||last[d.kind]<firstId),'Overlapping chunk ID ranges');last[d.kind]=lastId;
    totals[d.kind]+=count;
    return {chunkId,kind:d.kind,count,firstId,lastId,bytes:integer(d.bytes,STAGED_LIMITS.chunkBytes),sha256:sha(d.sha256)};
  });
  assert(entityKinds.every(k=>totals[k]===recordCounts[k])&&totals.attachments===attachmentCount,'Manipulated manifest totals');
  const contentHash=hash({company,recordCounts,attachmentCount,chunks});assert(contentHash===m.contentHash,'Manifest content hash mismatch');
  return {schemaVersion:2,companyId,revisionId,parentRevisionId,creatorUid:uid,company,recordCounts,attachmentCount,chunks,contentHash};
}
export const storagePath=(c:string,r:string,a:Record<string,any>)=>`companies/${id(c)}/revisions-v2/${id(r)}/sds/${id(a.attachmentId)}/${sha(a.sha256)}.pdf`;
