import {FieldValue} from 'firebase-admin/firestore';
import {issueBackupToken,redeemBackupToken,resolveCommercial} from '@hazcom/core';
import {db,denied} from './access.js';

export interface DevelopmentOutbox {send(message:{to:string;purpose:'verify_backup_email';companyId:string;token:string}):Promise<void>;}
/** Trusted service only. No production email is sent and this is not a callable. */
export async function beginBackupEmailVerification(ownerUid:string,companyId:string,newEmail:string,outbox:DevelopmentOutbox){
 const cover=await db.doc(`companies/${companyId}/coverage/current`).get();
 if(cover.get('accountId')!==ownerUid)denied('Pro owner required.');
 const subscription=await db.doc(`subscriptions/${ownerUid}`).get();
 if(resolveCommercial(subscription.data()).plan!=='pro')denied('Pro coverage required.');
 const issued=await issueBackupToken('verify_backup_email',companyId,newEmail);
 await db.runTransaction(async tx=>{
  const current=await tx.get(cover.ref);
  if(current.get('accountId')!==ownerUid)denied('Company coverage changed.');
  tx.set(db.doc(`companies/${companyId}/backupEmailPending/current`),{...issued.record,requestedBy:ownerUid,createdAt:FieldValue.serverTimestamp()});
  tx.create(db.doc(`companies/${companyId}/commercialAudit/${issued.record.id}`),{type:'backup_email_verification_requested',requestedBy:ownerUid,newEmail:issued.record.email,createdAt:FieldValue.serverTimestamp()});
 });
 await outbox.send({to:issued.record.email,purpose:'verify_backup_email',companyId,token:issued.token});
 return {pending:true};
}

export async function confirmBackupEmailVerification(companyId:string,token:string,now=Date.now()){
 return db.runTransaction(async tx=>{
  const pendingRef=db.doc(`companies/${companyId}/backupEmailPending/current`),pending=await tx.get(pendingRef);
  if(!pending.exists)denied('No pending backup email verification.');
  const confirmed=await redeemBackupToken(pending.data() as any,token,'verify_backup_email',companyId,now);
  const cover=await tx.get(db.doc(`companies/${companyId}/coverage/current`));
  if(cover.get('accountId')!==pending.get('requestedBy'))denied('Company coverage changed.');
  tx.update(db.doc(`companies/${companyId}`),{backupEmail:confirmed.email,backupEmailVerified:true,updatedAt:FieldValue.serverTimestamp()});
  tx.delete(pendingRef);
  tx.create(db.doc(`companies/${companyId}/commercialAudit/${confirmed.id}-confirmed`),{type:'backup_email_verified',email:confirmed.email,verifiedAt:FieldValue.serverTimestamp()});
  return {email:confirmed.email};
 });
}
