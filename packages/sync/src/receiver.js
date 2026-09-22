import {stagedAttachmentPath,stagedLimits,verifyPublishedPlan,parallel} from './staged.js';
import {kinds,normalizeDataset,demand,digest,sha256,pdf,attachmentPath,stableId,limits} from './contract.js';
import {scopeKey} from './sqlite.js';
const personal=new Set(['workers','workAreaAssignments','trainingEvents']);
function sameAccess(a,b) { demand(scopeKey(a)===scopeKey(b),'Membership changed during sync'); demand(a.currentRevisionId===b.currentRevisionId && a.currentRevisionNumber===b.currentRevisionNumber,'Revision changed during sync'); }
function checkAccess(a,companyId) { demand(a.companyId===companyId && a.active===true && ['manager','administrator','member'].includes(a.role),'Inactive Company membership'); }

export function receiver({transport,replica,files,fileConcurrency=1}) {
  // A service instance serializes downloads and local activation. SQLite CAS also protects other instances.
  let tail=Promise.resolve();
  const serial=fn=>{const next=tail.then(fn); tail=next.catch(()=>{}); return next;};
  return {
    sync:companyId=>serial(async()=>{
      stableId(companyId);
      const access=await transport.access(companyId); checkAccess(access,companyId);
      const previous=await replica.state();
      demand(!previous || (previous.uid===access.uid && previous.companyId===companyId),'Replica belongs to another account or Company');
      if(!access.currentRevisionId) return {changed:false,reason:'no-publication'};
      if(previous?.revisionId===access.currentRevisionId && previous.scope===scopeKey(access)) return {changed:false};
      const revisionId=stableId(access.currentRevisionId), metadata=await transport.metadata(companyId,revisionId);
      demand(metadata.status==='published' && [1,2].includes(metadata.schemaVersion) && metadata.companyId===companyId && metadata.company?.id===companyId && metadata.revisionId===revisionId && metadata.revisionNumber===access.currentRevisionNumber,'Revision identity mismatch');
      const raw={};
      for(const kind of kinds) raw[kind]=await transport.records(companyId,revisionId,kind,access);
      const dataset=normalizeDataset(raw,{published:true});
      for(const kind of kinds) {
        const count=metadata.recordCounts?.[kind]; demand(Number.isInteger(count) && count>=0,'Invalid revision counts');
        demand(access.role==='member'&&personal.has(kind)?dataset[kind].length<=count:dataset[kind].length===count,`Incomplete ${kind}`);
      }
      if(access.role==='member') {
        demand(dataset.workers.every(w=>w.id===access.workerId) && dataset.workAreaAssignments.every(a=>a.workerId===access.workerId) && dataset.trainingEvents.every(e=>e.workerId===access.workerId),'Unauthorized personal data');
      }
      const attachments=await transport.attachments(companyId,revisionId,metadata);
      demand(Number.isInteger(metadata.attachmentCount) && attachments.length===metadata.attachmentCount && attachments.length<=(metadata.schemaVersion===2?stagedLimits.attachments:limits.attachments),'Incomplete SDS manifest');
      const owners=new Set(), ids=new Set();
      for(const a of attachments) {
        stableId(a.attachmentId);
        demand(!ids.has(a.attachmentId) && !owners.has(a.ownerId),'Duplicate SDS manifest entry'); ids.add(a.attachmentId); owners.add(a.ownerId);
        demand((metadata.schemaVersion===2?a.verified===true:a.published===true) && a.ownerType==='chemical_product' && a.slotKey==='sds' && dataset.chemicalProducts.some(p=>p.id===a.ownerId),'Invalid SDS ownership');
        demand(/^[a-f0-9]{64}$/.test(a.sha256) && Number.isInteger(a.sizeBytes) && a.sizeBytes>0 && a.sizeBytes<=limits.pdfBytes,'Invalid SDS integrity metadata');
        demand(a.relativePath===(metadata.schemaVersion===2?stagedAttachmentPath:attachmentPath)(companyId,revisionId,a),'SDS revision/path mismatch');
      }
      if(access.role!=='member') {
        if(metadata.schemaVersion===2)await verifyPublishedPlan(await transport.manifest(companyId,revisionId),metadata,dataset,attachments);
        else demand(await digest({rows:dataset,attachmentIds:[...ids].sort()})===metadata.payloadHash,'Revision payload hash mismatch');
      }
      const attempt=crypto.randomUUID(), downloadStart=performance.now();
      // Files become durable before the transaction; failure leaves an unreferenced staging directory.
      // Never delete it here: an ambiguous local commit acknowledgement may already reference it.
      const staged=await parallel(attachments,fileConcurrency,async a=>{
        const bytes=new Uint8Array(await transport.download(a.relativePath,a.sizeBytes)); pdf(bytes);
        demand(bytes.length===a.sizeBytes,'SDS size mismatch'); demand(await sha256(bytes)===a.sha256,'SDS SHA-256 mismatch');
        const localPath=await files.stage(attempt,a.attachmentId,bytes);
        const stored=await files.read(localPath); demand(stored.length===a.sizeBytes && await sha256(stored)===a.sha256,'Staged SDS integrity mismatch');
        return {...a,localPath};
      });
      const fresh=await transport.access(companyId); checkAccess(fresh,companyId); sameAccess(access,fresh);
      const downloadMs=performance.now()-downloadStart, importStart=performance.now();
      const state=await replica.activate({previous,access,metadata,dataset,attachments:staged});
      return {changed:true,state,metrics:{sdsDownloadMs:downloadMs,importMs:performance.now()-importStart}};
    }),
    syncTraining:companyId=>serial(async()=>{
      const access=await transport.access(companyId); checkAccess(access,companyId);
      const previous=await replica.assertReadable(access);
      demand(previous.revisionId===access.currentRevisionId,'Revision changed; synchronize publication first');
      // Re-scan the append-only log in pages. This intentionally avoids a timestamp high-water
      // mark: event timestamps precede transaction commit, so late commits could be missed.
      const events=[]; let cursor=null;
      do {const page=await transport.trainingPage(companyId,access,cursor); events.push(...page.events); cursor=page.cursor;} while(cursor);
      const fresh=await transport.access(companyId); checkAccess(fresh,companyId); sameAccess(access,fresh);
      return replica.reconcile(access,events,previous);
    })
  };
}
