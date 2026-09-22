import {capacity,demand,digest,sha256,pdf,attachmentPath,stableId} from './contract.js';
const cancelled=signal=>{if(signal?.aborted) throw new Error('Publication cancelled; staging retained for retry');};
const base64=bytes=>{let text=''; for(let i=0;i<bytes.length;i+=32768) text+=String.fromCharCode(...bytes.subarray(i,i+32768)); return btoa(text);};

// journal.put must durably persist before returning. Serialize invocations per revision.
/** @param {{projection:any,revisionId:string,parentRevisionId?:string|null,transport:any,files:any,journal:any,signal?:AbortSignal,attempts?:number}} options */
export async function publish({projection,revisionId,parentRevisionId=null,transport,files,journal,signal,attempts=3}) {
  stableId(revisionId); if(parentRevisionId!==null) stableId(parentRevisionId);
  const issues=capacity(projection.dataset,projection.attachments).violations;
  demand(!issues.length,issues.join('; '));
  const {company,dataset,attachments}=projection;
  const fingerprint=await digest({company,dataset,attachments:attachments.map(({localPath,...a})=>a)});
  demand(fingerprint===projection.fingerprint,'Projection changed after build');
  const key=`${company.id}/${revisionId}`, previous=await journal.get(key);
  demand(!previous || (previous.fingerprint===fingerprint && previous.parentRevisionId===parentRevisionId),'Changed data requires a new revision ID');
  const state=previous??{companyId:company.id,revisionId,parentRevisionId,fingerprint,status:'pending'};
  await journal.put(key,state);
  cancelled(signal);
  if(transport.access) {
    const access=await transport.access(company.id);
    demand(access.active && access.companyId===company.id && ['manager','administrator'].includes(access.role),'Active Company authoring membership required');
    demand(access.company?.name===company.name && access.company?.contact_email===company.contact_email,'Local Company details differ from authoritative Company; refresh Company context');
  }
  const invoke=async(name,data)=>{
    for(let n=0;;n++) {
      cancelled(signal);
      try {return await transport.call(name,data);} catch(error) {
        if(n+1>=attempts || !['functions/unavailable','functions/deadline-exceeded','unavailable','network-error'].includes(error.code)) throw error;
        await new Promise(resolve=>setTimeout(resolve,Math.min(100*2**n,1000)));
      }
    }
  };
  const context={companyId:company.id,revisionId};
  const pending=await invoke('beginPublication',{...context,parentRevisionId});
  if(pending.status!=='published') for(const a of attachments) {
    cancelled(signal);
    const bytes=await files.read(a.localPath); pdf(bytes);
    demand(bytes.length===a.sizeBytes && await sha256(bytes)===a.sha256,'SDS changed after projection; rebuild with a new revision');
    const received=await invoke('uploadPublicationSds',{...context,attachmentId:a.attachmentId,chemicalProductId:a.ownerId,base64:base64(bytes)});
    demand(received.sha256===a.sha256 && received.sizeBytes===a.sizeBytes && received.ownerId===a.ownerId && received.relativePath===attachmentPath(company.id,revisionId,a),'Uploaded SDS metadata mismatch');
  }
  cancelled(signal);
  const result=await invoke('finalizePublication',{...context,dataset,attachmentIds:attachments.map(a=>a.attachmentId)});
  // Cancellation after server commit cannot undo publication. Persist the acknowledged result.
  await journal.put(key,{...state,status:'published',result});
  return result;
}
