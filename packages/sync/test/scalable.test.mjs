import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithCredential,GoogleAuthProvider} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,terminate,doc,getDocFromServer,setDoc,updateDoc,deleteDoc,collection,getDocsFromServer,setLogLevel} from 'firebase/firestore';
import {getFunctions,connectFunctionsEmulator} from 'firebase/functions';
import {getStorage,connectStorageEmulator,ref,getBytes,uploadBytes,deleteObject,listAll} from 'firebase/storage';
import {initializeApp as adminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getFirestore as adminFirestore,Timestamp} from 'firebase-admin/firestore';
import {getStorage as adminStorage} from 'firebase-admin/storage';
import {fixture} from './fixtures.mjs';
import {nodeSqlite,nodeFiles} from '../src/node.js';
import {firebaseTransport} from '../src/firebase.js';
import {buildPublication,publish,publicationPlan,receiver,sqliteReplica,sqliteJournal,REPLICA_SCHEMA_SQL,digest,stagedAttachmentPath,stagedLimits} from '../src/index.js';
import {manifest as validateManifest,hash as backendHash} from '../../../firebase/functions/lib/staged-contract.js';

const projectId='demo-hazcom-navigator';
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])assert.match(process.env[key]??'',/^(127\.0\.0\.1|localhost):\d+$/);
assert.equal(process.env.GCLOUD_PROJECT,projectId);setLogLevel('silent');
const allClients=[];
async function client(name,subject=name) {
  const app=initializeApp({projectId,apiKey:'emulator-only-key',authDomain:`${projectId}.firebaseapp.com`,storageBucket:`${projectId}.appspot.com`},name),auth=getAuth(app),db=getFirestore(app),functions=getFunctions(app,'us-central1'),storage=getStorage(app);
  connectAuthEmulator(auth,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true});
  const [h,p]=process.env.FIRESTORE_EMULATOR_HOST.split(':');connectFirestoreEmulator(db,h,Number(p));
  const [sh,sp]=process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':');connectStorageEmulator(storage,sh,Number(sp));connectFunctionsEmulator(functions,'127.0.0.1',5001);
  const part=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
  await signInWithCredential(auth,GoogleAuthProvider.credential(`${part({alg:'none',typ:'JWT'})}.${part({iss:'https://accounts.google.com',aud:'emulator-only',sub:subject,email:`${subject}@example.test`,email_verified:true,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.`));
  const transport=firebaseTransport({auth,db,functions,storage,uploadUrl:`http://127.0.0.1:5001/${projectId}/us-central1/uploadStagedSds`});
  const c={app,auth,db,storage,transport};allClients.push(c);await transport.call('bootstrapAccount',{});return c;
}
const unavailable=()=>Object.assign(Error('Injected response loss'),{code:'functions/unavailable'});
test('scalable staged publication security, recovery, and measured end-to-end scales',{timeout:1_800_000},async t=>{
  const admin=adminApp({projectId,storageBucket:`${projectId}.appspot.com`},'scale-admin'),db=adminFirestore(admin),bucket=adminStorage(admin).bucket();
  const results=[],measurements=[],scales=(process.env.HAZCOM_SCALE_SIZES??'small,medium,large,stress').split(',').filter(Boolean);
  const reportName=scales.length===0?'scalable-publication-security-results.json':process.env.HAZCOM_SCALE_SIZES?'scalable-publication-development-results.json':'scalable-publication-results.json';
  const report=()=>writeFile(new URL(`../../../docs/${reportName}`,import.meta.url),JSON.stringify({executedAt:new Date().toISOString(),complete:results.length===scales.length+1,expectedScales:scales,passed:results.length===scales.length+1&&results.every(r=>r.result==='PASS'),projectId,node:process.version,limits:stagedLimits,results,measurements},null,2)+'\n');
  const run=async(name,fn)=>t.test(name,async()=>{try{await fn();results.push({name,result:'PASS'});}catch(e){results.push({name,result:'FAIL',error:e.message});throw e;}finally{await report();}});
  let author,administrator,member,outsider,device;
  try {
    author=await client('scale-author');administrator=await client('scale-administrator');member=await client('scale-member');outsider=await client('scale-outsider');device=await client('scale-device','scale-author');
    const uid=author.auth.currentUser.uid,adminUid=administrator.auth.currentUser.uid,memberUid=member.auth.currentUser.uid;
    const subscription=db.doc(`subscriptions/${uid}`);
    await subscription.set({accountId:uid,plan:'professional',status:'active',validUntil:Timestamp.fromMillis(Date.now()+86400000),graceUntil:Timestamp.fromMillis(Date.now()+2*86400000),coveredCompanyCount:0});
    const create=async f=>{
      const {id,...company}=f.company;await author.transport.call('createCompany',{companyId:id,company});
      // Explicit trusted fixture onboarding of an Administrator; Professional creator remains Manager.
      await db.doc(`companies/${id}/memberships/${adminUid}`).set({uid:adminUid,companyId:id,role:'administrator',active:true,workerId:null});await db.doc(`companies/${id}`).update({administratorCount:1});
    };
    await run('Adversarial manifests/chunks/SDS, access revocation, restart resume and atomic visibility',async()=>{
      const f=await fixture('small','scale-security');await create(f);
      const p=await buildPublication(f.sql,f.company.id,f.files),plans=new Map(),companyId=f.company.id;
      const make=async(revisionId,projection=p,parentRevisionId=null)=>{const plan=await publicationPlan(projection,revisionId,parentRevisionId,uid);plans.set(revisionId,plan);return plan;};
      const begin=async plan=>author.transport.call('beginStagedPublication',{manifest:plan.manifest,manifestHash:plan.manifestHash});
      const chunk=async(plan,c,rows=c.rows)=>author.transport.call('stagePublicationChunk',{companyId,revisionId:plan.manifest.revisionId,manifestHash:plan.manifestHash,chunkId:c.descriptor.chunkId,rows});
      const finish=plan=>author.transport.call('finalizeStagedPublication',{companyId,revisionId:plan.manifest.revisionId,manifestHash:plan.manifestHash});
      const seal=plan=>author.transport.call('sealPublication',{companyId,revisionId:plan.manifest.revisionId,manifestHash:plan.manifestHash});
      const upload=async(plan,a=p.attachments[0],bytes)=>author.transport.uploadSds({companyId,revisionId:plan.manifest.revisionId,attachmentId:a.attachmentId},bytes??await f.files.read(a.localPath));
      const root=r=>db.doc(`companies/${companyId}/publishedRevisions/${r}`);
      const stageAll=async plan=>{for(const c of plan.chunks)await chunk(plan,c);};
      const uploadAll=async plan=>{for(const a of p.attachments)await upload(plan,a);};
      const validate=async plan=>{let page;do{page=await author.transport.call('validatePublicationPage',{companyId,revisionId:plan.manifest.revisionId,manifestHash:plan.manifestHash});}while(page.status==='sealed');return page;};
      try {
        const plan=await make('resumed');assert.equal(backendHash(validateManifest(plan.manifest,uid)),plan.manifestHash);
        const malformed=structuredClone(plan.manifest);malformed.recordCounts.workers++;
        await assert.rejects(begin({manifest:malformed,manifestHash:await digest(malformed)}),/totals/);
        const foreign=structuredClone(plan.manifest);foreign.company.id='foreign-company';await assert.rejects(begin({manifest:foreign,manifestHash:await digest(foreign)}),/Company/);
        const wrongHash={...plan,manifestHash:'0'.repeat(64)};await assert.rejects(begin(wrongHash),/hash/);
        const outsiderManifest={...plan.manifest,creatorUid:outsider.auth.currentUser.uid};
        await assert.rejects(outsider.transport.call('beginStagedPublication',{manifest:outsiderManifest,manifestHash:await digest(outsiderManifest)}),/membership/i);
        const unauthenticated=await fetch(`http://127.0.0.1:5001/${projectId}/us-central1/uploadStagedSds?companyId=${companyId}&revisionId=resumed&attachmentId=sds-0000`,{method:'POST',headers:{'Content-Type':'application/pdf'},body:'%PDF-1.4'});assert.equal(unauthenticated.status,401);
        await begin(plan);
        await assert.rejects(author.transport.call('finalizePublication',{companyId,revisionId:'resumed',dataset:{},attachmentIds:[]}),/schema v2/);
        await assert.rejects(author.transport.call('beginPublication',{companyId,revisionId:'resumed',parentRevisionId:null}),/schema v2/);
        await assert.rejects(author.transport.call('uploadPublicationSds',{companyId,revisionId:'resumed',attachmentId:'legacy-bypass',chemicalProductId:'product-0000',base64:Buffer.from(await f.files.read(p.attachments[0].localPath)).toString('base64')}),/schema v2/);
        await assert.rejects(finish(plan));await assert.rejects(seal(plan),/incomplete/);
        await chunk(plan,plan.chunks[0]);assert.equal((await chunk(plan,plan.chunks[0])).duplicate,true);
        const changed=structuredClone(plan.chunks[0].rows);changed[0].name='Conflicting bytes';await assert.rejects(chunk(plan,plan.chunks[0],changed),/hash/);
        await assert.rejects(author.transport.call('stagePublicationChunk',{companyId:'foreign-company',revisionId:'resumed',manifestHash:plan.manifestHash,chunkId:plan.chunks[0].descriptor.chunkId,rows:plan.chunks[0].rows}));
        await assert.rejects(getDocsFromServer(collection(device.db,`${root('resumed').path}/workAreas`)));
        await assert.rejects(getDocFromServer(doc(device.db,`${root('resumed').path}/stagingPlan/root`)));
        const a=p.attachments[0],fileChunk=plan.chunks.find(c=>c.descriptor.kind==='attachments');await chunk(plan,fileChunk);
        await assert.rejects(seal(plan),/incomplete/);
        const bytes=await f.files.read(a.localPath),corrupt=bytes.slice();corrupt[corrupt.length-1]^=1;
        await assert.rejects(upload(plan,a,corrupt),/SHA-256 or size/);await assert.rejects(upload(plan,a,bytes.slice(0,-1)),/SHA-256 or size/);
        await assert.rejects(author.transport.uploadSds({companyId:'foreign-company',revisionId:'resumed',attachmentId:a.attachmentId},bytes));
        const registered=await upload(plan);assert.equal((await upload(plan)).duplicate,true);
        await assert.rejects(getBytes(ref(device.storage,registered.relativePath)));
        const membership=db.doc(`companies/${companyId}/memberships/${uid}`);
        await membership.update({active:false});await assert.rejects(chunk(plan,plan.chunks[1]));await assert.rejects(upload(plan,p.attachments[1]));await membership.update({active:true});
        await subscription.update({status:'export_only'});await assert.rejects(chunk(plan,plan.chunks[1]));await assert.rejects(upload(plan,p.attachments[1]));await subscription.update({status:'active'});
        let lost=false;
        await assert.rejects(publish({projection:p,revisionId:'resumed',transport:{...author.transport,uploadSds:async(c,b)=>{const result=await author.transport.uploadSds(c,b);if(!lost){lost=true;throw unavailable();}return result;}},files:f.files,journal:sqliteJournal(f.sql),concurrency:1,attempts:1}),/response loss/);
        assert.equal((await author.transport.access(companyId)).currentRevisionId,null);
        f.sql.close();f.sql=nodeSqlite(path.join(f.folder,'author.db'));
        let finalizeLost=false;
        await assert.rejects(publish({projection:p,revisionId:'resumed',transport:{...author.transport,call:async(n,d)=>{const result=await author.transport.call(n,d);if(n==='finalizeStagedPublication'&&!finalizeLost){finalizeLost=true;throw unavailable();}return result;}},files:f.files,journal:sqliteJournal(f.sql),attempts:1}),/response loss/);
        const published=await publish({projection:p,revisionId:'resumed',transport:author.transport,files:f.files,journal:sqliteJournal(f.sql)});assert.equal(published.revisionNumber,1);assert.equal(published.metrics.filesUploaded,0);
        const changedProjection=structuredClone(p);changedProjection.company.name='different';changedProjection.fingerprint=await digest({company:changedProjection.company,dataset:changedProjection.dataset,attachments:changedProjection.attachments.map(({localPath,...a})=>a)});
        await assert.rejects(publish({projection:changedProjection,revisionId:'resumed',transport:author.transport,files:f.files,journal:sqliteJournal(f.sql)}),/new revision/);
        await administrator.transport.call('setMembership',{companyId,uid:memberUid,role:'member',active:true,workerId:'worker-0000'});
        const memberPlan=await publicationPlan(p,'member-denied','resumed',memberUid);
        await assert.rejects(member.transport.call('beginStagedPublication',{manifest:memberPlan.manifest,manifestHash:memberPlan.manifestHash}),/membership/i);
        const adminPlan=await publicationPlan(p,'admin-revoked','resumed',adminUid);
        await administrator.transport.call('beginStagedPublication',{manifest:adminPlan.manifest,manifestHash:adminPlan.manifestHash});
        await db.doc(`companies/${companyId}/memberships/${adminUid}`).update({active:false});
        await assert.rejects(administrator.transport.call('stagePublicationChunk',{companyId,revisionId:'admin-revoked',manifestHash:adminPlan.manifestHash,chunkId:adminPlan.chunks[0].descriptor.chunkId,rows:adminPlan.chunks[0].rows}),/membership/i);
        await db.doc(`companies/${companyId}/memberships/${adminUid}`).update({active:true});
        const memberDb=nodeSqlite(path.join(f.folder,'member.db'),REPLICA_SCHEMA_SQL),memberFiles=await nodeFiles(path.join(f.folder,'member-files'));
        try{await receiver({transport:member.transport,replica:sqliteReplica(memberDb),files:memberFiles,fileConcurrency:4}).sync(companyId);assert.equal(memberDb.db.prepare('SELECT count(*) n FROM worker').get().n,1);assert.equal(memberDb.db.prepare('SELECT count(*) n FROM chemical_product').get().n,20);}finally{memberDb.close();}
        await assert.rejects(member.transport.manifest(companyId,'resumed'));await assert.rejects(getDocsFromServer(collection(member.db,`${root('resumed').path}/workers`)));
        for(const actor of [author,member,outsider]) {
          for(const target of [root('resumed').path,`${root('resumed').path}/chunkReceipts/chunk-00000`,`companies/${companyId}`,`companies/${companyId}/memberships/${uid}`,`subscriptions/${uid}`]) {
            await assert.rejects(setDoc(doc(actor.db,target),{status:'published',currentRevisionId:'bad',role:'administrator'}));await assert.rejects(updateDoc(doc(actor.db,target),{status:'published'}));await assert.rejects(deleteDoc(doc(actor.db,target)));
          }
          await assert.rejects(uploadBytes(ref(actor.storage,registered.relativePath),bytes));await assert.rejects(deleteObject(ref(actor.storage,registered.relativePath)));await assert.rejects(listAll(ref(actor.storage,`companies/${companyId}/revisions-v2`)));
        }
        await assert.rejects(getBytes(ref(outsider.storage,registered.relativePath)));
        // Corrupt a staged record after upload using the trusted test fixture Admin only.
        const corruptPlan=await make('corrupt',p,'resumed');await begin(corruptPlan);await stageAll(corruptPlan);await uploadAll(corruptPlan);await seal(corruptPlan);
        await root('corrupt').collection('workAreas').doc('area-0000').update({name:'Admin-injected corruption'});
        await assert.rejects(validate(corruptPlan),/changed/);await assert.rejects(finish(corruptPlan));
        await root('corrupt').collection('workAreas').doc('area-0000').set(corruptPlan.chunks[0].rows[0]);
        await bucket.file(stagedAttachmentPath(companyId,'corrupt',p.attachments[0])).delete();
        await assert.rejects(validate(corruptPlan));await assert.rejects(finish(corruptPlan));
        // Broken relationship is individually valid but must fail cross-chunk validation.
        const broken=structuredClone(p);broken.dataset.workAreaProducts[0].chemicalProductId='foreign-product';
        // Build a manifest from the valid plan then replace that chunk and its committed hashes.
        const brokenPlan=await make('broken',p,'resumed'),bChunk=brokenPlan.chunks.find(c=>c.descriptor.kind==='workAreaProducts');bChunk.rows[0].chemicalProductId='foreign-product';
        bChunk.descriptor.sha256=await digest(bChunk.rows);bChunk.descriptor.bytes=Buffer.byteLength(JSON.stringify(bChunk.rows));
        brokenPlan.manifest.contentHash=await digest({company:brokenPlan.manifest.company,recordCounts:brokenPlan.manifest.recordCounts,attachmentCount:brokenPlan.manifest.attachmentCount,chunks:brokenPlan.manifest.chunks});brokenPlan.manifestHash=await digest(brokenPlan.manifest);
        await begin(brokenPlan);await stageAll(brokenPlan);await uploadAll(brokenPlan);await seal(brokenPlan);await assert.rejects(validate(brokenPlan),/relationship/);
        const competingA=await make('competing-a',p,'resumed'),competingB=await make('competing-b',p,'resumed');
        for(const candidate of [competingA,competingB]){await begin(candidate);await stageAll(candidate);await uploadAll(candidate);await seal(candidate);await validate(candidate);}
        await subscription.update({status:'export_only'});await assert.rejects(finish(competingA));await subscription.update({status:'active'});
        await membership.update({active:false});await assert.rejects(finish(competingB));await membership.update({active:true});
        const competing=await Promise.allSettled([finish(competingA),finish(competingB)]);assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);assert.equal(competing.filter(r=>r.status==='rejected').length,1);
        const current=(await author.transport.access(companyId)).currentRevisionId;
        const expired=await make('expired',p,current);await begin(expired);await root('expired').update({expiresAt:Timestamp.fromMillis(Date.now()-1)});await assert.rejects(chunk(expired,expired.chunks[0]),/expired/);
        // Core cleanup marks abandoned, waits out in-flight uploads, and retains a tombstone.
        await assert.rejects(administrator.transport.call('cleanupStagedPublication',{companyId,revisionId:current}),/published/);
        await assert.rejects(author.transport.call('cleanupStagedPublication',{companyId,revisionId:'corrupt'}));
        await author.transport.call('abandonPublication',{companyId,revisionId:'corrupt'});
        assert.equal((await administrator.transport.call('cleanupStagedPublication',{companyId,revisionId:'corrupt'})).waiting,true);
        await root('corrupt').update({deleteAfter:Timestamp.fromMillis(Date.now()-1)}); // test clock advance, never a client field
        let cleanup;do{cleanup=await administrator.transport.call('cleanupStagedPublication',{companyId,revisionId:'corrupt'});}while(!cleanup.done);
        assert.equal((await root('corrupt').get()).get('status'),'abandoned');assert.equal((await root('corrupt').collection('workAreas').get()).size,0);
        assert.equal((await bucket.getFiles({prefix:`companies/${companyId}/revisions-v2/corrupt/`}))[0].length,0);
        assert.equal((await administrator.transport.call('cleanupStagedPublication',{companyId,revisionId:'corrupt'})).done,true);await assert.rejects(begin(corruptPlan),/Abandoned/);
        assert.equal((await author.transport.access(companyId)).currentRevisionId,current);
        assert.equal((await administrator.transport.call('cleanupStagedPublication',{companyId,revisionId:'expired'})).waiting,true);
      }finally{f.sql.close();}
    });
    for(const size of scales)await run(`${size}: full SQLite author -> staged Functions/Firestore/Storage -> independent replica`,async()=>{
      const f=await fixture(size,`scale-${size}`);await create(f);
      const local=nodeSqlite(path.join(f.folder,'receiver.db'),REPLICA_SCHEMA_SQL),files=await nodeFiles(path.join(f.folder,'receiver-files'));
      try {
        const p=await buildPublication(f.sql,f.company.id,f.files),plan=await publicationPlan(p,'revision-1',null,uid),requests={callables:{},sdsUploads:0,sdsDownloads:0};
        const source={...author.transport,call:async(n,d)=>{requests.callables[n]=(requests.callables[n]??0)+1;return author.transport.call(n,d);},uploadSds:async(c,b)=>{requests.sdsUploads++;return author.transport.uploadSds(c,b);}};
        let last=0;const start=performance.now();
        const publication=await publish({projection:p,revisionId:'revision-1',transport:source,files:f.files,journal:sqliteJournal(f.sql),concurrency:4,onProgress:s=>{if(s.phase==='sds'&&s.completed-last>=500){last=s.completed;console.log(`${size}: ${s.completed}/${s.total} SDS uploaded`);}}});
        const publicationMs=performance.now()-start;
        console.log(`${size}: published ${p.metrics.records} records, ${p.attachments.length} SDS; starting clean receiver`);
        const transport={...device.transport,download:async(p,s)=>{requests.sdsDownloads++;return device.transport.download(p,s);}};
        const receiverStart=performance.now(),client=receiver({transport,replica:sqliteReplica(local),files,fileConcurrency:8});
        const imported=await client.sync(f.company.id),replicationMs=performance.now()-receiverStart;
        assert.equal(imported.changed,true);assert.equal((await buildPublication(local,f.company.id,files)).fingerprint,p.fingerprint);
        assert.equal((await client.sync(f.company.id)).changed,false);assert.equal(local.db.prepare('PRAGMA foreign_key_check').all().length,0);
        assert.equal(publication.criticalTransactionWrites,2);assert.equal(requests.sdsUploads,p.attachments.length);assert.equal(requests.sdsDownloads,p.attachments.length);
        local.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        measurements.push({size,records:p.metrics.records,chunks:plan.chunks.length,sds:p.attachments.length,jsonBytes:p.metrics.jsonBytes,manifestBytes:Buffer.byteLength(JSON.stringify(plan.manifest)),totalStagedJsonBytes:plan.chunks.reduce((n,c)=>n+c.descriptor.bytes,0)+Buffer.byteLength(JSON.stringify(plan.manifest)),sdsBytes:p.attachments.reduce((n,a)=>n+a.sizeBytes,0),projectionMs:p.metrics.projectionMs,publicationMs,...publication.metrics,replicationMs,...imported.metrics,replicaDbBytes:(await stat(path.join(f.folder,'receiver.db'))).size,requests,logicalFirestoreWrites:p.metrics.records+3*p.attachments.length+plan.chunks.length+Math.ceil(plan.chunks.length/4)+5,logicalStorageOperations:5*p.attachments.length,operationCountNote:'Logical operation estimates from the executed successful algorithm, excluding setup, retries, indexes, auth/security-rule reads and SDK internals. Storage: create + metadata update + two metadata reads + receiver download per file. Request counts and validation reads are observed.'});
        console.log(`${size}: PASS complete publication and replica (${Math.round(publicationMs)} ms publish, ${Math.round(replicationMs)} ms receive)`);
      }finally{local.close();f.sql.close();}
    });
  }finally {await report();for(const c of allClients){await terminate(c.db);await deleteApp(c.app);}await deleteAdminApp(admin);}
});
