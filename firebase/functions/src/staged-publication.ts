import {Timestamp,FieldPath,type Transaction} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {onCall,onRequest,HttpsError} from 'firebase-functions/v2/https';
import {db,auth,identity,membership,coverage,denied} from './access.js';
import {object,keys,id,schemas} from './validation.js';
import {STAGED_LIMITS,assert,manifest,hash,bytesHash,chunkRows,descriptor,attachment,storagePath,entityKinds} from './staged-contract.js';
import {enforcePublicationLimits,resolveCommercial} from '@hazcom/core';

const options={region:'us-central1',maxInstances:3,memory:'512MiB' as const,timeoutSeconds:120};
const revisionRef=(c:string,r:string)=>db.doc(`companies/${c}/publishedRevisions/${r}`);
function inputContext(value:unknown,extra:string[]=[]) {
  const input=object(value);keys(input,['companyId','revisionId',...extra]);
  return {input,companyId:id(input.companyId),revisionId:id(input.revisionId)};
}
async function authorized(tx:Transaction,uid:string,c:string,r:string,states:string[]) {
  const {company}=await membership(tx,uid,c,['administrator','manager']);await coverage(tx,c,'canPublish');
  const ref=revisionRef(c,r),revision=await tx.get(ref),data=revision.data();
  assert(data?.schemaVersion===2,'Expected staged publication schema v2');
  if(data.createdByAccountId!==uid||!states.includes(data.status))denied('Revision is not owned by this account or has an incompatible state');
  if(data.status!=='published'&&data.expiresAt.toMillis()<=Date.now())denied('Staging expired; start a new revision');
  return {company,ref,revision,data};
}
function samePlan(value:any,expectedHash:string) {assert(value.manifestHash===expectedHash,'Manifest identity changed');}

export const beginStagedPublication=onCall(options,async request=>{
  const uid=await identity(request),input=object(request.data);keys(input,['manifest','manifestHash']);
  const plan=manifest(input.manifest,uid),manifestHash=hash(plan);assert(input.manifestHash===manifestHash,'Manifest hash mismatch');
  return db.runTransaction(async tx=>{
    const {company}=await membership(tx,uid,plan.companyId,['administrator','manager']);const subscription=await coverage(tx,plan.companyId,'canPublish');
    enforcePublicationLimits(resolveCommercial(subscription.data()).capabilities,plan.recordCounts);
    assert(company.get('name')===plan.company.name&&company.get('contact_email')===plan.company.contact_email,'Company context changed');
    const ref=revisionRef(plan.companyId,plan.revisionId),old=await tx.get(ref);
    if(old.exists) {
      assert(old.get('schemaVersion')===2&&old.get('manifestHash')===manifestHash&&old.get('createdByAccountId')===uid,'Revision ID already has different content/schema');
      if(['abandoned','cleaned'].includes(old.get('status')))denied('Abandoned revision ID cannot be reused');
      if(old.get('status')!=='published'&&old.get('expiresAt').toMillis()<=Date.now())denied('Staging expired');
      if(old.get('status')!=='published')assert(company.get('currentRevisionId')===plan.parentRevisionId,'Stale publication parent');
      return {revisionId:plan.revisionId,status:old.get('status'),manifestHash};
    }
    assert(company.get('currentRevisionId')===plan.parentRevisionId,'Stale publication parent');
    const now=Timestamp.now();
    tx.create(ref,{schemaVersion:2,companyId:plan.companyId,revisionId:plan.revisionId,parentRevisionId:plan.parentRevisionId,createdByAccountId:uid,company:plan.company,createdAt:now,expiresAt:Timestamp.fromMillis(now.toMillis()+86400000),status:'staging',manifestHash,contentHash:plan.contentHash,recordCounts:plan.recordCounts,attachmentCount:plan.attachmentCount,chunkCount:plan.chunks.length,validationCursor:0});
    // Private to the author while staging; contains Worker ID ranges. Published Managers may verify it.
    tx.create(ref.collection('stagingPlan').doc('root'),plan);
    return {revisionId:plan.revisionId,status:'staging',manifestHash};
  });
});

export const stagePublicationChunk=onCall(options,async request=>{
  const uid=await identity(request),{input,companyId,revisionId}=inputContext(request.data,['chunkId','rows','manifestHash']);
  const chunkId=id(input.chunkId);
  return db.runTransaction(async tx=>{
    const {ref,data}=await authorized(tx,uid,companyId,revisionId,['staging']);samePlan(data,input.manifestHash);
    const [planDoc,receipt]=await Promise.all([tx.get(ref.collection('stagingPlan').doc('root')),tx.get(ref.collection('chunkReceipts').doc(chunkId))]);
    const expected=planDoc.get('chunks').find((d:any)=>d.chunkId===chunkId);assert(expected,'Chunk is not in accepted manifest');
    const records=chunkRows(expected.kind,input.rows),actual=descriptor(expected.kind,chunkId,records);
    assert(Object.entries(actual).every(([key,value])=>expected[key]===value),'Chunk hash/count/range/size differs from manifest');
    if(receipt.exists) {assert(receipt.get('sha256')===actual.sha256,'Conflicting duplicate chunk');return {chunkId,duplicate:true};}
    if(expected.kind==='attachments') for(const a of records) {
      tx.create(ref.collection('attachments').doc(a.attachmentId),{...a,relativePath:storagePath(companyId,revisionId,a),verified:false});
      // Uniqueness is global within the revision, even across concurrent plan chunks.
      tx.create(ref.collection('sdsOwners').doc(a.ownerId),{attachmentId:a.attachmentId});
    } else for(const row of records)tx.create(ref.collection(expected.kind).doc(row.id),row);
    tx.create(ref.collection('chunkReceipts').doc(chunkId),{...actual,completedAt:Timestamp.now()});
    return {chunkId,duplicate:false,documentWrites:records.length*(expected.kind==='attachments'?2:1)+1};
  });
});

export const getPublicationProgress=onCall(options,async request=>{
  const uid=await identity(request),{input,companyId,revisionId}=inputContext(request.data,['kind','afterId']);
  assert(['chunks','attachments'].includes(input.kind),'Invalid progress kind');const afterId=input.afterId==null?null:id(input.afterId);
  const {ref,data}=await db.runTransaction(tx=>authorized(tx,uid,companyId,revisionId,['staging','sealed','ready','published']));
  let q=input.kind==='chunks'?ref.collection('chunkReceipts').orderBy(FieldPath.documentId()):ref.collection('attachments').where('verified','==',true).orderBy(FieldPath.documentId());
  if(afterId)q=q.startAfter(afterId);
  const page=await q.limit(200).get();
  return {status:data.status,manifestHash:data.manifestHash,validationCursor:data.validationCursor,revisionNumber:data.revisionNumber??null,completedIds:page.docs.map(d=>d.id),afterId:page.size===200?page.docs.at(-1)!.id:null};
});

// Binary upload is bounded to one 5 MiB PDF; resume is per completed file, not base64 callables.
// No signed upload URL or client Storage write permission is granted.
export const uploadStagedSds=onRequest({...options,cors:['http://localhost:1420','http://localhost:1421','http://tauri.localhost','https://tauri.localhost']},async(req,res)=>{
  try {
    assert(req.method==='POST','POST required');
    const bearer=req.get('authorization')??'';if(!bearer.startsWith('Bearer '))throw new HttpsError('unauthenticated','Sign in required');
    const token=await auth.verifyIdToken(bearer.slice(7),true);
    const uid=await identity({auth:{uid:token.uid,token}} as any);
    const companyId=id(req.query.companyId),revisionId=id(req.query.revisionId),attachmentId=id(req.query.attachmentId);
    const bytes=req.rawBody;
    assert(Buffer.isBuffer(bytes)&&bytes.length<=STAGED_LIMITS.pdfBytes&&bytes.subarray(0,5).toString()==='%PDF-','Expected PDF no larger than 5 MiB');
    const sha256=bytesHash(bytes);
    const initial=await db.runTransaction(async tx=>{
      const context=await authorized(tx,uid,companyId,revisionId,['staging','published']);
      const expected=await tx.get(context.ref.collection('attachments').doc(attachmentId));assert(expected.exists,'Upload SDS plan chunk first');
      assert(expected.get('sha256')===sha256&&expected.get('sizeBytes')===bytes.length,'SDS SHA-256 or size differs from immutable manifest');
      if(context.data.status==='published')assert(expected.get('verified')===true,'Published SDS missing verified receipt');
      return {...context,attachment:expected.data()!};
    });
    if(initial.attachment.verified) {res.json({...initial.attachment,duplicate:true});return;}
    const relativePath=storagePath(companyId,revisionId,initial.attachment),file=getStorage().bucket().file(relativePath);
    try {await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/pdf',cacheControl:'private, max-age=0, no-store',metadata:{sha256,manifestHash:initial.data.manifestHash,companyId,revisionId,attachmentId,ownerId:initial.attachment.ownerId}}});}
    catch(error:any){if(Number(error.code)!==412)throw error;}
    await file.setMetadata({metadata:{firebaseStorageDownloadTokens:null}});
    const [metadata]=await file.getMetadata();
    assert(!metadata.metadata?.firebaseStorageDownloadTokens&&metadata.metadata?.sha256===sha256&&metadata.metadata?.manifestHash===initial.data.manifestHash&&Number(metadata.size)===bytes.length,'Stored SDS integrity/token verification failed');
    const result=await db.runTransaction(async tx=>{
      const {ref,data}=await authorized(tx,uid,companyId,revisionId,['staging']);samePlan(data,initial.data.manifestHash);
      const target=ref.collection('attachments').doc(attachmentId),current=await tx.get(target);
      assert(current.get('sha256')===sha256&&current.get('sizeBytes')===bytes.length,'SDS plan changed');
      if(current.get('verified'))return current.data()!;
      const complete={...initial.attachment,verified:true,generation:String(metadata.generation)};
      tx.update(target,complete);return complete;
    });
    res.json(result);
  } catch(error:any) {
    const code=error.code??'internal',status=code==='unauthenticated'?401:code==='permission-denied'?403:code==='invalid-argument'||code==='failed-precondition'?400:500;
    res.status(status).json({error:{code:typeof code==='string'?code:'internal',message:status===500?'SDS upload failed; retry safely':error.message}});
  }
});

export const sealPublication=onCall(options,async request=>{
  const uid=await identity(request),{input,companyId,revisionId}=inputContext(request.data,['manifestHash']);
  const initial=await db.runTransaction(tx=>authorized(tx,uid,companyId,revisionId,['staging','sealed','ready','published']));samePlan(initial.data,input.manifestHash);
  if(initial.data.status!=='staging')return {status:initial.data.status};
  const [chunks,files]=await Promise.all([initial.ref.collection('chunkReceipts').count().get(),initial.ref.collection('attachments').where('verified','==',true).count().get()]);
  assert(chunks.data().count===initial.data.chunkCount&&files.data().count===initial.data.attachmentCount,'Publication is incomplete; upload missing chunks/SDS before sealing');
  return db.runTransaction(async tx=>{
    const {ref,data}=await authorized(tx,uid,companyId,revisionId,['staging','sealed','ready','published']);samePlan(data,input.manifestHash);
    if(data.status!=='staging')return {status:data.status};
    // Completion is monotonic while staging. Every chunk/file commit reads this state;
    // sealing conflicts with any concurrent writer and prevents all subsequent mutation.
    const status=data.chunkCount===0?'ready':'sealed';
    tx.update(ref,{status,sealedAt:Timestamp.now(),validationCursor:0,...(status==='ready'?{validatedManifestHash:data.manifestHash}:{})});
    return {status};
  });
});

export const validatePublicationPage=onCall(options,async request=>{
  const uid=await identity(request),{input,companyId,revisionId}=inputContext(request.data,['manifestHash']);
  const initial=await db.runTransaction(tx=>authorized(tx,uid,companyId,revisionId,['sealed','ready','published']));samePlan(initial.data,input.manifestHash);
  if(initial.data.status!=='sealed')return {status:initial.data.status,validationCursor:initial.data.validationCursor};
  const planDoc=await initial.ref.collection('stagingPlan').doc('root').get(),plan=manifest(planDoc.data(),uid);assert(hash(plan)===initial.data.manifestHash,'Stored manifest changed');
  const cursor=initial.data.validationCursor,selected=plan.chunks.slice(cursor,cursor+STAGED_LIMITS.validationChunks);
  let recordReads=0,referenceReads=0,storageMetadataReads=0;
  for(const expected of selected) {
    const receipt=await initial.ref.collection('chunkReceipts').doc(expected.chunkId).get();assert(receipt.exists&&receipt.get('sha256')===expected.sha256,'Missing/modified chunk receipt');
    const kind=expected.kind,collection=initial.ref.collection(kind);
    const docs=await collection.orderBy(FieldPath.documentId()).startAt(expected.firstId).endAt(expected.lastId).limit(STAGED_LIMITS.chunkRecords+1).get();recordReads+=docs.size;
    const values=docs.docs.map(d=>kind==='attachments'?attachment(Object.fromEntries(['attachmentId','ownerType','ownerId','slotKey','sha256','sizeBytes'].map(k=>[k,d.get(k)]))):d.data());
    const normalized=chunkRows(kind,values);assert(hash(descriptor(kind,expected.chunkId,normalized))===hash(expected),'Staged chunk bytes/count/hash changed');
    const references=new Map<string,FirebaseFirestore.DocumentReference>();
    for(const row of normalized) {
      if(kind==='attachments')references.set(`chemicalProducts/${row.ownerId}`,initial.ref.collection('chemicalProducts').doc(row.ownerId));
      else for(const [field,target] of Object.entries(schemas[kind].refs??{}))references.set(`${target}/${row[field]}`,initial.ref.collection(target).doc(row[field]));
    }
    const found=references.size?await db.getAll(...references.values()):[];referenceReads+=found.length;
    assert(found.every(d=>d.exists),'Broken or cross-Company relationship');
    const byPath=new Map(found.map(d=>[d.ref.path,d.data()!]));
    if(kind==='trainingEvents')for(const row of normalized)assert(byPath.get(initial.ref.collection('workAreaAssignments').doc(row.assignmentId).path)?.workerId===row.workerId,'Training Worker differs from assignment');
    if(kind==='attachments') {
      // Bounded parallel metadata checks; content SHA was calculated from received bytes at upload.
      for(let offset=0;offset<docs.size;offset+=8)await Promise.all(docs.docs.slice(offset,offset+8).map(async d=>{
        const a=d.data();assert(a.verified===true&&a.relativePath===storagePath(companyId,revisionId,a),'Missing verified SDS');
        const [stored]=await getStorage().bucket().file(a.relativePath).getMetadata();storageMetadataReads++;
        assert(String(stored.generation)===a.generation&&Number(stored.size)===a.sizeBytes&&stored.metadata?.sha256===a.sha256&&stored.metadata?.manifestHash===initial.data.manifestHash&&!stored.metadata?.firebaseStorageDownloadTokens,'SDS generation/hash/size/token mismatch');
      }));
    }
  }
  return db.runTransaction(async tx=>{
    const {ref,data}=await authorized(tx,uid,companyId,revisionId,['sealed','ready','published']);samePlan(data,input.manifestHash);
    if(data.status!=='sealed'||data.validationCursor!==cursor)return {status:data.status,validationCursor:data.validationCursor};
    const validationCursor=cursor+selected.length,status=validationCursor===plan.chunks.length?'ready':'sealed';
    tx.update(ref,{validationCursor,status,...(status==='ready'?{validatedManifestHash:data.manifestHash,validatedAt:Timestamp.now()}:{})});
    return {status,validationCursor,work:{recordReads,referenceReads,storageMetadataReads}};
  });
});

export const finalizeStagedPublication=onCall(options,async request=>{
  const uid=await identity(request),{input,companyId,revisionId}=inputContext(request.data,['manifestHash']);
  return db.runTransaction(async tx=>{
    const {company,ref,data}=await authorized(tx,uid,companyId,revisionId,['ready','published']);samePlan(data,input.manifestHash);
    if(data.status==='published')return {revisionId,revisionNumber:data.revisionNumber,duplicate:true};
    assert(data.validatedManifestHash===data.manifestHash&&data.validationCursor===data.chunkCount,'Completeness validation is not finished');
    assert(company.get('currentRevisionId')===data.parentRevisionId,'Stale publication parent');
    const revisionNumber=company.get('currentRevisionNumber')+1,publishedAt=Timestamp.now();
    // Exactly TWO writes, independent of entity/file count. Visibility depends on this state.
    tx.update(ref,{status:'published',revisionNumber,publishedAt});
    tx.update(company.ref,{currentRevisionId:revisionId,currentRevisionNumber:revisionNumber,publishedAt});
    return {revisionId,revisionNumber,criticalTransactionWrites:2};
  });
});

export const abandonPublication=onCall(options,async request=>{
  const uid=await identity(request),{companyId,revisionId}=inputContext(request.data);
  return db.runTransaction(async tx=>{
    const {company,member}=await membership(tx,uid,companyId,['administrator','manager']);
    const ref=revisionRef(companyId,revisionId),revision=await tx.get(ref);
    assert(revision.get('schemaVersion')===2&&revision.get('status')!=='published'&&company.get('currentRevisionId')!==revisionId,'Cannot abandon published revision');
    if(revision.get('createdByAccountId')!==uid&&member.get('role')!=='administrator')denied('Only creator or Company Administrator may abandon');
    if(revision.get('status')==='abandoned')return {status:'abandoned'};
    tx.update(ref,{status:'abandoned',abandonedAt:Timestamp.now(),deleteAfter:Timestamp.fromMillis(Date.now()+180000)});
    return {status:'abandoned'};
  });
});

// Privileged cleanup core: retains an irreversible tombstone; bounded, repeatable pages.
// A future IAM scheduler can call this core. The public wrapper requires Company Administrator.
export async function cleanupStagedRevision(companyId:string,revisionId:string) {
  id(companyId);id(revisionId);const ref=revisionRef(companyId,revisionId);
  const state=await db.runTransaction(async tx=>{
    const [revision,company]=await Promise.all([tx.get(ref),tx.get(db.doc(`companies/${companyId}`))]);
    assert(revision.get('schemaVersion')===2&&revision.get('status')!=='published'&&company.get('currentRevisionId')!==revisionId,'Cleanup never targets published/current revisions');
    if(revision.get('status')!=='abandoned') {
      assert(revision.get('expiresAt').toMillis()<=Date.now(),'Staging is not expired/abandoned');
      tx.update(ref,{status:'abandoned',abandonedAt:Timestamp.now(),deleteAfter:Timestamp.fromMillis(Date.now()+180000)});return {waiting:true};
    }
    return {waiting:revision.get('deleteAfter').toMillis()>Date.now()};
  });
  if(state.waiting)return {done:false,waiting:true};
  const [files]=await getStorage().bucket().getFiles({prefix:`companies/${companyId}/revisions-v2/${revisionId}/`,maxResults:100,autoPaginate:false});
  if(files.length) {
    for(let start=0;start<files.length;start+=8)await Promise.all(files.slice(start,start+8).map(async file=>{try{await file.delete({ifGenerationMatch:Number(file.metadata.generation)});}catch(error:any){if(![404,412].includes(Number(error.code)))throw error;}}));
    return {done:false,objectsDeleted:files.length};
  }
  for(const kind of [...entityKinds,'attachments','sdsOwners','chunkReceipts','stagingPlan']) {
    const docs=await ref.collection(kind).limit(100).get();
    if(docs.size) {const batch=db.batch();docs.docs.forEach(d=>batch.delete(d.ref));await batch.commit();return {done:false,documentsDeleted:docs.size};}
  }
  await ref.update({cleanupCompletedAt:Timestamp.now()});
  return {done:true};
}
export const cleanupStagedPublication=onCall(options,async request=>{
  const uid=await identity(request),{companyId,revisionId}=inputContext(request.data);
  await db.runTransaction(tx=>membership(tx,uid,companyId,['administrator']));
  return cleanupStagedRevision(companyId,revisionId);
});
