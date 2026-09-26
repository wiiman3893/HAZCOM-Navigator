import {publicationPlan} from '@hazcom/sync';

export type PublicationIssue={level:'WARNING'|'BLOCKING';message:string};
export type PublicationProgress={phase:'preparing'|'chunks'|'sds'|'validation'|'finalizing'|'published';completed?:number;total?:number};
export type PublishedRevision={revisionId:string;revisionNumber:number;publishedAt:string|null;recordCounts:Record<string,number>;attachmentCount:number;fingerprint:string|null;manifestHash?:string|null;contentHash?:string|null};
export type PublicationContext={uid:string;companyId:string;companyName:string;companyEmail:string;role:string;canPublish:boolean;coverageStatus:string;currentRevisionId:string|null;currentRevisionNumber:number|null;published:PublishedRevision|null};
export type Projection={company:{id:string;name:string;contact_email:string};dataset:Record<string,unknown[]>;attachments:Array<{attachmentId:string;ownerId:string;localPath:string;sha256:string;sizeBytes:number}>;fingerprint:string;metrics:{records:number;attachments:number}};
export type Attempt={revisionId:string;parentRevisionId:string|null;fingerprint:string;status:'pending'|'published'};
export type Readiness={state:'READY'|'WARNING'|'BLOCKING';issues:PublicationIssue[];context:PublicationContext|null;projection:Projection|null;current:PublishedRevision|null;localChanges:boolean|null;attempt:Attempt|null};
export type PublicationDeps={
 context:(companyId:string)=>Promise<PublicationContext>;
 projection:(companyId:string)=>Promise<Projection>;
 getAttempt:(companyId:string)=>Promise<Attempt|null>;
 setAttempt:(companyId:string,value:Attempt)=>Promise<void>;
 getPublishedLocal:(companyId:string)=>Promise<PublishedRevision|null>;
 setPublishedLocal:(companyId:string,value:PublishedRevision)=>Promise<void>;
 publish:(input:{projection:Projection;revisionId:string;parentRevisionId:string|null;onProgress:(progress:PublicationProgress)=>void;signal?:AbortSignal})=>Promise<{revisionId:string;revisionNumber:number;publishedAt?:unknown;recordCounts?:Record<string,number>;attachmentCount?:number}>;
 revisionId:()=>string;
 log?:(event:Record<string,unknown>)=>void;
};

export function publicationError(error:unknown):string {
 const message=error instanceof Error?error.message:String(error);
 const code=(error as {code?:string})?.code;
 if(/SDS.*(cannot be read|ENOENT|not found)|(?:The system cannot find the file specified|os error 2)/i.test(message))return 'An SDS file is missing from this computer. Reattach it before publishing.';
 if(/SDS.*(hash mismatch|size mismatch|changed)|SDS declared size mismatch|Uploaded SDS integrity mismatch/i.test(message))return 'An SDS file changed after it was attached. Reattach or verify it before publishing.';
 if(/stale|older cloud revision|parent.*revision/i.test(message))return 'This publication is based on an older cloud revision. Run the readiness check again.';
 if(/Changed data requires a new revision|Manifest changed/i.test(message))return 'The local draft changed during a prior attempt. Run the readiness check to start a new publication.';
 if(/expired|abandoned/i.test(message))return 'This publication can no longer be resumed. Run the readiness check to start a new attempt.';
 if(/permission-denied|unauthenticated|membership/i.test(message)||code==='functions/permission-denied')return 'Your Company access changed. Refresh access before publishing.';
 if(/network|unavailable|deadline|fetch/i.test(message)||['functions/unavailable','functions/deadline-exceeded','network-error'].includes(code??''))return 'The connection was interrupted. Retry Publication when connected.';
 return message;
}

export function createPublicationWorkflow(deps:PublicationDeps){
 let running=false;
 const log=(event:Record<string,unknown>)=>deps.log?.(event);
 async function check(companyId:string):Promise<Readiness>{
  const issues:PublicationIssue[]=[];
  const block=(message:string)=>issues.push({level:'BLOCKING',message});
  const warn=(message:string)=>issues.push({level:'WARNING',message});
  let context:PublicationContext|null=null,projection:Projection|null=null,attempt:Attempt|null=null,localChanges:boolean|null=null,contentHash:string|null=null;
  try{context=await deps.context(companyId);}catch(error){block(publicationError(error));}
  if(context){
   if(context.companyId!==companyId)block('The active Company changed. Select the Company again.');
   if(!['administrator','manager'].includes(context.role))block('Only a Company Administrator or HAZCOM Manager can publish.');
   if(!context.canPublish)block(context.coverageStatus==='grace'?'Your subscription is in its read/export period. Publication is unavailable.':context.coverageStatus==='expired'?'Company coverage is inactive. Publication is unavailable.':'Your current plan does not allow publication.');
   try{
    projection=await deps.projection(companyId);
    if(projection.company.id!==companyId)block('The local draft belongs to a different Company.');
    else if(projection.company.name!==context.companyName||projection.company.contact_email!==context.companyEmail)block('Company settings changed in the cloud. Refresh this workspace before publishing.');
    else {
     contentHash=(await publicationPlan(projection,deps.revisionId(),context.currentRevisionId,context.uid)).manifest.contentHash;
     if(!projection.dataset.workAreas?.length)warn('This draft has no Work Areas.');
     if(!projection.dataset.chemicalProducts?.length)warn('This draft has no Chemical Products.');
     if(projection.dataset.chemicalProducts?.length>projection.attachments.length)warn('Some Chemical Products have no SDS attached. The current publication contract permits this.');
    }
   }catch(error){block(publicationError(error));}
   attempt=await deps.getAttempt(companyId);
   if(attempt?.status==='pending'&&attempt.revisionId===context.currentRevisionId){
    if(projection?.fingerprint===attempt.fingerprint&&context.published?.manifestHash){
     const plan=await publicationPlan(projection,attempt.revisionId,attempt.parentRevisionId,context.uid);
     if(plan.manifestHash===context.published.manifestHash){
      await deps.setPublishedLocal(companyId,{...context.published,fingerprint:projection.fingerprint});
      await deps.setAttempt(companyId,{...attempt,status:'published'});
      attempt=null;
     }else block('The current cloud revision differs from the interrupted publication. Contact support before trying again.');
    }else block('An interrupted publication is current in the cloud but cannot be verified against this draft. Contact support before trying again.');
   }
   const local=await deps.getPublishedLocal(companyId);
   localChanges=context.published?.contentHash&&contentHash?context.published.contentHash!==contentHash:
    local&&context.currentRevisionId===local.revisionId&&projection?local.fingerprint!==projection.fingerprint:null;
   if(attempt?.status==='published')attempt=null;
   if(attempt?.status==='pending'&&(attempt.parentRevisionId!==context.currentRevisionId||attempt.fingerprint!==projection?.fingerprint)){
    warn('A previous publication attempt cannot be resumed with this draft and cloud revision. A new attempt will be created.');
    attempt=null;
   }
  }
  const state=issues.some(i=>i.level==='BLOCKING')?'BLOCKING':issues.length?'WARNING':'READY';
  log({companyId,stage:'readiness',state,recordCount:projection?.metrics.records,attachmentCount:projection?.metrics.attachments});
  return {state,issues,context,projection,current:context?.published??null,localChanges,attempt};
 }
 async function run(ready:Readiness,onProgress:(progress:PublicationProgress)=>void,signal?:AbortSignal){
  if(running)throw Error('A publication is already running.');
  if(ready.state==='BLOCKING'||!ready.context||!ready.projection)throw Error('Run a successful readiness check before publishing.');
  running=true;
  const {context,projection}=ready;
  let stage='preparing';
  let attempt=ready.attempt??{revisionId:deps.revisionId(),parentRevisionId:context.currentRevisionId,fingerprint:projection.fingerprint,status:'pending' as const};
  try{
   const fresh=await deps.context(context.companyId);
   if(fresh.uid!==context.uid||fresh.companyId!==context.companyId||!fresh.canPublish||!['administrator','manager'].includes(fresh.role)||fresh.currentRevisionId!==context.currentRevisionId)throw Error('The Company, permission, or cloud revision changed. Run the readiness check again.');
   const now=await deps.projection(context.companyId);
   if(now.fingerprint!==projection.fingerprint)throw Error('The local draft changed. Run the readiness check again.');
   if(ready.current?.revisionId===context.currentRevisionId&&ready.localChanges===false)throw Error('This local draft is already the current published revision.');
   await deps.setAttempt(context.companyId,attempt);
   onProgress({phase:'preparing'});
   log({companyId:context.companyId,revisionId:attempt.revisionId,stage:'begin',retry:!!ready.attempt,recordCount:projection.metrics.records,attachmentCount:projection.metrics.attachments});
   const result=await deps.publish({projection,revisionId:attempt.revisionId,parentRevisionId:attempt.parentRevisionId,signal,onProgress:p=>{stage=p.phase;onProgress(p);}});
   stage='finalizing';
   if(result.revisionId!==attempt.revisionId)throw Error('Published revision could not be confirmed as the current Company revision.');
   let updated=await deps.context(context.companyId);
   // The finalization reply can arrive before the read path observes the new pointer.
   for(let retry=0;updated.currentRevisionId!==attempt.revisionId&&retry<4;retry++){
    await new Promise(resolve=>setTimeout(resolve,200*(retry+1)));
    updated=await deps.context(context.companyId);
   }
   if(updated.currentRevisionId!==attempt.revisionId)throw Error('Published revision could not be confirmed as the current Company revision.');
   const published=updated.published??{revisionId:result.revisionId,revisionNumber:result.revisionNumber,publishedAt:typeof result.publishedAt==='string'?result.publishedAt:null,recordCounts:result.recordCounts??Object.fromEntries(Object.entries(projection.dataset).map(([k,v])=>[k,v.length])),attachmentCount:result.attachmentCount??projection.attachments.length,fingerprint:null};
   const local={...published,fingerprint:projection.fingerprint};
   await deps.setPublishedLocal(context.companyId,local);
   await deps.setAttempt(context.companyId,{...attempt,status:'published'});
   onProgress({phase:'published'});
   log({companyId:context.companyId,revisionId:attempt.revisionId,stage:'published',recordCount:projection.metrics.records,attachmentCount:projection.metrics.attachments});
   return local;
  }catch(error){log({companyId:context.companyId,revisionId:attempt.revisionId,stage,failureCategory:publicationError(error),retry:true});throw error;}
  finally{running=false;}
 }
 return {check,run};
}
