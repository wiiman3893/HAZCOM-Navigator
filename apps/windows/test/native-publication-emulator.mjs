// Only invoked by the disposable Rust SQLite bridge with explicit emulator guards.
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithCredential,GoogleAuthProvider} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,terminate} from 'firebase/firestore';
import {getFunctions,connectFunctionsEmulator} from 'firebase/functions';
import {getStorage,connectStorageEmulator} from 'firebase/storage';
import {initializeApp as initializeAdmin,deleteApp as deleteAdmin} from 'firebase-admin/app';
import {getFirestore as adminFirestore,Timestamp} from 'firebase-admin/firestore';
import {publish} from '../../../packages/sync/src/publisher-v2.js';
import {firebaseTransport} from '../../../packages/sync/src/firebase.js';
import {createPublicationWorkflow,bindWorkspacePublication} from '../src/data/publication-workflow.ts';
import {WorkspaceLifecycle} from '../src/data/workspace-lifecycle.ts';

export async function verifyNativePublication({open,companyId}){
 const lifecycle=new WorkspaceLifecycle();let activeToken=null;
 const select=id=>lifecycle.change(async()=>{const workspace=await open(id);activeToken=workspace.lease.token;return workspace;});
 const projectId='demo-hazcom-navigator';
 assert.equal(process.env.GCLOUD_PROJECT,projectId);
 for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])assert.match(process.env[key]??'',/^(localhost|127\.0\.0\.1):\d+$/);
 // stdout is the native bridge protocol, never SDK logging.
 console.log=console.error;
 const app=initializeApp({projectId,apiKey:'emulator-only',storageBucket:projectId+'.appspot.com'},'native-publication');
 const auth=getAuth(app),db=getFirestore(app),functions=getFunctions(app,'us-central1'),storage=getStorage(app);
 const admin=initializeAdmin({projectId},'native-publication-admin'),trusted=adminFirestore(admin);
 connectAuthEmulator(auth,'http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST,{disableWarnings:true});
 const endpoint=key=>{const [host,port]=process.env[key].split(':');return [host,Number(port)];};
 connectFirestoreEmulator(db,...endpoint('FIRESTORE_EMULATOR_HOST'));
 connectStorageEmulator(storage,...endpoint('FIREBASE_STORAGE_EMULATOR_HOST'));
 connectFunctionsEmulator(functions,'127.0.0.1',5001);
 try{
  const part=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  await signInWithCredential(auth,GoogleAuthProvider.credential(`${part({alg:'none',typ:'JWT'})}.${part({iss:'https://accounts.google.com',aud:'emulator-only',sub:'native-author',email:'native-author@example.test',email_verified:true,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.`));
  const transport=firebaseTransport({auth,db,functions,storage,uploadUrl:`http://127.0.0.1:5001/${projectId}/us-central1/uploadStagedSds`}),uid=auth.currentUser.uid;
  await transport.call('bootstrapAccount',{});
  await trusted.doc('subscriptions/'+uid).set({accountId:uid,plan:'professional',status:'active',validUntil:Timestamp.fromMillis(Date.now()+86400000),graceUntil:Timestamp.fromMillis(Date.now()+172800000),coveredCompanyCount:0});
  await transport.call('createCompany',{companyId,company:{name:'Native round trip',contact_email:'qa@example.test'}});
  let interrupted=true,loseFinalization=false;
  const workflow=workspace=>bindWorkspacePublication(createPublicationWorkflow({
   context:async()=>{
    const access=await transport.access(companyId),commercial=await transport.call('getCompanyCapabilities',{companyId});
    const published=access.currentRevisionId?await transport.metadata(companyId,access.currentRevisionId):null;
    return {uid,companyId,companyName:access.company.name,companyEmail:access.company.contact_email,role:access.role,canPublish:commercial.capabilities.canPublish,coverageStatus:commercial.status,currentRevisionId:access.currentRevisionId??null,currentRevisionNumber:access.currentRevisionNumber??null,published};
   },
   projection:()=>workspace.projection(),
   getAttempt:()=>workspace.journal.get(uid+'/ui-attempt/'+companyId),
   setAttempt:(_,value)=>workspace.journal.put(uid+'/ui-attempt/'+companyId,value),
   getPublishedLocal:()=>workspace.journal.get(uid+'/ui-published/'+companyId),
   setPublishedLocal:(_,value)=>workspace.journal.put(uid+'/ui-published/'+companyId,value),
   revisionId:()=>crypto.randomUUID(),
   publish:input=>publish({...input,files:workspace.files,journal:workspace.journal,attempts:1,transport:{...transport,call:async(name,data)=>{
    const result=await transport.call(name,data);
    if(name==='finalizeStagedPublication'&&loseFinalization){loseFinalization=false;throw Object.assign(Error('Injected lost finalization response'),{code:'functions/unavailable'});}
    return result;
   },uploadSds:async(...args)=>{
    await assert.rejects(select('primary'),/Finish the active/);
    const result=await transport.uploadSds(...args);
    if(interrupted){interrupted=false;throw Object.assign(Error('Injected lost SDS response'),{code:'network-error'});}
    return result;
   }}})
  }),()=>assert.equal(activeToken,workspace.lease.token,'Workspace changed'),()=>lifecycle.pin());
  let a=await select('restored-copy-a'),wa=workflow(a),ready=await wa.check(companyId);
  assert.notEqual(ready.state,'BLOCKING',JSON.stringify(ready.issues));
  const fingerprintA=ready.projection.fingerprint;
  const selecting=lifecycle.change(async()=>{});
  await assert.rejects(wa.run(ready,()=>{}),/selection is changing/);await selecting;
  await assert.rejects(wa.run(ready,()=>{}),/lost SDS response/);
  const pending=await a.journal.get(uid+'/ui-attempt/'+companyId);assert.equal(pending.status,'pending');
  assert.equal((await transport.access(companyId)).currentRevisionId,null);
  const b=await select('restored-copy-b'),wb=workflow(b),readyB=await wb.check(companyId);
  assert.equal(readyB.attempt,null);assert.notEqual(readyB.projection.fingerprint,fingerprintA);
  assert.equal(await b.journal.get(`${companyId}/${pending.revisionId}`),null);
  await assert.rejects(a.journal.get(uid+'/ui-attempt/'+companyId),/STALE/);
  await assert.rejects(a.files.read(ready.projection.attachments[0].localPath),/STALE/);
  await assert.rejects(wa.run(ready,()=>{}),/Workspace changed/);
  a=await select('restored-copy-a');wa=workflow(a);ready=await wa.check(companyId);
  assert.equal(ready.attempt.revisionId,pending.revisionId);
  const first=await wa.run(ready,()=>{});assert.equal(first.revisionId,pending.revisionId);
  const access=await transport.access(companyId);
  const areas=await transport.records(companyId,first.revisionId,'workAreas',access);
  assert.equal(areas[0].name,'Edited restore A');
  for(const attachment of await transport.attachments(companyId,first.revisionId,{schemaVersion:2})){
   const expected=ready.projection.attachments.find(a=>a.attachmentId===attachment.attachmentId);
   assert.ok(expected);assert.deepEqual(new Uint8Array(await transport.download(attachment.relativePath,attachment.sizeBytes)),await a.files.read(expected.localPath));
  }
  const reopenedB=await select('restored-copy-b'),secondWorkflow=workflow(reopenedB),secondReady=await secondWorkflow.check(companyId);
  assert.equal(secondReady.attempt,null);assert.equal(secondReady.context.currentRevisionId,first.revisionId);
  loseFinalization=true;
  await assert.rejects(secondWorkflow.run(secondReady,()=>{}),/lost finalization response/);
  const recovered=await secondWorkflow.check(companyId);assert.equal(recovered.attempt,null);assert.equal(recovered.localChanges,false);
  await assert.rejects(secondWorkflow.run(recovered,()=>{}),/already the current/);
  const second=recovered.current;assert.notEqual(second.revisionId,first.revisionId);
  assert.equal(second.revisionNumber,first.revisionNumber+1);
  assert.equal((await transport.records(companyId,second.revisionId,'workers',await transport.access(companyId)))[0].name,'Changed during row export');
  const primary=await select('primary');assert.equal(await primary.journal.get(uid+'/ui-attempt/'+companyId),null);
  assert.equal(await primary.journal.get(`${companyId}/${first.revisionId}`),null);
  console.error('PASS native restored A/B publication, separate journals/SDS/fingerprints, interrupted retry, stale tokens and untouched primary journal');
 }finally{await terminate(db);await deleteApp(app);await deleteAdmin(admin);}
}
