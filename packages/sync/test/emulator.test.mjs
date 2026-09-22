import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {writeFile} from 'node:fs/promises';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,connectAuthEmulator,signInWithCredential,GoogleAuthProvider} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,terminate,collection,getDocsFromServer,setLogLevel} from 'firebase/firestore';
import {getFunctions,connectFunctionsEmulator} from 'firebase/functions';
import {getStorage,connectStorageEmulator} from 'firebase/storage';
import {initializeApp as adminApp,deleteApp as deleteAdminApp} from 'firebase-admin/app';
import {getFirestore as adminFirestore,Timestamp} from 'firebase-admin/firestore';
import {firebaseTransport} from '../src/firebase.js';
import {nodeSqlite,nodeFiles} from '../src/node.js';
import {fixture,dummyPdf} from './fixtures.mjs';
import {buildPublication,publishLegacy as publish,receiver,sqliteReplica,sqliteJournal,REPLICA_SCHEMA_SQL,normalizeDataset,serverRows,limits,capacity} from '../src/index.js';
import {dataset as backendDataset} from '../../../firebase/functions/lib/validation.js';

const projectId='demo-hazcom-navigator';
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST']) assert.match(process.env[key]??'',/^(127\.0\.0\.1|localhost):\d+$/,`Emulator-only safety guard: ${key}`);
assert.equal(process.env.GCLOUD_PROJECT,projectId);
setLogLevel('silent');
const clients=[];
async function client(name,subject=name) {
  const app=initializeApp({projectId,apiKey:'emulator-only-key',authDomain:`${projectId}.firebaseapp.com`,storageBucket:`${projectId}.appspot.com`},name);
  const auth=getAuth(app),db=getFirestore(app),functions=getFunctions(app,'us-central1'),storage=getStorage(app);
  connectAuthEmulator(auth,`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`,{disableWarnings:true});
  const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':'); connectFirestoreEmulator(db,host,Number(port));
  const [sh,sp]=process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':'); connectStorageEmulator(storage,sh,Number(sp));
  connectFunctionsEmulator(functions,'127.0.0.1',5001);
  // Firebase Auth emulator's documented synthetic Google credential path; never valid in cloud.
  const part=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const token=`${part({alg:'none',typ:'JWT'})}.${part({iss:'https://accounts.google.com',aud:'emulator-only',sub:subject,email:`${subject}@example.test`,email_verified:true,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.`;
  await signInWithCredential(auth,GoogleAuthProvider.credential(token));
  const c={app,auth,db,transport:firebaseTransport({auth,db,functions,storage})}; clients.push(c);return c;
}
const unavailable=()=>Object.assign(Error('Injected network interruption'),{code:'functions/unavailable'});
test('PC A SQLite -> emulator callable publication -> independent Device B SQLite proof',async t=>{
  const started=performance.now(), results=[];
  const run=async(name,fn)=>t.test(name,async()=>{try{await fn();results.push({name,result:'PASS'});}catch(error){results.push({name,result:'FAIL',error:error.message});throw error;}});
  const admin=adminApp({projectId,storageBucket:`${projectId}.appspot.com`},'sync-proof-admin'), db=adminFirestore(admin);
  const f=await fixture('small','pipeline-company'), local=nodeSqlite(path.join(f.folder,'device-b.db'),REPLICA_SCHEMA_SQL), memberLocal=nodeSqlite(path.join(f.folder,'member.db'),REPLICA_SCHEMA_SQL);
  const files=await nodeFiles(path.join(f.folder,'device-b-files')), memberFiles=await nodeFiles(path.join(f.folder,'member-files'));
  let author,device,member,projection,revision2,receiving,memberReceiving;
  const journal=sqliteJournal(f.sql), replica=sqliteReplica(local), memberReplica=sqliteReplica(memberLocal);
  try {
    await run('Real callable transport with distinct authenticated emulator clients',async()=>{
      author=await client('pc-a');device=await client('device-b','pc-a');member=await client('member');
      for(const c of [author,member]) await c.transport.call('bootstrapAccount',{});
      const uid=author.auth.currentUser.uid;
      await db.doc(`subscriptions/${uid}`).set({accountId:uid,plan:'customer',status:'active',validUntil:Timestamp.fromMillis(Date.now()+86400000),graceUntil:Timestamp.fromMillis(Date.now()+2*86400000),coveredCompanyCount:0});
      const {id,...company}=f.company;
      await author.transport.call('createCompany',{companyId:id,company});
      projection=await buildPublication(f.sql,id,f.files);
      assert.deepEqual(backendDataset(projection.dataset),serverRows(projection.dataset));
      assert.equal(local.db.prepare('SELECT COUNT(*) n FROM company').get().n,0);
      receiving=receiver({transport:device.transport,replica,files});
      memberReceiving=receiver({transport:member.transport,replica:memberReplica,files:memberFiles});
    });
    const pub=(p,r,parent=null,transport=author.transport,extra={})=>publish({projection:p,revisionId:r,parentRevisionId:parent,transport,files:f.files,journal,...extra});
    await run('No network before begin preserves empty Company pointer',async()=>{
      await assert.rejects(pub(projection,'offline',null,{call:async()=>{throw unavailable();}},{attempts:2}),/network/);
      assert.equal((await author.transport.access(f.company.id)).currentRevisionId,null);
    });
    await run('Interrupted SDS upload and duplicate upload resume with durable same-revision journal',async()=>{
      let lost=false;
      const transport={call:async(name,data)=>{const result=await author.transport.call(name,data);if(name==='uploadPublicationSds'&&!lost){lost=true;throw unavailable();}return result;}};
      await assert.rejects(pub(projection,'rev1',null,transport,{attempts:1}),/network/);
      assert.equal((await author.transport.access(f.company.id)).currentRevisionId,null);
      assert.equal((await db.doc('companies/pipeline-company/publishedRevisions/rev1/attachments/sds-0000').get()).get('published'),false);
      let finalLost=false;
      const loss={call:async(name,data)=>{const result=await author.transport.call(name,data);if(name==='finalizePublication'&&!finalLost){finalLost=true;throw unavailable();}return result;}};
      await assert.rejects(pub(projection,'rev1',null,loss,{attempts:1}),/network/);
      assert.equal((await author.transport.access(f.company.id)).currentRevisionId,'rev1');
      // New service call resumes from the persisted journal; published retry must validate content.
      let uploads=0;
      const retried=await pub(projection,'rev1',null,{call:async(n,d)=>{if(n==='uploadPublicationSds')uploads++;return author.transport.call(n,d);}});
      assert.equal(retried.revisionNumber,1);assert.equal(uploads,0);
    });
    await run('Device B downloads authenticated records and SDS into its own empty SQLite database',async()=>{
      assert.equal((await receiving.sync(f.company.id)).changed,true);
      assert.notEqual(local.db,f.sql.db);
      const imported=await buildPublication(local,f.company.id,files);
      assert.equal(imported.fingerprint,projection.fingerprint);
      assert.equal((await receiving.sync(f.company.id)).changed,false);
      assert.equal(local.db.prepare('PRAGMA foreign_key_check').all().length,0);
    });
    await run('Changed author state needs a new revision; stale-parent staging cannot win',async()=>{
      await author.transport.call('beginPublication',{companyId:f.company.id,revisionId:'stale',parentRevisionId:'rev1'});
      f.sql.db.exec("UPDATE chemical_product SET product_name='Updated synthetic cleaner' WHERE id='product-0000'; UPDATE work_area_assignment SET ended_date='2026-03-01' WHERE id='assignment-0001';");
      revision2=await buildPublication(f.sql,f.company.id,f.files);
      await assert.rejects(pub(revision2,'rev1'),/new revision ID/);
      const result=await pub(revision2,'rev2','rev1');assert.equal(result.revisionNumber,2);
      await assert.rejects(author.transport.call('finalizePublication',{companyId:f.company.id,revisionId:'stale',dataset:projection.dataset,attachmentIds:[]}));
      assert.equal((await author.transport.access(f.company.id)).currentRevisionId,'rev2');
    });
    await run('Revision 2 download corruption/interruption and partial SQLite failure retain revision 1',async()=>{
      const prior=await replica.state();
      for(const transport of [
        {...device.transport,download:async()=>{throw unavailable();}},
        {...device.transport,download:async(p,s)=>{const b=new Uint8Array(await device.transport.download(p,s));b[b.length-1]^=1;return b;}}
      ]) {await assert.rejects(receiver({transport,replica,files}).sync(f.company.id));assert.deepEqual(await replica.state(),prior);}
      local.beforeStatement=i=>{if(i===150)throw Error('Partial SQLite import');};
      await assert.rejects(receiving.sync(f.company.id),/Partial/);assert.deepEqual(await replica.state(),prior);
      assert.equal((await buildPublication(local,f.company.id,files)).fingerprint,projection.fingerprint);
      local.beforeStatement=null;
      assert.equal((await receiving.sync(f.company.id)).changed,true);
      assert.equal((await buildPublication(local,f.company.id,files)).fingerprint,revision2.fingerprint);
    });
    await run('Revision advancing during download aborts activation; next sync recovers',async()=>{
      await pub(revision2,'rev3','rev2');
      let advanced=false;
      const racing={...device.transport,download:async(p,s)=>{const bytes=await device.transport.download(p,s);if(!advanced){advanced=true;await pub(revision2,'rev4','rev3');}return bytes;}};
      await assert.rejects(receiver({transport:racing,replica,files}).sync(f.company.id),/Revision changed/);
      assert.equal((await replica.state()).revisionId,'rev2');
      await receiving.sync(f.company.id);assert.equal((await replica.state()).revisionId,'rev4');
    });
    await run('Member receives only linked Worker assignments and training; Manager-level reads denied',async()=>{
      await author.transport.call('setMembership',{companyId:f.company.id,uid:member.auth.currentUser.uid,role:'member',active:true,workerId:'worker-0000'});
      await memberReceiving.sync(f.company.id);
      assert.equal(memberLocal.db.prepare('SELECT COUNT(*) n FROM worker').get().n,1);
      assert.equal(memberLocal.db.prepare('SELECT COUNT(*) n FROM work_area_assignment').get().n,2);
      assert.equal(memberLocal.db.prepare('SELECT COUNT(*) n FROM chemical_product').get().n,20);
      await assert.rejects(getDocsFromServer(collection(member.db,'companies/pipeline-company/publishedRevisions/rev4/workers')));
      await assert.rejects(member.transport.call('beginPublication',{companyId:f.company.id,revisionId:'member-write',parentRevisionId:'rev4'}));
      await author.transport.call('setMembership',{companyId:f.company.id,uid:member.auth.currentUser.uid,role:'manager',active:true,workerId:'worker-0000'});
      assert.equal((await memberReceiving.sync(f.company.id)).changed,true);assert.equal(memberLocal.db.prepare('SELECT COUNT(*) n FROM worker').get().n,10);
      await author.transport.call('setMembership',{companyId:f.company.id,uid:member.auth.currentUser.uid,role:'member',active:true,workerId:'worker-0000'});
      assert.equal((await memberReceiving.sync(f.company.id)).changed,true);assert.equal(memberLocal.db.prepare('SELECT COUNT(*) n FROM worker').get().n,1);
    });
    await run('Append-only training advances independently, deduplicates and survives republishing',async()=>{
      const event={companyId:f.company.id,assignmentId:'assignment-0000',eventId:'post-publication-event',trainingDate:'2026-02-01'};
      await member.transport.call('recordTrainingCompletion',event);
      await member.transport.call('recordTrainingCompletion',event);
      assert.equal((await receiving.sync(f.company.id)).changed,false);
      assert.equal((await receiving.syncTraining(f.company.id)).added,1);
      assert.equal((await receiving.syncTraining(f.company.id)).added,0);
      assert.equal((await memberReceiving.syncTraining(f.company.id)).added,1);
      assert.equal(memberLocal.db.prepare('SELECT COUNT(*) n FROM training_event').get().n,3);
      // Identical timestamps across two pages; also emulate a late committed event older
      // than a previous scan. A full append-only rescan must discover it next time.
      const batch=db.batch(),timestamp=Timestamp.fromMillis(Date.now()-10000);
      for(let i=0;i<105;i++) {const id=`paged-event-${String(i).padStart(3,'0')}`;batch.create(db.doc(`companies/${f.company.id}/trainingEvents/${id}`),{id,assignmentId:'assignment-0000',workerId:'worker-0000',training_date:'2026-02-01',revisionId:'rev4',createdByAccountId:member.auth.currentUser.uid,createdAt:timestamp});}
      await batch.commit();assert.equal((await receiving.syncTraining(f.company.id)).added,105);assert.equal((await memberReceiving.syncTraining(f.company.id)).added,105);
      await db.doc(`companies/${f.company.id}/trainingEvents/late-event`).create({id:'late-event',assignmentId:'assignment-0000',workerId:'worker-0000',training_date:'2026-02-01',revisionId:'rev4',createdByAccountId:member.auth.currentUser.uid,createdAt:timestamp});
      assert.equal((await receiving.syncTraining(f.company.id)).added,1);assert.equal((await receiving.syncTraining(f.company.id)).added,0);
      await assert.rejects(member.transport.call('recordTrainingCompletion',{...event,assignmentId:'assignment-0002',eventId:'forbidden-event'}));
      f.sql.db.exec("INSERT INTO training_event(id,training_date) VALUES ('post-publication-event','2026-02-01'); INSERT INTO training_event__ownership(id,child_id,relationship_id,work_area_assignment_id) VALUES ('owner-post','post-publication-event','609b3aa7-28ab-498b-8b28-287c5232be85','assignment-0000');");
      const next=await buildPublication(f.sql,f.company.id,f.files);await pub(next,'rev5','rev4');await receiving.sync(f.company.id);await memberReceiving.sync(f.company.id);
      assert.equal(local.db.prepare("SELECT COUNT(*) n FROM training_event WHERE id='post-publication-event'").get().n,1);
      assert.equal((await receiving.syncTraining(f.company.id)).added,0);
      // Historical events retain a separate ledger when their assignment disappears.
      f.sql.db.exec("UPDATE work_area_assignment SET deleted_at='2026-03-01' WHERE id='assignment-0000'");
      const removed=await buildPublication(f.sql,f.company.id,f.files);await pub(removed,'rev6','rev5');await receiving.sync(f.company.id);
      assert.equal(local.db.prepare("SELECT COUNT(*) n FROM replica_training_ledger WHERE id='post-publication-event'").get().n,1);
      assert.equal(local.db.prepare("SELECT COUNT(*) n FROM training_event WHERE id='post-publication-event'").get().n,0);
    });
    await run('Revoked, deleted and deactivated memberships fail closed and block local access gate',async()=>{
      const memberRef=db.doc(`companies/${f.company.id}/memberships/${member.auth.currentUser.uid}`), original=(await memberRef.get()).data();
      const previous=await memberReplica.state();let downloaded=0;
      const revokedDuringDownload={...member.transport,download:async(p,s)=>{const bytes=await member.transport.download(p,s);if(++downloaded===20)await memberRef.update({active:false});return bytes;}};
      await assert.rejects(receiver({transport:revokedDuringDownload,replica:memberReplica,files:memberFiles}).sync(f.company.id));assert.deepEqual(await memberReplica.state(),previous);
      await memberRef.update({active:false});await assert.rejects(memberReceiving.sync(f.company.id));
      await memberRef.delete();await assert.rejects(memberReceiving.sync(f.company.id));
      await memberRef.set(original);await db.doc(`companies/${f.company.id}`).update({active:false});await assert.rejects(memberReceiving.sync(f.company.id));
      await db.doc(`companies/${f.company.id}`).update({active:true});
      const current=await member.transport.access(f.company.id);
      await assert.rejects(memberReplica.assertReadable({...current,workerId:'worker-0001'}),/scope changed/);
      await memberRef.update({role:'unknown'});await assert.rejects(memberReceiving.sync(f.company.id));await memberRef.set(original);
    });
    await run('Malformed/cross-Company/missing references and missing SDS cannot finalize',async()=>{
      const companyId=f.company.id,revisionId='invalid';await author.transport.call('beginPublication',{companyId,revisionId,parentRevisionId:'rev6'});
      for(const data of [
        {...projection.dataset,workers:[]},
        {...projection.dataset,workAreaProducts:[{...projection.dataset.workAreaProducts[0],chemicalProductId:'foreign-company-product'}]},
        {...projection.dataset,unexpected:[]},
      ]) await assert.rejects(author.transport.call('finalizePublication',{companyId,revisionId,dataset:data,attachmentIds:[]}));
      await assert.rejects(author.transport.call('finalizePublication',{companyId,revisionId,dataset:projection.dataset,attachmentIds:['missing-sds']}));
      assert.equal((await author.transport.access(companyId)).currentRevisionId,'rev6');
    });
    await run('Actual foundation boundary evidence: 350/351 records, 3 MB, 100/101 attachments, 5 MiB PDF',async()=>{
      const area=projection.dataset.workAreas[0];
      assert.equal(backendDataset({workAreas:Array.from({length:350},(_,i)=>({...area,id:`area-${i}`}))}).workAreas.length,350);
      assert.throws(()=>backendDataset({workAreas:Array.from({length:351},(_,i)=>({...area,id:`area-${i}`}))}),/350/);
      const byteBoundary={workAreas:Array.from({length:350},(_,i)=>({...area,id:`area-${i}`,name:'n'.repeat(1000),description:'x'.repeat(8000)}))};
      let excess=Buffer.byteLength(JSON.stringify(byteBoundary))-3_000_000;
      for(const row of byteBoundary.workAreas) {const take=Math.min(excess,row.description.length);row.description=row.description.slice(take);excess-=take;if(!excess)break;}
      assert.equal(Buffer.byteLength(JSON.stringify(byteBoundary)),3_000_000);assert.equal(backendDataset(byteBoundary).workAreas.length,350);
      byteBoundary.workAreas[0].description+='x';assert.throws(()=>backendDataset(byteBoundary),/3 MB/);
      const companyId=f.company.id,revisionId='boundaries';await author.transport.call('beginPublication',{companyId,revisionId,parentRevisionId:'rev6'});
      await assert.rejects(author.transport.call('finalizePublication',{companyId,revisionId,dataset:{},attachmentIds:Array.from({length:101},(_,i)=>`a-${i}`)}),/100/);
      // Exactly 100 passes the count check and fails at the expected missing attachment stage.
      await assert.rejects(author.transport.call('finalizePublication',{companyId,revisionId,dataset:{},attachmentIds:Array.from({length:100},(_,i)=>`a-${i}`)}),/SDS upload is missing/i);
      const bytes=Buffer.alloc(limits.pdfBytes,32);bytes.write('%PDF-1.4');
      const uploaded=await author.transport.call('uploadPublicationSds',{companyId,revisionId,attachmentId:'max-pdf',chemicalProductId:'product-0000',base64:bytes.toString('base64')});assert.equal(uploaded.sizeBytes,limits.pdfBytes);
      await assert.rejects(author.transport.call('uploadPublicationSds',{companyId,revisionId,attachmentId:'too-big',chemicalProductId:'product-0000',base64:Buffer.concat([bytes,Buffer.from('x')]).toString('base64')}),/5 MiB/);
      const products=Array.from({length:100},(_,i)=>({...projection.dataset.chemicalProducts[0],id:`product-${i}`}));
      const attachmentIds=[];
      for(let i=0;i<100;i++) {const attachmentId=`boundary-sds-${i}`;await author.transport.call('uploadPublicationSds',{companyId,revisionId,attachmentId,chemicalProductId:products[i].id,base64:Buffer.from(dummyPdf(`Boundary ${i}`)).toString('base64')});attachmentIds.push(attachmentId);}
      const boundary=await author.transport.call('finalizePublication',{companyId,revisionId,dataset:{chemicalProducts:products,workAreas:Array.from({length:250},(_,i)=>({...area,id:`boundary-area-${i}`}))},attachmentIds});
      assert.equal(boundary.revisionNumber,7);
      for(const size of ['medium','large']) {
        const large=await fixture(size);
        try {const p=await buildPublication(large.sql,large.company.id,large.files);await assert.rejects(publish({projection:p,revisionId:'oversize',transport:{call:()=>assert.fail('Capacity preflight must prevent upload')},files:large.files,journal:sqliteJournal(large.sql)}),/Records/); assert.throws(()=>backendDataset(p.dataset),/350/);}
        finally {large.sql.close();}
      }
    });
    await writeFile(new URL('../../../docs/publication-sync-emulator-results.json',import.meta.url),JSON.stringify({executedAt:new Date().toISOString(),passed:results.every(r=>r.result==='PASS'),projectId,transport:'Firebase client SDK -> actual Auth/Functions/Firestore/Storage emulators',elapsedMs:performance.now()-started,results},null,2)+'\n');
  } finally {
    local.close();memberLocal.close();f.sql.close();
    for(const c of clients) {await terminate(c.db);await deleteApp(c.app);}
    await deleteAdminApp(admin);
  }
});
