import {kinds,serverRows,demand,digest,jsonBytes,stableId,compareId} from './contract.js';
export const stagedLimits=Object.freeze({chunkRecords:100,filePlanRecords:50,chunkBytes:256_000,manifestBytes:512_000,chunks:1000,records:100_000,attachments:20_000,pdfBytes:5*1024*1024});
export const expectedAttachment=a=>({attachmentId:a.attachmentId,ownerType:a.ownerType,ownerId:a.ownerId,slotKey:a.slotKey,sha256:a.sha256,sizeBytes:a.sizeBytes});
export const stagedAttachmentPath=(c,r,a)=>`companies/${stableId(c)}/revisions-v2/${stableId(r)}/sds/${stableId(a.attachmentId)}/${a.sha256}.pdf`;
export async function chunkDescriptor(kind,chunkId,rows) {
  const key=kind==='attachments'?'attachmentId':'id';
  return {chunkId,kind,count:rows.length,firstId:rows[0][key],lastId:rows.at(-1)[key],bytes:jsonBytes(rows),sha256:await digest(rows)};
}
export async function publicationPlan(projection,revisionId,parentRevisionId,creatorUid) {
  stableId(revisionId);if(parentRevisionId!==null)stableId(parentRevisionId);stableId(creatorUid);
  const dataset=serverRows(projection.dataset),attachmentRows=projection.attachments.map(expectedAttachment).sort((a,b)=>a.attachmentId<b.attachmentId?-1:1);
  const recordCounts=Object.fromEntries(kinds.map(k=>[k,dataset[k].length]));
  demand(Object.values(recordCounts).reduce((a,b)=>a+b,0)<=stagedLimits.records,'Staged record safety ceiling exceeded');
  demand(attachmentRows.length<=stagedLimits.attachments,'Staged attachment safety ceiling exceeded');
  const chunks=[];
  for(const [kind,values] of [...Object.entries(dataset),['attachments',attachmentRows]]) {
    let rows=[],bytes=2;
    const flush=async()=>{if(!rows.length)return;const chunkId=`chunk-${String(chunks.length).padStart(5,'0')}`;chunks.push({descriptor:await chunkDescriptor(kind,chunkId,rows),rows});rows=[];bytes=2;};
    for(const row of values) {
      const rowBytes=jsonBytes(row);demand(rowBytes+2<=stagedLimits.chunkBytes,'Single record exceeds chunk bound');
      if(rows.length===(kind==='attachments'?stagedLimits.filePlanRecords:stagedLimits.chunkRecords)||bytes+rowBytes+(rows.length?1:0)>stagedLimits.chunkBytes)await flush();
      bytes+=rowBytes+(rows.length?1:0);rows.push(row);
    }
    await flush();
  }
  demand(chunks.length<=stagedLimits.chunks,'Staged chunk safety ceiling exceeded');
  const descriptors=chunks.map(c=>c.descriptor),attachmentCount=attachmentRows.length,company=projection.company;
  const contentHash=await digest({company,recordCounts,attachmentCount,chunks:descriptors});
  const manifest={schemaVersion:2,companyId:company.id,revisionId,parentRevisionId,creatorUid,company,recordCounts,attachmentCount,chunks:descriptors,contentHash};
  demand(jsonBytes(manifest)<=stagedLimits.manifestBytes,'Manifest byte safety ceiling exceeded');
  return {manifest,manifestHash:await digest(manifest),chunks};
}
// Wait for all in-flight operations before reporting the first failure/cancellation.
export async function parallel(items,concurrency,fn) {
  demand(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=8,'Concurrency must be 1..8');
  let next=0,failure;const result=new Array(items.length);
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(!failure&&next<items.length){const i=next++;try{result[i]=await fn(items[i],i);}catch(error){failure=error;}}}));
  if(failure)throw failure;return result;
}
export async function verifyPublishedPlan(plan,metadata,dataset,attachments) {
  // Firestore map field order is not a wire guarantee. Reconstruct the canonical hash layout.
  plan={schemaVersion:plan.schemaVersion,companyId:plan.companyId,revisionId:plan.revisionId,parentRevisionId:plan.parentRevisionId,creatorUid:plan.creatorUid,company:{id:plan.company.id,name:plan.company.name,contact_email:plan.company.contact_email},recordCounts:Object.fromEntries(kinds.map(k=>[k,plan.recordCounts[k]])),attachmentCount:plan.attachmentCount,chunks:plan.chunks.map(d=>({chunkId:d.chunkId,kind:d.kind,count:d.count,firstId:d.firstId,lastId:d.lastId,bytes:d.bytes,sha256:d.sha256})),contentHash:plan.contentHash};
  demand(plan.schemaVersion===2&&plan.companyId===metadata.companyId&&plan.revisionId===metadata.revisionId&&plan.parentRevisionId===metadata.parentRevisionId&&plan.creatorUid===metadata.createdByAccountId,'Manifest revision/creator mismatch');
  demand(await digest(plan)===metadata.manifestHash,'Published manifest hash mismatch');
  demand(await digest({company:plan.company,recordCounts:plan.recordCounts,attachmentCount:plan.attachmentCount,chunks:plan.chunks})===metadata.contentHash,'Published content hash mismatch');
  demand(['id','name','contact_email'].every(k=>plan.company[k]===metadata.company[k]),'Manifest Company mismatch');
  const grouped={...dataset,attachments:attachments.map(expectedAttachment).sort((a,b)=>a.attachmentId<b.attachmentId?-1:1)},seen=Object.fromEntries([...kinds,'attachments'].map(k=>[k,0]));
  for(const d of plan.chunks) {
    const key=d.kind==='attachments'?'attachmentId':'id',rows=grouped[d.kind].filter(r=>r[key]>=d.firstId&&r[key]<=d.lastId);
    demand(rows.length&&await digest(await chunkDescriptor(d.kind,d.chunkId,rows))===await digest(d),'Published chunk integrity mismatch');seen[d.kind]+=rows.length;
  }
  demand(Object.entries(grouped).every(([kind,rows])=>seen[kind]===rows.length),'Published manifest incomplete');
}
