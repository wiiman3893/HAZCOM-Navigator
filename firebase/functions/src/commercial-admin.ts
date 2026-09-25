import {FieldValue} from 'firebase-admin/firestore';
import {getStorage} from 'firebase-admin/storage';
import {applyBillingEvent,resolveCommercial,cleanupEligible,type BillingEvent,type CommercialState} from '@hazcom/core';
import {db,denied} from './access.js';

/** Trusted adapter only: deliberately not exported as a callable Function. */
export async function applyTrustedBillingEvent(accountId:string,event:BillingEvent,now=Date.now()){
 if(event.subscriptionId!==accountId)throw Error('Billing account mismatch');
 if(Date.parse(event.effectiveAt)>now+60_000)throw Error('Future billing event cannot apply early');
 return db.runTransaction(async tx=>{
  const ref=db.doc(`subscriptions/${accountId}`),snapshot=await tx.get(ref);
  if(!snapshot.exists)throw Error('Subscription missing');
  const raw=snapshot.data()!;
  const state:CommercialState={subscriptionId:accountId,plan:raw.plan,demoType:raw.demoType,tierId:raw.tierId,catalogVersion:raw.catalogVersion??'v1',cadence:raw.cadence,priceVersion:raw.priceVersion,termStartedAt:raw.termStartedAt,basePriceCents:raw.basePriceCents,seatPriceCents:raw.seatPriceCents,billingAdjustments:raw.billingAdjustments??[],paidThrough:raw.paidThrough,graceEndsAt:raw.graceEndsAt,cancelAtPeriodEnd:raw.cancelAtPeriodEnd,seatIds:raw.seatIds??[accountId],coveredCompanyIds:raw.coveredCompanyIds??[],selectedDemoCompanyId:raw.selectedDemoCompanyId,pendingDowngrade:raw.pendingDowngrade,lastVersion:raw.lastVersion??0,appliedEventIds:raw.appliedEventIds??[],audit:raw.audit??[]};
  if(state.appliedEventIds.includes(event.id))return {applied:false,version:state.lastVersion};
  const next=applyBillingEvent(state,event),seatId=String(event.payload.uid??'');
  const related=event.type==='seat_added'||event.type==='seat_removed'?state.coveredCompanyIds:[];
  const ending=state.coveredCompanyIds.filter(companyId=>!next.coveredCompanyIds.includes(companyId));
  const endingCoverage=await Promise.all(ending.map(companyId=>tx.get(db.doc(`companies/${companyId}/coverage/current`))));
  const activeCoverage=event.type==='subscription_renewed'||event.type==='payment_recovered'?await Promise.all(state.coveredCompanyIds.map(companyId=>tx.get(db.doc(`companies/${companyId}/coverage/current`)))):[];
  if(activeCoverage.some(cover=>cover.get('state')==='deleting'))denied('Coverage cleanup has started; recovery requires support.');
  const retained=next.plan==='company'&&next.coveredCompanyIds.length===1?next.coveredCompanyIds[0]:null;
  const retainedCompany=retained?await tx.get(db.doc(`companies/${retained}`)):null;
  const adminUid=String(event.payload.administratorUid??'');
  const adminMember=retained&&adminUid?await tx.get(db.doc(`companies/${retained}/memberships/${adminUid}`)):null;
  const adminAccount=retained&&adminUid?await tx.get(db.doc(`accounts/${adminUid}`)):null;
  const downgradeSeats=retained&&state.plan==='pro'&&next.plan==='company'?state.seatIds:[];
  const downgradeMembers=await Promise.all(downgradeSeats.map(uid=>tx.get(db.doc(`companies/${retained}/memberships/${uid}`))));
  if(retainedCompany&&retainedCompany.get('administratorCount')<1&&(!adminMember?.exists||!adminAccount?.exists))denied('Select an authenticated Company Administrator for paid Company coverage.');
  const seatAccount=event.type==='seat_added'?await tx.get(db.doc(`accounts/${seatId}`)):null;
  if(event.type==='seat_added'&&!seatAccount?.exists)denied('Pro seat must have an authenticated Account.');
  const members=await Promise.all(related.map(companyId=>tx.get(db.doc(`companies/${companyId}/memberships/${seatId}`))));
  if(event.type==='seat_added'&&resolveCommercial(next as unknown as Record<string,unknown>).plan!=='pro')denied('Only Pro has billable seats.');
  if(event.type==='seat_added'||event.type==='seat_removed'){
   for(let i=0;i<related.length;i++){
    const companyId=related[i],previous=members[i],memberRef=db.doc(`companies/${companyId}/memberships/${seatId}`),indexRef=db.doc(`accounts/${seatId}/memberships/${companyId}`);
    if(event.type==='seat_added'){
     const direct=previous.exists?{role:previous.get('role'),active:previous.get('active'),workerId:previous.get('workerId')}:null;
     const inherited={uid:seatId,companyId,role:direct?.role==='administrator'?'administrator':'manager',active:true,workerId:direct?.workerId??null,proTeamSubscriptionId:accountId,directMembership:direct,updatedAt:FieldValue.serverTimestamp()};
     tx.set(memberRef,inherited);tx.set(indexRef,inherited);
    } else if(previous.get('proTeamSubscriptionId')===accountId){
     const direct=previous.get('directMembership');
     if(direct){const restored={uid:seatId,companyId,...direct,updatedAt:FieldValue.serverTimestamp()};tx.set(memberRef,restored);tx.set(indexRef,restored);}
     else {tx.delete(memberRef);tx.delete(indexRef);}
    }
   }
  }
  for(let i=0;i<ending.length;i++)if(endingCoverage[i].get('accountId')===accountId)tx.update(endingCoverage[i].ref,{state:'ending',exportEndsAt:new Date(Date.parse(event.effectiveAt)+14*86400000).toISOString(),updatedAt:FieldValue.serverTimestamp()});
  for(let i=0;i<downgradeSeats.length;i++){
   const uid=downgradeSeats[i],member=downgradeMembers[i];
   if(uid===adminUid||member.get('proTeamSubscriptionId')!==accountId)continue;
   const direct=member.get('directMembership'),memberRef=db.doc(`companies/${retained}/memberships/${uid}`),indexRef=db.doc(`accounts/${uid}/memberships/${retained}`);
   if(direct){const restored={uid,companyId:retained,...direct,updatedAt:FieldValue.serverTimestamp()};tx.set(memberRef,restored);tx.set(indexRef,restored);}
   else {tx.delete(memberRef);tx.delete(indexRef);}
  }
  if(retainedCompany&&retainedCompany.get('administratorCount')<1&&retained&&adminMember){
   const administrator={uid:adminUid,companyId:retained,role:'administrator',active:true,workerId:adminMember.get('workerId')??null,updatedAt:FieldValue.serverTimestamp()};
   tx.set(adminMember.ref,administrator);tx.set(db.doc(`accounts/${adminUid}/memberships/${retained}`),administrator);
   tx.update(retainedCompany.ref,{administratorCount:1,updatedAt:FieldValue.serverTimestamp()});
  }
  tx.update(ref,{...Object.fromEntries(Object.entries(next).filter(([,value])=>value!==undefined)),updatedAt:FieldValue.serverTimestamp()});
  tx.create(db.doc(`subscriptions/${accountId}/commercialAudit/${event.id}`),{id:event.id,type:event.type,version:event.version,source:event.source,effectiveAt:event.effectiveAt,createdAt:FieldValue.serverTimestamp()});
  return {applied:true,version:next.lastVersion};
 });
}

/** Audited client takeover. Commercial coverage switches once; no Company records are copied. */
export async function transferProCompanyToCompany(companyId:string,buyerUid:string,transferId:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(companyId)||!/^[A-Za-z0-9_-]{1,128}$/.test(buyerUid)||!/^[A-Za-z0-9_-]{1,128}$/.test(transferId))throw Error('Invalid transfer identity');
 return db.runTransaction(async tx=>{
  const coverRef=db.doc(`companies/${companyId}/coverage/current`),companyRef=db.doc(`companies/${companyId}`),buyerRef=db.doc(`subscriptions/${buyerUid}`);
  const [cover,company,buyer,account]=await Promise.all([tx.get(coverRef),tx.get(companyRef),tx.get(buyerRef),tx.get(db.doc(`accounts/${buyerUid}`))]);
  if(!cover.exists||!company.exists||!account.exists)denied('Transfer context missing');
  if(cover.get('accountId')===buyerUid&&cover.get('transferId')===transferId)return {transferred:false,companyId};
  const priorOwner=cover.get('accountId');
  if(cover.get('state')==='deleting')denied('Company cleanup has started.');
  const oldRef=db.doc(`subscriptions/${priorOwner}`),old=await tx.get(oldRef);
  const oldCommercial=resolveCommercial(old.data()),newCommercial=resolveCommercial(buyer.data());
  if(oldCommercial.plan!=='pro'||newCommercial.plan!=='company'||!newCommercial.capabilities.canCreateCompanies)denied('Pro-to-Company transfer requires valid paid coverage.');
  const newCovered:string[]=buyer.get('coveredCompanyIds')??[];
  if(!newCovered.includes(companyId)&&newCovered.length>=newCommercial.capabilities.maxCoveredCompanies)denied('Purchaser Company limit reached.');
  const seats:string[]=old.get('seatIds')??[priorOwner];
  const members=await Promise.all(seats.map(uid=>tx.get(db.doc(`companies/${companyId}/memberships/${uid}`))));
  const buyerMember=seats.includes(buyerUid)?members[seats.indexOf(buyerUid)]:await tx.get(db.doc(`companies/${companyId}/memberships/${buyerUid}`));
  for(let i=0;i<seats.length;i++){
   const uid=seats[i],member=members[i];if(member.get('proTeamSubscriptionId')!==priorOwner)continue;
   const mref=db.doc(`companies/${companyId}/memberships/${uid}`),iref=db.doc(`accounts/${uid}/memberships/${companyId}`),direct=member.get('directMembership');
   if(uid===buyerUid)continue;
   if(direct){const restored={uid,companyId,...direct,updatedAt:FieldValue.serverTimestamp()};tx.set(mref,restored);tx.set(iref,restored);}
   else {tx.delete(mref);tx.delete(iref);}
  }
  const adminWas=buyerMember.get('active')===true&&buyerMember.get('role')==='administrator';
  const administrator={uid:buyerUid,companyId,role:'administrator',active:true,workerId:buyerMember.get('workerId')??null,updatedAt:FieldValue.serverTimestamp()};
  tx.set(db.doc(`companies/${companyId}/memberships/${buyerUid}`),administrator);
  tx.set(db.doc(`accounts/${buyerUid}/memberships/${companyId}`),administrator);
  tx.update(companyRef,{administratorCount:(company.get('administratorCount')??0)+(adminWas?0:1),updatedAt:FieldValue.serverTimestamp()});
  tx.set(coverRef,{accountId:buyerUid,state:'active',transferId,transferredFrom:priorOwner,updatedAt:FieldValue.serverTimestamp()});
  tx.update(oldRef,{coveredCompanyIds:FieldValue.arrayRemove(companyId),coveredCompanyCount:FieldValue.increment(-1)});
  if(!newCovered.includes(companyId))tx.update(buyerRef,{coveredCompanyIds:FieldValue.arrayUnion(companyId),coveredCompanyCount:FieldValue.increment(1)});
  tx.create(db.doc(`companies/${companyId}/commercialAudit/${transferId}`),{type:'coverage_transferred',from:priorOwner,to:buyerUid,createdAt:FieldValue.serverTimestamp()});
  return {transferred:true,companyId};
 });
}

/** Attach a paid Company subscription to an uncovered existing Company without changing roles. */
export async function attachExistingCompanyCoverage(companyId:string,purchaserUid:string,attachmentId:string){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(companyId)||!/^[A-Za-z0-9_-]{1,128}$/.test(purchaserUid)||!/^[A-Za-z0-9_-]{1,128}$/.test(attachmentId))throw Error('Invalid coverage attachment identity');
 return db.runTransaction(async tx=>{
  const companyRef=db.doc(`companies/${companyId}`),coverRef=db.doc(`companies/${companyId}/coverage/current`),subRef=db.doc(`subscriptions/${purchaserUid}`);
  const [company,cover,sub,member]=await Promise.all([tx.get(companyRef),tx.get(coverRef),tx.get(subRef),tx.get(db.doc(`companies/${companyId}/memberships/${purchaserUid}`))]);
  if(cover.exists){if(cover.get('accountId')===purchaserUid&&cover.get('attachmentId')===attachmentId)return {attached:false};denied('Company already has commercial coverage.');}
  const commercial=resolveCommercial(sub.data()),covered:string[]=sub.get('coveredCompanyIds')??[];
  if(!company.exists||company.get('active')!==true||company.get('administratorCount')<1||!member.exists||member.get('active')!==true||!['administrator','manager'].includes(member.get('role')))denied('Existing Company requires an Administrator and purchaser Membership.');
  if(commercial.plan!=='company'||!commercial.capabilities.canCreateCompanies||covered.length>=commercial.capabilities.maxCoveredCompanies)denied('Active Company coverage capacity required.');
  tx.create(coverRef,{accountId:purchaserUid,state:'active',attachmentId,updatedAt:FieldValue.serverTimestamp()});
  tx.update(subRef,{coveredCompanyIds:FieldValue.arrayUnion(companyId),coveredCompanyCount:FieldValue.increment(1)});
  tx.create(db.doc(`companies/${companyId}/commercialAudit/${attachmentId}`),{type:'company_coverage_attached',purchaserUid,roleAtPurchase:member.get('role'),createdAt:FieldValue.serverTimestamp()});
  return {attached:true,role:member.get('role')};
 });
}

/** Pro owner releases a client Company into a 14-day read/export window. */
export async function releaseProCompany(ownerUid:string,companyId:string,releaseId:string,now=Date.now()){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(ownerUid)||!/^[A-Za-z0-9_-]{1,128}$/.test(companyId)||!/^[A-Za-z0-9_-]{1,128}$/.test(releaseId))throw Error('Invalid release identity');
 return db.runTransaction(async tx=>{
  const coverRef=db.doc(`companies/${companyId}/coverage/current`),subRef=db.doc(`subscriptions/${ownerUid}`),auditRef=db.doc(`companies/${companyId}/commercialAudit/${releaseId}`);
  const [cover,sub,audit]=await Promise.all([tx.get(coverRef),tx.get(subRef),tx.get(auditRef)]);
  if(audit.exists&&audit.get('type')==='pro_company_released')return {released:false,exportEndsAt:audit.get('exportEndsAt')};
  if(!cover.exists||cover.get('accountId')!==ownerUid||cover.get('state')==='deleting')denied('Company is not under this Pro coverage.');
  if(cover.get('state')==='ending')denied('Company release is already pending.');
  const resolution=resolveCommercial(sub.data(),now);
  if(resolution.plan!=='pro'||!resolution.capabilities.canUseProTeam)denied('Active Pro owner coverage required.');
  const end=new Date(now+14*86400000).toISOString();
  tx.update(coverRef,{state:'ending',exportEndsAt:end,releaseId,updatedAt:FieldValue.serverTimestamp()});
  tx.update(subRef,{coveredCompanyIds:FieldValue.arrayRemove(companyId),coveredCompanyCount:FieldValue.increment(-1)});
  tx.create(auditRef,{type:'pro_company_released',ownerUid,companyId,exportEndsAt:end,createdAt:FieldValue.serverTimestamp()});
  return {released:true,exportEndsAt:end};
 });
}

/** Deliberately emulator-only; never deploy or invoke against a real Company. */
export async function cleanupExpiredCompanyInEmulator(companyId:string,expectedOwner:string,cleanupId:string,now=Date.now()){
 if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_STORAGE_EMULATOR_HOST||!String(process.env.GCLOUD_PROJECT).startsWith('demo-'))throw Error('Commercial deletion is permitted only in a demo Firebase emulator project.');
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(companyId)||!/^[A-Za-z0-9_-]{1,128}$/.test(expectedOwner)||!/^[A-Za-z0-9_-]{1,128}$/.test(cleanupId))throw Error('Invalid cleanup identity');
 const companyRef=db.doc(`companies/${companyId}`),coverRef=db.doc(`companies/${companyId}/coverage/current`),auditRef=db.doc(`commercialCleanupAudit/${cleanupId}`);
 const claimed=await db.runTransaction(async tx=>{
  const [company,cover,subscription,audit]=await Promise.all([tx.get(companyRef),tx.get(coverRef),tx.get(db.doc(`subscriptions/${expectedOwner}`)),tx.get(auditRef)]);
  if(!company.exists)return false;
  if(!cover.exists||cover.get('accountId')!==expectedOwner)return false;
  if(cover.get('state')==='deleting')return cover.get('cleanupId')===cleanupId;
  if(audit.exists)throw Error('Cleanup ID already used');
  const resolution=resolveCommercial(subscription.data(),now);
  const deadline=cover.get('state')==='ending'?Date.parse(cover.get('exportEndsAt')):resolution.graceEndsAt;
  if(!deadline||!cleanupEligible({subscriptionId:expectedOwner,graceEndsAt:new Date(deadline).toISOString()},{subscriptionId:cover.get('accountId')},now))return false;
  if(cover.get('state')!=='ending'&&resolution.status!=='expired')return false;
  tx.update(coverRef,{state:'deleting',cleanupId,updatedAt:FieldValue.serverTimestamp()});
  tx.update(companyRef,{active:false,updatedAt:FieldValue.serverTimestamp()});
  tx.create(auditRef,{cleanupId,companyId,expectedOwner,status:'started',claimedAt:FieldValue.serverTimestamp()});
  return true;
 });
 if(!claimed)return {deleted:false};
 const [files]=await getStorage().bucket().getFiles({prefix:`companies/${companyId}/`});
 for(const file of files)await file.delete({ignoreNotFound:true});
 await db.recursiveDelete(companyRef);
 await auditRef.update({status:'completed',completedAt:FieldValue.serverTimestamp(),storageObjectsDeleted:files.length});
 return {deleted:true,storageObjectsDeleted:files.length};
}
