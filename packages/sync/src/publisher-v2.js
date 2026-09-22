import {demand,digest,sha256,pdf} from './contract.js';
import {publicationPlan,parallel,stagedAttachmentPath} from './staged.js';
/** @param {{projection:any,revisionId:string,parentRevisionId?:string|null,transport:any,files:any,journal:any,signal?:AbortSignal,attempts?:number,concurrency?:number,onProgress?:(state:any)=>void}} options */
export async function publish({projection,revisionId,parentRevisionId=null,transport,files,journal,signal,attempts=3,concurrency=4,onProgress=()=>{}}) {
  const cancelled=()=>{if(signal?.aborted)throw Error('Publication cancelled; staged work retained for resume');};
  cancelled();
  const {company,dataset,attachments}=projection;
  const fingerprint=await digest({company,dataset,attachments:attachments.map(({localPath,...a})=>a)});
  demand(fingerprint===projection.fingerprint,'Projection changed after build');
  const key=`${company.id}/${revisionId}`,old=await journal.get(key);
  demand(!old||(old.fingerprint===fingerprint&&old.parentRevisionId===parentRevisionId),'Changed data requires a new revision ID');
  const retry=async fn=>{for(let attempt=0;;attempt++){cancelled();try{return await fn();}catch(error){if(attempt+1>=attempts||!['functions/unavailable','functions/deadline-exceeded','functions/resource-exhausted','functions/internal','unavailable','network-error'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(200*2**attempt,2000)));}}};
  const access=await retry(()=>transport.access(company.id));
  demand(access.active&&['manager','administrator'].includes(access.role)&&access.companyId===company.id,'Active Company authoring membership required');
  demand(access.company?.name===company.name&&access.company?.contact_email===company.contact_email,'Refresh authoritative Company context');
  const plan=await publicationPlan(projection,revisionId,parentRevisionId,access.uid);
  demand(!old?.manifestHash||old.manifestHash===plan.manifestHash,'Manifest changed; use a new revision ID');
  const state={schemaVersion:2,companyId:company.id,revisionId,parentRevisionId,fingerprint,manifestHash:plan.manifestHash,status:'pending'};
  await journal.put(key,state);
  const context={companyId:company.id,revisionId},invoke=(name,data)=>retry(()=>transport.call(name,data));
  const metrics={chunkUploadMs:0,sdsUploadMs:0,validationMs:0,finalizationMs:0,chunksUploaded:0,filesUploaded:0,validationWork:{recordReads:0,referenceReads:0,storageMetadataReads:0}};
  const begin=await invoke('beginStagedPublication',{manifest:plan.manifest,manifestHash:plan.manifestHash});
  let status=begin.status;
  if(status==='staging') {
    const completed=async kind=>{const ids=new Set();let afterId=null;do{const page=await invoke('getPublicationProgress',{...context,kind,afterId});demand(page.manifestHash===plan.manifestHash,'Resume manifest mismatch');page.completedIds.forEach(id=>ids.add(id));afterId=page.afterId;}while(afterId);return ids;};
    const chunkIds=await completed('chunks');let start=performance.now();
    await parallel(plan.chunks.filter(c=>!chunkIds.has(c.descriptor.chunkId)),concurrency,async c=>{await invoke('stagePublicationChunk',{...context,manifestHash:plan.manifestHash,chunkId:c.descriptor.chunkId,rows:c.rows});metrics.chunksUploaded++;onProgress({phase:'chunks',completed:chunkIds.size+metrics.chunksUploaded,total:plan.chunks.length});});
    metrics.chunkUploadMs=performance.now()-start;
    const fileIds=await completed('attachments');start=performance.now();
    await parallel(attachments.filter(a=>!fileIds.has(a.attachmentId)),concurrency,async a=>{
      cancelled();const bytes=await files.read(a.localPath);pdf(bytes);
      demand(bytes.length===a.sizeBytes&&await sha256(bytes)===a.sha256,'SDS changed after projection; use a new revision');
      const received=await retry(()=>transport.uploadSds({...context,attachmentId:a.attachmentId},bytes));
      demand(received.verified===true&&received.sha256===a.sha256&&received.sizeBytes===a.sizeBytes&&received.ownerId===a.ownerId&&received.relativePath===stagedAttachmentPath(company.id,revisionId,a),'Uploaded SDS integrity mismatch');
      metrics.filesUploaded++;onProgress({phase:'sds',completed:fileIds.size+metrics.filesUploaded,total:attachments.length});
    });
    metrics.sdsUploadMs=performance.now()-start;
    status=(await invoke('sealPublication',{...context,manifestHash:plan.manifestHash})).status;
  }
  let start=performance.now();
  while(status==='sealed') {
    const page=await invoke('validatePublicationPage',{...context,manifestHash:plan.manifestHash});status=page.status;
    for(const k of Object.keys(metrics.validationWork))metrics.validationWork[k]+=page.work?.[k]??0;
    onProgress({phase:'validation',completed:page.validationCursor,total:plan.chunks.length});
  }
  metrics.validationMs=performance.now()-start;start=performance.now();
  const result=await invoke('finalizeStagedPublication',{...context,manifestHash:plan.manifestHash});metrics.finalizationMs=performance.now()-start;
  await journal.put(key,{...state,status:'published',result});
  return {...result,metrics};
}
