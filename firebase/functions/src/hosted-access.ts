import {type Transaction,type DocumentData} from 'firebase-admin/firestore';
import {resolveCompanyCommercial} from '@hazcom/core';
import {db} from './access.js';

/** Server-owned absolute deadline, checked against request time by both rulesets.
 * Storage has only two Firestore lookups, so this is materialized on Memberships.
 * Missing/invalid projections fail closed. Updating a subscription must update its
 * audience in the SAME transaction; background fan-out would extend stale access.
 */
export function hostedReadUntil(subscription:DocumentData|undefined,cover:DocumentData|undefined,companyId:string,now=Date.now()):number{
 const resolved=resolveCompanyCommercial(subscription,cover,companyId,now);
 if(!resolved.capabilities.canReadPublished)return 0;
 if(resolved.coverageState==='ending')return Date.parse(String(cover?.exportEndsAt))||0;
 if(resolved.plan==='demo')return 8640000000000000;
 return resolved.graceEndsAt??0;
}
/** Read phase only. Invoke before any writes. Commit may skip rewritten/deleted members. */
export async function hostedAudience(tx:Transaction,companyIds:string[]){
 const rows=await Promise.all([...new Set(companyIds)].map(async companyId=>{
  const cover=await tx.get(db.doc(`companies/${companyId}/coverage/current`));
  const subscription=cover.exists?await tx.get(db.doc(`subscriptions/${cover.get('accountId')}`)):null;
  const members=await tx.get(db.collection(`companies/${companyId}/memberships`));
  return {companyId,cover:cover.data(),subscription:subscription?.data(),members:members.docs};
 }));
 return (overrides:{subscriptions?:Record<string,DocumentData>;coverage?:Record<string,DocumentData>;skip?:Set<string>;now?:number}={})=>{
  for(const row of rows){
   const cover=overrides.coverage?.[row.companyId]??row.cover;
   const subscription=overrides.subscriptions?.[String(cover?.accountId)]??row.subscription;
   const deadline=hostedReadUntil(subscription,cover,row.companyId,overrides.now);
   for(const member of row.members)if(!overrides.skip?.has(member.ref.path)&&member.get('hostedReadUntil')!==deadline)tx.update(member.ref,{hostedReadUntil:deadline});
  }
 };
}

/** Migration rehearsal only. Real backfill requires separately authorized rollout. */
export async function refreshHostedAccessInEmulator(companyIds:string[]){
 if(!process.env.FIRESTORE_EMULATOR_HOST||!String(process.env.GCLOUD_PROJECT).startsWith('demo-'))throw Error('Hosted access migration rehearsal requires a demo emulator.');
 return db.runTransaction(async tx=>{const write=await hostedAudience(tx,companyIds);write();return {companies:companyIds.length};});
}
