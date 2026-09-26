import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from '../../../packages/sync/test/fixtures.mjs';
import {buildPublication} from '../../../packages/sync/src/projection.js';
import {publicationPlan} from '../../../packages/sync/src/staged.js';
import {createPublicationWorkflow,publicationError} from '../src/data/publication-workflow.ts';
import {verifyWindowsSdsIntegrity} from '../src/data/publication-integrity.ts';

function harness(projection,{role='manager',canPublish=true,coverageStatus='active',companyId=projection.company.id}={}){
 let cloudId=null,cloudNumber=0,cloudManifestHash=null,cloudContentHash=null,local=null,attempt=null,calls=0,fail=false,loseCommit=false;
 const context=async()=>({uid:'manager-uid',companyId,companyName:projection.company.name,companyEmail:projection.company.contact_email,role,canPublish,coverageStatus,currentRevisionId:cloudId,currentRevisionNumber:cloudNumber,published:cloudId?{revisionId:cloudId,revisionNumber:cloudNumber,publishedAt:'2026-09-25T00:00:00.000Z',recordCounts:Object.fromEntries(Object.entries(projection.dataset).map(([k,v])=>[k,v.length])),attachmentCount:projection.attachments.length,fingerprint:null,manifestHash:cloudManifestHash,contentHash:cloudContentHash}:null});
 const workflow=createPublicationWorkflow({
  context,projection:async()=>projection,getAttempt:async()=>attempt,setAttempt:async(_c,v)=>{attempt=v;},
  getPublishedLocal:async()=>local,setPublishedLocal:async(_c,v)=>{local=v;},
  revisionId:()=>`revision-${calls+1}`,
  publish:async({revisionId,parentRevisionId,onProgress})=>{calls++;assert.equal(parentRevisionId,cloudId);onProgress({phase:'chunks',completed:1,total:1});if(fail)throw Object.assign(Error('temporary unavailable'),{code:'functions/unavailable'});if(cloudId!==revisionId){const plan=await publicationPlan(projection,revisionId,parentRevisionId,'manager-uid');cloudManifestHash=plan.manifestHash;cloudContentHash=plan.manifest.contentHash;cloudId=revisionId;cloudNumber++;}if(loseCommit)throw Object.assign(Error('response lost after commit'),{code:'functions/unavailable'});return {revisionId,revisionNumber:cloudNumber};}
 });
 return {workflow,context,setFailure:v=>{fail=v;},setLoseCommit:v=>{loseCommit=v;},clearLocal:()=>{local=null;},counts:()=>({calls,cloudId,cloudNumber}),setCloud:v=>{cloudId=v;cloudNumber++;cloudContentHash=null;},setProjection:v=>{projection=v;}};
}

test('Paid roles pass readiness; Demo, grace, expired and Member are blocked',async()=>{
 const f=await fixture('small','publication-ui-fixture');
 try{
  const p=await buildPublication(f.sql,f.company.id,f.files);
  for(const role of ['administrator','manager']){
   const h=harness(p,{role});const ready=await h.workflow.check(p.company.id);
   assert.notEqual(ready.state,'BLOCKING');assert.equal(ready.projection.fingerprint,p.fingerprint);
  }
  for(const props of [{role:'member'},{canPublish:false,coverageStatus:'active'},{canPublish:false,coverageStatus:'grace'},{canPublish:false,coverageStatus:'expired'}]){
   const h=harness(p,props),ready=await h.workflow.check(p.company.id);
   assert.equal(ready.state,'BLOCKING');await assert.rejects(h.workflow.run(ready,()=>{}),/readiness/);
  }
  for(const type of ['Company Demo','Pro Demo']){const h=harness(p,{canPublish:false});assert.match((await h.workflow.check(p.company.id)).issues.map(i=>i.message).join(' '),/current plan/);}
 }finally{f.sql.close();}
});

test('Lost finalization response is reconciled from the published manifest without a duplicate',async()=>{
 const f=await fixture('small','lost-response-fixture');
 try{
  const p=await buildPublication(f.sql,f.company.id,f.files),h=harness(p);
  h.setLoseCommit(true);
  await assert.rejects(h.workflow.run(await h.workflow.check(p.company.id),()=>{}),/response lost/);
  assert.equal(h.counts().cloudNumber,1);
  const recovered=await h.workflow.check(p.company.id);
  assert.equal(recovered.localChanges,false);
  assert.equal(recovered.attempt,null);
  await assert.rejects(h.workflow.run(recovered,()=>{}),/already the current published revision/);
  assert.equal(h.counts().calls,1);
 }finally{f.sql.close();}
});

test('Stale cloud parent abandons the local resume ID and prepares a new attempt',async()=>{
 const f=await fixture('small','stale-ui-fixture');
 try{
  const p=await buildPublication(f.sql,f.company.id,f.files),h=harness(p);
  h.setFailure(true);
  await assert.rejects(h.workflow.run(await h.workflow.check(p.company.id),()=>{}));
  h.setCloud('external-revision');
  const ready=await h.workflow.check(p.company.id);
  assert.equal(ready.attempt,null);
  assert.equal(ready.state,'WARNING');
  assert.match(ready.issues.map(i=>i.message).join(' '),/cannot be resumed/);
 }finally{f.sql.close();}
});

test('SDS missing, changed hash and valid integrity',async()=>{
 const f=await fixture('small','sds-ui-fixture');
 try{
  const p=await buildPublication(f.sql,f.company.id,f.files),first=p.attachments[0];
  await verifyWindowsSdsIntegrity([first],async()=>[{sha256:first.sha256}]);
  await assert.rejects(verifyWindowsSdsIntegrity([first],async()=>[{sha256:'0'.repeat(64)}]),/SDS hash mismatch.*sds-0000/);
  assert.match(publicationError(Error('SDS hash mismatch: sds-0000')),/changed after it was attached/);
  const missing={read:async()=>{throw Error('ENOENT');}};
  await assert.rejects(buildPublication(f.sql,f.company.id,missing),/SDS sds-0000.*cannot be read/);
  assert.match(publicationError(Error('SDS sds-0000 cannot be read: ENOENT')),/missing from this computer/);
  assert.match(publicationError(Error('The system cannot find the file specified. (os error 2)')),/missing from this computer/);
 }finally{f.sql.close();}
});

test('Finalization waits for the current Company pointer to become visible',async()=>{
 const f=await fixture('small','pointer-visibility-fixture');
 try{
  const projection=await buildPublication(f.sql,f.company.id,f.files);
  let published=false,staleReads=1,observations=0,local=null,attempt=null;
  const revisionId='visibility-revision';
  const workflow=createPublicationWorkflow({
   context:async()=>{
    const visible=published&&staleReads--<=0;
    if(published)observations++;
    return {uid:'manager-uid',companyId:f.company.id,companyName:projection.company.name,companyEmail:projection.company.contact_email,role:'manager',canPublish:true,coverageStatus:'active',currentRevisionId:visible?revisionId:null,currentRevisionNumber:visible?1:0,published:visible?{revisionId,revisionNumber:1,publishedAt:'2026-09-25T00:00:00.000Z',recordCounts:{},attachmentCount:projection.attachments.length,fingerprint:null}:null};
   },
   projection:async()=>projection,getAttempt:async()=>attempt,setAttempt:async(_c,v)=>{attempt=v;},
   getPublishedLocal:async()=>local,setPublishedLocal:async(_c,v)=>{local=v;},
   revisionId:()=>revisionId,
   publish:async()=>{published=true;return {revisionId,revisionNumber:1};}
  });
  const result=await workflow.run(await workflow.check(f.company.id),()=>{});
  assert.equal(result.revisionId,revisionId);
  assert.equal(observations,2);
  assert.equal(local.revisionId,revisionId);
 }finally{f.sql.close();}
});

test('Company scope, retry ID, confirmation, duplicate avoidance and local changes',async()=>{
 const f=await fixture('small','scope-ui-fixture');
 try{
  const p=await buildPublication(f.sql,f.company.id,f.files);
  const wrong=harness(p,{companyId:'other-company'}),bad=await wrong.workflow.check(p.company.id);
  assert.equal(bad.state,'BLOCKING');assert.match(bad.issues.map(i=>i.message).join(' '),/active Company|different Company/);
  const h=harness(p),ready=await h.workflow.check(p.company.id),progress=[];
  h.setFailure(true);await assert.rejects(h.workflow.run(ready,v=>progress.push(v)),/temporary unavailable/);
  const retry=await h.workflow.check(p.company.id);assert.equal(retry.attempt.revisionId,'revision-1');
  h.setFailure(false);const result=await h.workflow.run(retry,v=>progress.push(v));
  assert.equal(result.revisionId,'revision-1');assert.equal(result.revisionNumber,1);assert.equal(h.counts().cloudNumber,1);
  assert.deepEqual(progress.at(-1),{phase:'published'});
  const unchanged=await h.workflow.check(p.company.id);assert.equal(unchanged.localChanges,false);
  h.clearLocal();assert.equal((await h.workflow.check(p.company.id)).localChanges,false);
  await assert.rejects(h.workflow.run(unchanged,()=>{}),/already the current published revision/);
  assert.equal(h.counts().cloudNumber,1);
  f.sql.db.prepare("UPDATE work_area SET name='Changed local draft' WHERE id='area-0000'").run();
  h.setProjection(await buildPublication(f.sql,f.company.id,f.files));
  const changed=await h.workflow.check(p.company.id);assert.equal(changed.localChanges,true);
  assert.equal(changed.attempt,null);const second=await h.workflow.run(changed,()=>{});
  assert.equal(second.revisionNumber,2);assert.equal(h.counts().cloudNumber,2);
 }finally{f.sql.close();}
});
