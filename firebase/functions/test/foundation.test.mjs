import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, setLogLevel } from 'firebase/firestore';
import { ref, getBytes, uploadBytes, deleteObject, listAll } from 'firebase/storage';
import { Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Run using Firebase emulators: never tests against cloud data.');
const projectId='demo-hazcom-navigator';
process.env.GCLOUD_PROJECT=projectId;
process.env.FIREBASE_CONFIG=JSON.stringify({projectId,storageBucket:projectId});
setLogLevel('silent');
const functions=await import('../lib/index.js');
const {db,auth,canAuthor}=await import('../lib/access.js');
const {dataset,date}=await import('../lib/validation.js');
let env;
const context=uid=>env.authenticatedContext(uid,{firebase:{sign_in_provider:'google.com'}});
const call=(name,uid,data)=>functions[name].run({data,auth:uid?{uid,token:{firebase:{sign_in_provider:'google.com'},auth_time:Math.floor(Date.now()/1000)+1}}:undefined});
const company={name:'Test Company',contact_email:'test@example.com'};
const payload={
  workAreas:[{id:'area',name:'Shop',location:'Site',poc_name:'',poc_email:'',poc_phone_number:'',description:''}],
  chemicalProducts:[{id:'product',product_name:'Test',manufacturer:'Test',sds_date:'2026-01-01'}],
  workers:[{id:'worker',name:'Linked Worker'},{id:'other-worker',name:'Another Worker'}],
  workAreaAssignments:[{id:'assignment',workAreaId:'area',workerId:'worker',assigned_date:'2026-01-01',training_required_since:'2026-01-01'}, {id:'other-assignment',workAreaId:'area',workerId:'other-worker',assigned_date:'2026-01-01',training_required_since:'2026-01-01'}],
};
before(async()=> {
  env=await initializeTestEnvironment({projectId,firestore:{rules:await readFile(new URL('../../firestore.rules',import.meta.url),'utf8')},storage:{rules:await readFile(new URL('../../storage.rules',import.meta.url),'utf8')}});
  await env.clearFirestore();
  for (const uid of ['customer','professional','member','outsider']) {
    await auth.createUser({uid,email:`${uid}@example.com`});
    await auth.updateUser(uid,{providerToLink:{providerId:'google.com',uid:`google-${uid}`,email:`${uid}@example.com`}});
    await call('bootstrapAccount',uid,{});
  }
  for (const uid of ['customer','professional']) await db.doc(`subscriptions/${uid}`).set({accountId:uid,plan:uid,status:'active',validUntil:Timestamp.fromMillis(Date.now()+86400000),graceUntil:Timestamp.fromMillis(Date.now()+15*86400000),coveredCompanyCount:0});
});
after(async()=>{await env?.cleanup();});

test('real identity required; account bootstrap is idempotent and cannot self-grant privileges',async()=> {
  await assert.rejects(call('bootstrapAccount',null,{}));
  await auth.createUser({uid:'no-google'});
  await assert.rejects(call('bootstrapAccount','no-google',{}));
  await call('bootstrapAccount','customer',{});
  assert.equal((await db.doc('accounts/customer').get()).get('uid'),'customer');
  assert.equal((await db.doc('accounts/customer').get()).get('role'),undefined);
});
test('Customer limit is enforced under concurrent creation; retry is idempotent',async()=> {
  const results=await Promise.allSettled(['company-a','company-b'].map(companyId=>call('createCompany','customer',{companyId,company})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const companyId=results.find(r=>r.status==='fulfilled').value.companyId;
  // Make the rest of the test independent of which transaction won.
  globalThis.customerCompany=companyId;
  assert.equal((await call('createCompany','customer',{companyId,company})).created,false);
  assert.equal((await db.doc('subscriptions/customer').get()).get('coveredCompanyCount'),1);
  assert.equal((await db.doc(`companies/${companyId}/memberships/customer`).get()).get('role'),'administrator');
  assert.equal((await call('createCompany','outsider',{companyId:'demo-company',company})).created,true);
  await assert.rejects(call('createCompany','outsider',{companyId:'demo-second',company}));
  await assert.rejects(call('beginPublication','outsider',{companyId:'demo-company',revisionId:'demo-rev',parentRevisionId:null}));
  await assert.rejects(call('setMembership','outsider',{companyId:'demo-company',uid:'member',role:'member',active:true}));
  assert.equal((await db.doc('subscriptions/outsider').get()).get('plan'),'demo');
});
test('Professional creation grants Manager only; membership is separate from paid coverage',async()=> {
  for(const companyId of ['professional-a','professional-b']) assert.equal((await call('createCompany','professional',{companyId,company})).role,'manager');
  await assert.rejects(call('updateCompany','professional',{companyId:'professional-a',company}));
  await assert.rejects(call('setMembership','professional',{companyId:'professional-a',uid:'professional',role:'administrator',active:true}));
  await assert.rejects(call('coverCompany','professional',{companyId:globalThis.customerCompany}));
  assert.equal((await db.doc('subscriptions/professional').get()).get('coveredCompanyCount'),2);
});
test('publication is atomic, immutable, revision-oriented and retry-safe',async()=> {
  const companyId=globalThis.customerCompany;
  await call('beginPublication','customer',{companyId,revisionId:'rev1',parentRevisionId:null});
  await assert.rejects(call('beginPublication','outsider',{companyId,revisionId:'bad',parentRevisionId:null}));
  const pendingPath=`companies/${companyId}/publishedRevisions/rev1`;
  await assertFails(getDoc(doc(context('outsider').firestore(),pendingPath)));
  const sds=await call('uploadPublicationSds','customer',{companyId,revisionId:'rev1',attachmentId:'sds1',chemicalProductId:'product',base64:Buffer.from('%PDF-1.7\nTest SDS\n%%EOF').toString('base64')});
  globalThis.sds=sds;
  const bytesRef=ref(context('customer').storage(),sds.relativePath);
  await assertFails(getBytes(bytesRef));
  const result=await call('finalizePublication','customer',{companyId,revisionId:'rev1',dataset:payload,attachmentIds:['sds1']});
  assert.equal(result.revisionNumber,1);
  assert.equal((await db.doc(`companies/${companyId}`).get()).get('currentRevisionId'),'rev1');
  assert.equal((await call('finalizePublication','customer',{companyId,revisionId:'rev1',dataset:payload,attachmentIds:['sds1']})).revisionNumber,1);
  await assert.rejects(call('finalizePublication','customer',{companyId,revisionId:'rev1',dataset:{},attachmentIds:[]}));
  await assert.rejects(call('uploadPublicationSds','customer',{companyId,revisionId:'rev1',attachmentId:'sds2',chemicalProductId:'product',base64:Buffer.from('%PDF-1.7 test').toString('base64')}));
  const [metadata]=await getStorage().bucket().file(sds.relativePath).getMetadata();
  assert.equal(metadata.metadata?.firebaseStorageDownloadTokens,undefined);
  // CLI 15.30.2's emulator generates a token on every successful GET (including
  // alt=media). Assert upload metadata before the first GET; cloud verification
  // after provisioning must also confirm authenticated downloads stay token-free.
  await assertSucceeds(getBytes(bytesRef));
});
test('Administrator links one Worker; Members cannot mutate roles or train another Worker',async()=> {
  const companyId=globalThis.customerCompany;
  await call('setMembership','customer',{companyId,uid:'member',role:'member',active:true,workerId:'worker'});
  await assert.rejects(call('setMembership','customer',{companyId,uid:'outsider',role:'member',active:true,workerId:'worker'}));
  await assert.rejects(call('setMembership','customer',{companyId,uid:'customer',role:'manager',active:true}));
  await assert.rejects(call('setMembership','member',{companyId,uid:'member',role:'administrator',active:true}));
  await assert.rejects(call('beginPublication','member',{companyId,revisionId:'bad',parentRevisionId:'rev1'}));
  const event={companyId,assignmentId:'assignment',eventId:'event1',trainingDate:'2026-02-01'};
  assert.equal((await call('recordTrainingCompletion','member',event)).created,true);
  assert.equal((await call('recordTrainingCompletion','member',event)).created,false);
  await assert.rejects(call('recordTrainingCompletion','member',{...event,assignmentId:'other-assignment',eventId:'event2'}));
  await assert.rejects(call('recordTrainingCompletion','member',{...event,trainingDate:'2026-02-02'}));
});
test('rules block public reads, tenant crossing, personal-data leakage and every direct write',async()=> {
  const companyId=globalThis.customerCompany, root=`companies/${companyId}`, published=`${root}/publishedRevisions/rev1`;
  const memberDb=context('member').firestore(), adminDb=context('customer').firestore();
  for (const firestore of [env.unauthenticatedContext().firestore(),context('outsider').firestore(),env.authenticatedContext('member',{firebase:{sign_in_provider:'anonymous'}}).firestore()]) {
    await assertFails(getDoc(doc(firestore,`${published}/chemicalProducts/product`)));
    await assertFails(getDocs(collection(firestore,'companies')));
  }
  await assertSucceeds(getDoc(doc(memberDb,`${published}/chemicalProducts/product`)));
  await assertSucceeds(getDoc(doc(memberDb,`${published}/workers/worker`)));
  await assertFails(getDoc(doc(memberDb,`${published}/workers/other-worker`)));
  await assertFails(getDocs(collection(memberDb,`${published}/workAreaAssignments`)));
  await assertSucceeds(getDocs(query(collection(memberDb,`${published}/workAreaAssignments`),where('workerId','==','worker'))));
  await assertSucceeds(getDocs(collection(adminDb,`${published}/workers`)));
  await assertSucceeds(getDocs(collection(memberDb,'accounts/member/memberships')));
  await assertFails(getDoc(doc(memberDb,'accounts/customer')));
  await assertFails(getDoc(doc(memberDb,'subscriptions/customer')));
  for (const firestore of [memberDb,adminDb,context('professional').firestore()]) {
    for (const path of ['subscriptions/member',`${root}/memberships/member`,root,`${published}/workers/worker`,'accounts/member']) {
      await assertFails(setDoc(doc(firestore,path),{role:'administrator',status:'active',active:true,extra:'pollution'}));
      await assertFails(updateDoc(doc(firestore,path),{createdAt:'old',uid:'customer',name:42}));
      await assertFails(deleteDoc(doc(firestore,path)));
    }
  }
  await assertFails(setDoc(doc(adminDb,root),{name:'x'.repeat(900000)}));
});
test('Storage enforces Company access and publication, and rejects overwrite/delete/list',async()=> {
  const path=globalThis.sds.relativePath;
  await assertSucceeds(getBytes(ref(context('member').storage(),path)));
  for (const storage of [env.unauthenticatedContext().storage(),context('outsider').storage()]) await assertFails(getBytes(ref(storage,path)));
  for (const uid of ['member','professional','customer']) {
    await assertFails(uploadBytes(ref(context(uid).storage(),path),Buffer.from('%PDF overwrite')));
    await assertFails(deleteObject(ref(context(uid).storage(),path)));
    await assertFails(listAll(ref(context(uid).storage(),'companies')));
  }
});
test('concurrent publications reject stale parent and do not expose losing dataset',async()=> {
  const companyId=globalThis.customerCompany;
  for (const revisionId of ['rev2','rev3']) await call('beginPublication','customer',{companyId,revisionId,parentRevisionId:'rev1'});
  const results=await Promise.allSettled(['rev2','rev3'].map(revisionId=>call('finalizePublication','customer',{companyId,revisionId,dataset:payload,attachmentIds:[]})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.doc(`companies/${companyId}`).get()).get('currentRevisionNumber'),2);
});
test('entitlement boundaries and malformed data fail closed',async()=> {
  const now=Date.now(), entitlement={plan:'customer',status:'active',validUntil:Timestamp.fromMillis(now-1000),graceUntil:Timestamp.fromMillis(now+1000)};
  assert.equal(canAuthor(entitlement,now),false);
  assert.equal(canAuthor({...entitlement,graceUntil:Timestamp.fromMillis(now)},now),false);
  assert.equal(canAuthor({...entitlement,graceUntil:Timestamp.fromMillis(now+15*86400000)},now),false);
  for (const status of ['export_only','inactive','unknown']) assert.equal(canAuthor({...entitlement,status},now),false);
  assert.throws(()=>date('2026-02-31'));
  assert.throws(()=>dataset({...payload,workers:[{id:'../escape',name:'bad'}]}));
  assert.throws(()=>dataset({...payload,workers:[]}));
  assert.throws(()=>dataset({...payload,roles:[]}));
  await db.doc('subscriptions/customer').update({status:'export_only'});
  await assert.rejects(call('beginPublication','customer',{companyId:globalThis.customerCompany,revisionId:'unpaid',parentRevisionId:'rev2'}));
  await assertSucceeds(getBytes(ref(context('member').storage(),globalThis.sds.relativePath)));
});
test('membership revocation immediately removes published data and SDS access',async()=> {
  const companyId=globalThis.customerCompany;
  await db.doc('subscriptions/customer').update({status:'active'});
  await call('setMembership','customer',{companyId,uid:'member',role:'member',active:false,workerId:'worker'});
  await assertFails(getDoc(doc(context('member').firestore(),`companies/${companyId}/publishedRevisions/rev1/chemicalProducts/product`)));
  await assertFails(getBytes(ref(context('member').storage(),globalThis.sds.relativePath)));
});

test('trusted Pro billing events materialize inherited Manager access and seat removal revokes it without deleting Companies',async()=>{
 const {applyTrustedBillingEvent}=await import('../lib/commercial-admin.js');
 for(const uid of ['pro-owner-v1','pro-seat-v1']){
  await auth.createUser({uid,email:`${uid}@example.com`});
  await auth.updateUser(uid,{providerToLink:{providerId:'google.com',uid:`google-${uid}`,email:`${uid}@example.com`}});
  await call('bootstrapAccount',uid,{});
 }
 const started={id:'billing-start',type:'subscription_started',subscriptionId:'pro-owner-v1',version:1,effectiveAt:new Date().toISOString(),source:'mock-billing',payload:{tierId:'pro',cadence:'monthly',priceVersion:'v1'}};
 assert.equal((await applyTrustedBillingEvent('pro-owner-v1',started)).applied,true);
 assert.equal((await applyTrustedBillingEvent('pro-owner-v1',started)).applied,false);
 assert.equal((await call('createCompany','pro-owner-v1',{companyId:'pro-client-one',company})).role,'manager');
 const {beginBackupEmailVerification,confirmBackupEmailVerification}=await import('../lib/commercial-backup.js');
 const outbox=[];await beginBackupEmailVerification('pro-owner-v1','pro-client-one','backup-new@example.com',{send:async message=>{outbox.push(message);}});
 assert.equal((await db.doc('companies/pro-client-one').get()).get('backupEmail'),company.contact_email);
 await assert.rejects(confirmBackupEmailVerification('pro-client-one','wrong-token'));
 assert.equal((await confirmBackupEmailVerification('pro-client-one',outbox[0].token)).email,'backup-new@example.com');
 assert.equal((await db.doc('companies/pro-client-one').get()).get('backupEmailVerified'),true);
 assert.equal((await db.doc('accounts/backup-new@example.com').get()).exists,false);
 const seat={...started,id:'billing-seat',version:2,type:'seat_added',payload:{uid:'pro-seat-v1'}};
 await applyTrustedBillingEvent('pro-owner-v1',seat);
 assert.equal((await db.doc('companies/pro-client-one/memberships/pro-seat-v1').get()).get('role'),'manager');
 assert.equal((await call('createCompany','pro-owner-v1',{companyId:'pro-client-two',company})).role,'manager');
 assert.equal((await db.doc('companies/pro-client-two/memberships/pro-seat-v1').get()).get('proTeamSubscriptionId'),'pro-owner-v1');
 await call('beginPublication','pro-owner-v1',{companyId:'pro-client-two',revisionId:'pro-seat-access',parentRevisionId:null});
 const seatSds=await call('uploadPublicationSds','pro-owner-v1',{companyId:'pro-client-two',revisionId:'pro-seat-access',attachmentId:'seat-sds',chemicalProductId:'product',base64:Buffer.from('%PDF-1.7\nSynthetic Pro seat SDS\n%%EOF').toString('base64')});
 await call('finalizePublication','pro-owner-v1',{companyId:'pro-client-two',revisionId:'pro-seat-access',dataset:payload,attachmentIds:['seat-sds']});
 await assertSucceeds(getDoc(doc(context('pro-seat-v1').firestore(),'companies/pro-client-two/publishedRevisions/pro-seat-access/chemicalProducts/product')));
 await assertSucceeds(getBytes(ref(context('pro-seat-v1').storage(),seatSds.relativePath)));
 await assert.rejects(call('setMembership','pro-seat-v1',{companyId:'pro-client-two',uid:'pro-seat-v1',role:'administrator',active:true}));
 await applyTrustedBillingEvent('pro-owner-v1',{...seat,id:'billing-remove',version:3,type:'seat_removed'});
 assert.equal((await db.doc('companies/pro-client-one/memberships/pro-seat-v1').get()).exists,false);
 await assertFails(getDoc(doc(context('pro-seat-v1').firestore(),'companies/pro-client-two/publishedRevisions/pro-seat-access/chemicalProducts/product')));
 await assertFails(getBytes(ref(context('pro-seat-v1').storage(),seatSds.relativePath)));
 assert.equal((await db.doc('companies/pro-client-two').get()).exists,true);
 const buyerUid='pro-client-buyer';await auth.createUser({uid:buyerUid,email:`${buyerUid}@example.com`});
 await auth.updateUser(buyerUid,{providerToLink:{providerId:'google.com',uid:`google-${buyerUid}`,email:`${buyerUid}@example.com`}});
 await call('bootstrapAccount',buyerUid,{});
 await applyTrustedBillingEvent(buyerUid,{...started,id:'buyer-paid',subscriptionId:buyerUid,payload:{tierId:'company',cadence:'monthly'}});
 const {transferProCompanyToCompany}=await import('../lib/commercial-admin.js');
 assert.equal((await transferProCompanyToCompany('pro-client-one',buyerUid,'takeover-one')).transferred,true);
 assert.equal((await transferProCompanyToCompany('pro-client-one',buyerUid,'takeover-one')).transferred,false);
 assert.equal((await db.doc('companies/pro-client-one/coverage/current').get()).get('accountId'),buyerUid);
 assert.equal((await db.doc('companies/pro-client-one/memberships/pro-owner-v1').get()).exists,false);
 assert.equal((await db.doc('companies/pro-client-one/memberships/pro-client-buyer').get()).get('role'),'administrator');
 assert.equal((await db.doc('companies/pro-client-two/coverage/current').get()).get('accountId'),'pro-owner-v1');
 await call('createCompany','pro-owner-v1',{companyId:'pro-client-three',company});
 await call('beginPublication','pro-owner-v1',{companyId:'pro-client-three',revisionId:'pro-revision',parentRevisionId:null});
 const publishedSds=await call('uploadPublicationSds','pro-owner-v1',{companyId:'pro-client-three',revisionId:'pro-revision',attachmentId:'pro-sds',chemicalProductId:'product',base64:Buffer.from('%PDF-1.7\nSynthetic backup cleanup SDS\n%%EOF').toString('base64')});
 await call('finalizePublication','pro-owner-v1',{companyId:'pro-client-three',revisionId:'pro-revision',dataset:payload,attachmentIds:['pro-sds']});
 assert.equal((await getStorage().bucket().file(publishedSds.relativePath).exists())[0],true);
 await call('setMembership','pro-owner-v1',{companyId:'pro-client-three',uid:'member',role:'member',active:true,workerId:'worker'});
 assert.equal((await db.doc('companies/pro-client-three/memberships/member').get()).get('workerId'),'worker');
 await assert.rejects(call('setMembership','pro-owner-v1',{companyId:'pro-client-three',uid:'member',role:'administrator',active:true}));
 const paidThrough=(await db.doc('subscriptions/pro-owner-v1').get()).get('paidThrough');
 await applyTrustedBillingEvent('pro-owner-v1',{...started,id:'schedule-company',version:4,type:'subscription_downgrade_scheduled',payload:{tierId:'company',retainedCompanyId:'pro-client-two'}});
 await assert.rejects(applyTrustedBillingEvent('pro-owner-v1',{...started,id:'renew-early',version:5,type:'subscription_renewed',effectiveAt:paidThrough,payload:{administratorUid:'pro-owner-v1'}}));
 await applyTrustedBillingEvent('pro-owner-v1',{...started,id:'renew-company',version:5,type:'subscription_renewed',effectiveAt:paidThrough,payload:{administratorUid:'pro-owner-v1'}},Date.parse(paidThrough)+1);
 assert.equal((await db.doc('subscriptions/pro-owner-v1').get()).get('plan'),'company');
 assert.equal((await db.doc('companies/pro-client-two/memberships/pro-owner-v1').get()).get('role'),'administrator');
 assert.equal((await db.doc('companies/pro-client-three/coverage/current').get()).get('state'),'ending');
 assert.equal((await db.doc('companies/pro-client-three').get()).exists,true);
 const cleanupAt=Date.parse((await db.doc('companies/pro-client-three/coverage/current').get()).get('exportEndsAt'))+1;
 const {cleanupExpiredCompanyInEmulator}=await import('../lib/commercial-admin.js');
 assert.equal((await cleanupExpiredCompanyInEmulator('pro-client-three','pro-owner-v1','pro-cleanup-three',cleanupAt)).deleted,true);
 assert.equal((await getStorage().bucket().file(publishedSds.relativePath).exists())[0],false);
 assert.equal((await db.doc('companies/pro-client-three').get()).exists,false);
});

test('Pro Demo switch preserves three Companies and parks unselected Companies in Company Demo',async()=>{
 const uid='demo-switch-v1';await auth.createUser({uid,email:`${uid}@example.com`});
 await auth.updateUser(uid,{providerToLink:{providerId:'google.com',uid:`google-${uid}`,email:`${uid}@example.com`}});
 await call('bootstrapAccount',uid,{});
 await call('switchDemoType',uid,{demoType:'pro'});
 for(const companyId of ['demo-one','demo-two','demo-three'])await call('createCompany',uid,{companyId,company});
 await assert.rejects(call('createCompany',uid,{companyId:'demo-four',company}));
 await assert.rejects(call('beginPublication',uid,{companyId:'demo-one',revisionId:'demo-stage',parentRevisionId:null}));
 await call('switchDemoType',uid,{demoType:'company',selectedCompanyId:'demo-two'});
 await assert.rejects(call('getCompanyCapabilities',uid,{companyId:'demo-one'}));
 assert.equal((await call('getCompanyCapabilities',uid,{companyId:'demo-two'})).capabilities.canAuthor,true);
 assert.equal((await db.doc('companies/demo-one').get()).exists,true);
 await call('switchDemoType',uid,{demoType:'pro'});
 assert.equal((await call('getCompanyCapabilities',uid,{companyId:'demo-one'})).capabilities.canAuthor,true);
 const {applyTrustedBillingEvent}=await import('../lib/commercial-admin.js');
 await applyTrustedBillingEvent(uid,{id:'demo-to-company',type:'subscription_started',subscriptionId:uid,version:1,effectiveAt:new Date().toISOString(),source:'mock-billing',payload:{tierId:'company',cadence:'monthly',retainedCompanyId:'demo-two',administratorUid:uid}});
 assert.equal((await db.doc('companies/demo-one/coverage/current').get()).get('state'),'ending');
 assert.equal((await db.doc('companies/demo-two/memberships/demo-switch-v1').get()).get('role'),'administrator');
 assert.equal((await call('getCompanyCapabilities',uid,{companyId:'demo-two'})).capabilities.canPublish,true);
 await assert.rejects(call('getCompanyCapabilities',uid,{companyId:'demo-one'}));
 assert.equal((await db.doc('companies/demo-three').get()).exists,true);
 const accountStatus=await call('getCommercialStatus',uid,{}),endingStatus=await call('getCompanyCoverageStatus',uid,{companyId:'demo-three'});
 assert.equal(accountStatus.plan,'company');assert.equal(accountStatus.seatCount,0);
 assert.equal(endingStatus.status,'ending');assert.ok(endingStatus.hostedAccessEndingAt);
 const {cleanupExpiredCompanyInEmulator}=await import('../lib/commercial-admin.js');
 const end=Date.parse((await db.doc('companies/demo-three/coverage/current').get()).get('exportEndsAt'));
 await db.doc('companies/demo-one/coverage/current').update({accountId:'replacement-owner',state:'active'});
 assert.equal((await cleanupExpiredCompanyInEmulator('demo-one',uid,'cleanup-transferred',end+1)).deleted,false);
 assert.equal((await db.doc('companies/demo-one').get()).exists,true);
 assert.equal((await cleanupExpiredCompanyInEmulator('demo-three',uid,'cleanup-ending',end+1)).deleted,true);
 assert.equal((await cleanupExpiredCompanyInEmulator('demo-three',uid,'cleanup-ending',end+1)).deleted,false);
 assert.equal((await db.doc('companies/demo-three').get()).exists,false);
 assert.equal((await db.doc('commercialCleanupAudit/cleanup-ending').get()).get('status'),'completed');
});

test('invited Company Manager authors under Company coverage without a personal paid subscription',async()=>{
 const uid='invited-manager-v1';await auth.createUser({uid,email:`${uid}@example.com`});
 await auth.updateUser(uid,{providerToLink:{providerId:'google.com',uid:`google-${uid}`,email:`${uid}@example.com`}});
 await call('bootstrapAccount',uid,{});
 assert.equal((await db.doc(`subscriptions/${uid}`).get()).get('plan'),'demo');
 const companyId=globalThis.customerCompany;
 await call('setMembership','customer',{companyId,uid,role:'manager',active:true});
 assert.equal((await call('getCompanyCapabilities',uid,{companyId})).capabilities.canPublish,true);
 const parentRevisionId=(await db.doc(`companies/${companyId}`).get()).get('currentRevisionId');
 assert.equal((await call('beginPublication',uid,{companyId,revisionId:'invited-manager-revision',parentRevisionId})).status,'staging');
});

test('paid Company coverage attaches to an existing Manager without mutating Company roles',async()=>{
 const {applyTrustedBillingEvent,attachExistingCompanyCoverage}=await import('../lib/commercial-admin.js');
 for(const uid of ['existing-admin-v1','existing-manager-v1']){
  await auth.createUser({uid,email:`${uid}@example.com`});
  await auth.updateUser(uid,{providerToLink:{providerId:'google.com',uid:`google-${uid}`,email:`${uid}@example.com`}});
  await call('bootstrapAccount',uid,{});
 }
 await applyTrustedBillingEvent('existing-manager-v1',{id:'existing-paid',type:'subscription_started',subscriptionId:'existing-manager-v1',version:1,effectiveAt:new Date().toISOString(),source:'mock-billing',payload:{tierId:'company',cadence:'monthly'}});
 const companyId='existing-factory';
 await db.doc(`companies/${companyId}`).set({id:companyId,...company,active:true,administratorCount:1,currentRevisionId:null,currentRevisionNumber:0});
 await db.doc(`companies/${companyId}/memberships/existing-admin-v1`).set({uid:'existing-admin-v1',companyId,role:'administrator',active:true,workerId:null});
 await db.doc(`companies/${companyId}/memberships/existing-manager-v1`).set({uid:'existing-manager-v1',companyId,role:'manager',active:true,workerId:null});
 assert.equal((await attachExistingCompanyCoverage(companyId,'existing-manager-v1','existing-cover')).role,'manager');
 assert.equal((await attachExistingCompanyCoverage(companyId,'existing-manager-v1','existing-cover')).attached,false);
 assert.equal((await db.doc(`companies/${companyId}/memberships/existing-manager-v1`).get()).get('role'),'manager');
 assert.equal((await db.doc(`companies/${companyId}`).get()).get('administratorCount'),1);
 assert.equal((await call('getCompanyCapabilities','existing-manager-v1',{companyId})).capabilities.canAuthor,true);
});

test('Pro owner release preserves read access during export window and cleanup deletes only after it',async()=>{
 const {applyTrustedBillingEvent,releaseProCompany,cleanupExpiredCompanyInEmulator}=await import('../lib/commercial-admin.js');
 const uid='release-owner-v1';await auth.createUser({uid,email:`${uid}@example.com`});
 await auth.updateUser(uid,{providerToLink:{providerId:'google.com',uid:`google-${uid}`,email:`${uid}@example.com`}});
 await call('bootstrapAccount',uid,{});
 await applyTrustedBillingEvent(uid,{id:'release-plan',type:'subscription_started',subscriptionId:uid,version:1,effectiveAt:new Date().toISOString(),source:'mock-billing',payload:{tierId:'pro',cadence:'monthly'}});
 const companyId='released-client';await call('createCompany',uid,{companyId,company});
 const release=await releaseProCompany(uid,companyId,'release-event');
 assert.equal(release.released,true);
 assert.equal((await releaseProCompany(uid,companyId,'release-event')).released,false);
 assert.equal((await call('getCompanyCoverageStatus',uid,{companyId})).status,'ending');
 assert.equal((await getDoc(doc(context(uid).firestore(),`companies/${companyId}`))).exists(),true);
 await assert.rejects(call('getCompanyCapabilities',uid,{companyId}));
 assert.equal((await cleanupExpiredCompanyInEmulator(companyId,uid,'release-too-early',Date.parse(release.exportEndsAt)-1)).deleted,false);
 assert.equal((await cleanupExpiredCompanyInEmulator(companyId,uid,'release-final',Date.parse(release.exportEndsAt)+1)).deleted,true);
});

test('failed-payment recovery before cleanup restores authoring and retains the Company',async()=>{
 const {applyTrustedBillingEvent,cleanupExpiredCompanyInEmulator}=await import('../lib/commercial-admin.js');
 const uid='recovery-owner-v1';await auth.createUser({uid,email:`${uid}@example.com`});
 await auth.updateUser(uid,{providerToLink:{providerId:'google.com',uid:`google-${uid}`,email:`${uid}@example.com`}});
 await call('bootstrapAccount',uid,{});
 await applyTrustedBillingEvent(uid,{id:'recovery-start',type:'subscription_started',subscriptionId:uid,version:1,effectiveAt:new Date().toISOString(),source:'mock-billing',payload:{tierId:'company',cadence:'monthly'}});
 const companyId='recovery-company';await call('createCompany',uid,{companyId,company});
 await db.doc(`subscriptions/${uid}`).update({paidThrough:new Date(Date.now()-15*86400000).toISOString(),graceEndsAt:new Date(Date.now()-86400000).toISOString()});
 await assert.rejects(call('getCompanyCapabilities',uid,{companyId}));
 assert.equal((await call('getCompanyCoverageStatus',uid,{companyId})).status,'expired');
 await applyTrustedBillingEvent(uid,{id:'recovery-paid',type:'payment_recovered',subscriptionId:uid,version:2,effectiveAt:new Date().toISOString(),source:'mock-billing',payload:{}});
 assert.equal((await call('getCompanyCapabilities',uid,{companyId})).capabilities.canAuthor,true);
 assert.equal((await cleanupExpiredCompanyInEmulator(companyId,uid,'cleanup-after-recovery',Date.now())).deleted,false);
 assert.equal((await db.doc(`companies/${companyId}`).get()).exists,true);
});
