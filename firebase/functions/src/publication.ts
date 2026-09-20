import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, identity, membership, coverage, denied } from './access.js';
import { id, object, keys, dataset, fail, text } from './validation.js';

const options = { region:'us-central1', maxInstances:3, memory:'512MiB' as const, timeoutSeconds:120 };
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const revisionRef = (companyId:string, revisionId:string) => db.doc(`companies/${companyId}/publishedRevisions/${revisionId}`);
function pending(data: any, uid:string) {
  if (!data || data.status !== 'staging' || data.createdByAccountId !== uid || data.expiresAt.toMillis() <= Date.now()) denied('Publication is not an active staging session owned by this account.');
}

export const beginPublication = onCall(options, async request => {
  const uid = await identity(request); const input = object(request.data); keys(input,['companyId','revisionId','parentRevisionId']);
  const companyId=id(input.companyId), revisionId=id(input.revisionId);
  const parentRevisionId=input.parentRevisionId == null ? null : id(input.parentRevisionId);
  return db.runTransaction(async tx => {
    const {company} = await membership(tx,uid,companyId,['administrator','manager']); await coverage(tx,companyId);
    const ref=revisionRef(companyId,revisionId), previous=await tx.get(ref);
    if (previous.exists) {
      if (previous.get('createdByAccountId') !== uid || previous.get('parentRevisionId') !== parentRevisionId) throw new HttpsError('already-exists','Revision ID already used.');
      return {revisionId,status:previous.get('status')};
    }
    if (company.get('currentRevisionId') !== parentRevisionId) throw new HttpsError('failed-precondition','Refresh the current revision before publishing.');
    tx.create(ref,{companyId,revisionId,parentRevisionId,status:'staging',createdByAccountId:uid,createdAt:Timestamp.now(),expiresAt:Timestamp.fromMillis(Date.now()+24*60*60*1000)});
    return {revisionId,status:'staging'};
  });
});

// Bounded, trusted upload avoids public signed URLs and Firebase download-token metadata.
export const uploadPublicationSds = onCall(options, async request => {
  const uid=await identity(request); const input=object(request.data); keys(input,['companyId','revisionId','attachmentId','chemicalProductId','base64']);
  const companyId=id(input.companyId), revisionId=id(input.revisionId), attachmentId=id(input.attachmentId), chemicalProductId=id(input.chemicalProductId);
  const encoded=text(input.base64,'PDF base64',7_000_000);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail('Invalid base64.');
  const bytes=Buffer.from(encoded,'base64');
  if (bytes.length > 5*1024*1024 || bytes.subarray(0,5).toString() !== '%PDF-' || bytes.toString('base64') !== encoded) fail('Expected a PDF no larger than 5 MiB.');
  const sha256=hash(bytes), ref=revisionRef(companyId,revisionId), attachmentRef=ref.collection('attachments').doc(attachmentId);
  await db.runTransaction(async tx=> {
    await membership(tx,uid,companyId,['administrator','manager']); await coverage(tx,companyId);
    pending((await tx.get(ref)).data(),uid);
    const existing=await tx.get(attachmentRef);
    if (existing.exists && (existing.get('sha256') !== sha256 || existing.get('ownerId') !== chemicalProductId)) throw new HttpsError('already-exists','Attachment ID is immutable.');
  });
  // Content address prevents concurrent uploads of different content sharing the same object.
  const relativePath=`companies/${companyId}/revisions/${revisionId}/sds/${attachmentId}/${sha256}.pdf`;
  const file=getStorage().bucket().file(relativePath);
  try {
    await file.save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'application/pdf',cacheControl:'private, max-age=0, no-store',metadata:{sha256}}});
  } catch (error:any) {
    if (Number(error.code) !== 412) throw error;
    // A prior successful identical upload is safe to reuse.
  }
  // Firebase may attach a bearer download token even to an administrative upload.
  // Clear it before publication; clients download using authenticated SDK getBytes.
  await file.setMetadata({metadata:{firebaseStorageDownloadTokens:null}});
  const [metadata] = await file.getMetadata();
  if (metadata.metadata?.firebaseStorageDownloadTokens) throw new HttpsError('internal','SDS download-token removal could not be verified.');
  const attachment={attachmentId,ownerType:'chemical_product',ownerId:chemicalProductId,slotKey:'sds',relativePath,sha256,sizeBytes:bytes.length,published:false};
  await db.runTransaction(async tx=> {
    await membership(tx,uid,companyId,['administrator','manager']); await coverage(tx,companyId);
    pending((await tx.get(ref)).data(),uid);
    const existing=await tx.get(attachmentRef);
    if (existing.exists) {
      if (existing.get('sha256') !== sha256 || existing.get('ownerId') !== chemicalProductId) throw new HttpsError('already-exists','Attachment ID is immutable.');
    } else tx.create(attachmentRef,attachment);
  });
  return attachment;
});

export const finalizePublication = onCall(options, async request => {
  const uid=await identity(request); const input=object(request.data); keys(input,['companyId','revisionId','dataset','attachmentIds']);
  const companyId=id(input.companyId), revisionId=id(input.revisionId), rows=dataset(input.dataset);
  if (!Array.isArray(input.attachmentIds) || input.attachmentIds.length > 100) fail('At most 100 SDS attachments are supported per revision.');
  const attachmentIds:string[]=input.attachmentIds.map(id);
  if (new Set(attachmentIds).size !== attachmentIds.length) fail('Duplicate attachment IDs.');
  const payloadHash=hash(JSON.stringify({rows,attachmentIds:[...attachmentIds].sort()}));
  return db.runTransaction(async tx=> {
    const {company}=await membership(tx,uid,companyId,['administrator','manager']); await coverage(tx,companyId);
    const ref=revisionRef(companyId,revisionId), revision=await tx.get(ref);
    if (revision.get('status') === 'published') {
      if (revision.get('createdByAccountId') !== uid || revision.get('payloadHash') !== payloadHash) throw new HttpsError('already-exists','Published revisions cannot be changed.');
      return {revisionId,revisionNumber:revision.get('revisionNumber')};
    }
    pending(revision.data(),uid);
    if (company.get('currentRevisionId') !== revision.get('parentRevisionId')) throw new HttpsError('failed-precondition','Another revision was published. Start a new publication from the latest revision.');
    const attachments=await Promise.all(attachmentIds.map(a=>tx.get(ref.collection('attachments').doc(a))));
    const productIds=new Set<string>();
    for (const attachment of attachments) {
      if (!attachment.exists || !rows.chemicalProducts.some(p=>p.id === attachment.get('ownerId'))) fail('SDS upload is missing or refers to a missing Chemical Product.');
      if (productIds.has(attachment.get('ownerId'))) fail('Only one SDS slot per Chemical Product is permitted in a revision.');
      productIds.add(attachment.get('ownerId'));
    }
    const revisionNumber=company.get('currentRevisionNumber')+1;
    const recordCounts:Record<string,number>={};
    // All rows and the current pointer commit atomically. No partial revision is visible.
    for (const [kind,records] of Object.entries(rows)) {
      recordCounts[kind]=records.length;
      for (const row of records) tx.create(ref.collection(kind).doc(row.id),row);
    }
    for (const attachment of attachments) tx.update(attachment.ref,{published:true});
    tx.update(ref,{schemaVersion:1,status:'published',revisionNumber,publishedAt:Timestamp.now(),payloadHash,recordCounts,attachmentCount:attachments.length,company:{id:companyId,name:company.get('name'),contact_email:company.get('contact_email')}});
    tx.update(company.ref,{currentRevisionId:revisionId,currentRevisionNumber:revisionNumber,publishedAt:Timestamp.now()});
    return {revisionId,revisionNumber};
  });
});
