import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { auth, db, identity, membership, coverage, canAuthor, denied } from './access.js';
import { companyFields, id, object, keys, role, date, fail } from './validation.js';
import { resolveCommercial, mayCreateWithinLimit } from '@hazcom/core';

setGlobalOptions({ region: 'us-central1', maxInstances: 3, memory: '512MiB', timeoutSeconds: 120 });
export { beginPublication, uploadPublicationSds, finalizePublication } from './publication.js';

export const bootstrapAccount = onCall(async request => {
  const uid = await identity(request);
  const user = await auth.getUser(uid);
  await db.runTransaction(async tx => {
    const ref = db.doc(`accounts/${uid}`);
    const subscriptionRef=db.doc(`subscriptions/${uid}`);
    const [account, subscription]=await Promise.all([tx.get(ref),tx.get(subscriptionRef)]);
    if (!account.exists) tx.create(ref, { uid, displayName: user.displayName ?? '', email: user.email ?? '', createdAt: FieldValue.serverTimestamp(), activeCompanyId: null });
    if (!subscription.exists) tx.create(subscriptionRef,{accountId:uid,plan:'demo',demoType:'company',catalogVersion:'v1',tierId:'demo_company',coveredCompanyCount:0,selectedDemoCompanyId:null,seatIds:[uid],createdAt:FieldValue.serverTimestamp()});
  });
  return { uid };
});

export const createCompany = onCall(async request => {
  const uid = await identity(request); const data = object(request.data);
  keys(data, ['companyId','company']);
  const companyId = id(data.companyId); const fields = companyFields(data.company);
  return db.runTransaction(async tx => {
    const companyRef = db.doc(`companies/${companyId}`);
    const subscriptionRef = db.doc(`subscriptions/${uid}`);
    const [account, subscription, existing] = await Promise.all([tx.get(db.doc(`accounts/${uid}`)),tx.get(subscriptionRef),tx.get(companyRef)]);
    if (!account.exists) throw new HttpsError('failed-precondition','Bootstrap your Account first.');
    if (existing.exists) {
      if (existing.get('createdByAccountId') !== uid) denied('Company ID already used.');
      return { companyId, created: false };
    }
    const resolved=resolveCommercial(subscription.data());
    if (!resolved.capabilities.canCreateCompanies) denied('An active entitlement is required.');
    const count = subscription.get('coveredCompanyCount') ?? 0;
    if (!mayCreateWithinLimit(resolved.capabilities.maxCoveredCompanies,count)) denied('Company coverage limit reached.');
    const initialRole = resolved.plan === 'company' || resolved.demoType === 'company' ? 'administrator' : 'manager';
    const member = { uid, companyId, role: initialRole, active: true, workerId: null, ...(resolved.plan==='pro'||resolved.demoType==='pro'?{proTeamSubscriptionId:uid}:{}),updatedAt: FieldValue.serverTimestamp() };
    const seatIds:string[]=(resolved.plan==='pro'||resolved.demoType==='pro')?(subscription.get('seatIds')??[uid]):[uid];
    const additionalSeats=seatIds.filter(seatId=>seatId!==uid);
    const seatAccounts=await Promise.all(additionalSeats.map(seatId=>tx.get(db.doc(`accounts/${seatId}`))));
    if(seatAccounts.some(account=>!account.exists))denied('A Pro seat Account is missing.');
    tx.create(companyRef, { id: companyId, ...fields, ...(resolved.plan==='pro'||resolved.demoType==='pro'?{backupEmail:fields.contact_email,backupEmailVerified:false}:{}),active: true, createdByAccountId: uid, createdAt: FieldValue.serverTimestamp(), currentRevisionId: null, currentRevisionNumber: 0, administratorCount: initialRole === 'administrator' ? 1 : 0 });
    tx.create(db.doc(`companies/${companyId}/coverage/current`), { accountId: uid, updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.doc(`companies/${companyId}/memberships/${uid}`), member);
    tx.create(db.doc(`accounts/${uid}/memberships/${companyId}`), member);
    for(const seatId of additionalSeats){const inherited={uid:seatId,companyId,role:'manager',active:true,workerId:null,proTeamSubscriptionId:uid,updatedAt:FieldValue.serverTimestamp()};tx.create(db.doc(`companies/${companyId}/memberships/${seatId}`),inherited);tx.create(db.doc(`accounts/${seatId}/memberships/${companyId}`),inherited);}
    tx.update(subscriptionRef, { coveredCompanyCount: count + 1,coveredCompanyIds:FieldValue.arrayUnion(companyId),...(resolved.plan==='demo'&&resolved.demoType==='company'?{selectedDemoCompanyId:companyId}:{}) });
    return { companyId, role: initialRole, created: true };
  });
});

export const switchDemoType=onCall(async request=>{
  const uid=await identity(request);const data=object(request.data);keys(data,['demoType','selectedCompanyId']);
  if(data.demoType!=='company'&&data.demoType!=='pro')fail('Choose Company Demo or Pro Demo.');
  const selected=data.selectedCompanyId==null?null:id(data.selectedCompanyId);
  await db.runTransaction(async tx=>{
    const ref=db.doc(`subscriptions/${uid}`),snapshot=await tx.get(ref);
    if(snapshot.get('plan')!=='demo')denied('Only Demo subscriptions can switch Demo type.');
    if(data.demoType==='company'&&snapshot.get('coveredCompanyCount')>0){
      if(!selected)fail('Select the active Company Demo.');
      const coverage=await tx.get(db.doc(`companies/${selected}/coverage/current`));
      if(coverage.get('accountId')!==uid)denied('Selected Company is not covered by this Demo.');
    }
    tx.update(ref,{demoType:data.demoType,tierId:`demo_${data.demoType}`,selectedDemoCompanyId:data.demoType==='company'?selected:null,updatedAt:FieldValue.serverTimestamp()});
  });
  return {demoType:data.demoType,selectedCompanyId:selected};
});

export const getCompanyCapabilities=onCall(async request=>{
  const uid=await identity(request),data=object(request.data);keys(data,['companyId']);const companyId=id(data.companyId);
  return db.runTransaction(async tx=>{
    await membership(tx,uid,companyId,['administrator','manager']);
    const subscription=await coverage(tx,companyId);
    return resolveCommercial(subscription.data());
  });
});

export const getCommercialStatus=onCall(async request=>{
  const uid=await identity(request);
  const snapshot=await db.doc(`subscriptions/${uid}`).get(),value=snapshot.data();
  const resolved=resolveCommercial(value);
  return {plan:resolved.plan,demoType:resolved.demoType,tierId:resolved.tierId,status:resolved.status,cadence:resolved.cadence,priceVersion:resolved.priceVersion,catalogVersion:resolved.catalogVersion,paidThrough:resolved.paidThrough,renewalAt:value?.cancelAtPeriodEnd?null:resolved.paidThrough,cancelAtPeriodEnd:value?.cancelAtPeriodEnd===true,graceEndsAt:resolved.graceEndsAt,seatCount:resolved.plan==='pro'||resolved.demoType==='pro'?(Array.isArray(value?.seatIds)?value.seatIds.length:0):0,coveredCompanyIds:Array.isArray(value?.coveredCompanyIds)?value.coveredCompanyIds:[],selectedDemoCompanyId:value?.selectedDemoCompanyId??null,pendingDowngrade:value?.pendingDowngrade??null,capabilities:resolved.capabilities};
});

export const getCompanyCoverageStatus=onCall(async request=>{
  const uid=await identity(request),data=object(request.data);keys(data,['companyId']);const companyId=id(data.companyId);
  return db.runTransaction(async tx=>{
    const {company,member}=await membership(tx,uid,companyId);
    const cover=await tx.get(db.doc(`companies/${companyId}/coverage/current`));
    const subscription=cover.exists?await tx.get(db.doc(`subscriptions/${cover.get('accountId')}`)):null;
    const resolved=resolveCommercial(subscription?.data());
    const revisionId=company.get('currentRevisionId');
    const revision=revisionId&&member.get('role')!=='member'?await tx.get(db.doc(`companies/${companyId}/publishedRevisions/${revisionId}`)):null;
    const counts=revision?.get('recordCounts')??null;
    return {companyId,coverageSource:resolved.plan==='pro'?'pro':resolved.plan==='company'?'company':resolved.plan==='demo'?'demo':'none',status:cover.get('state')==='ending'?'ending':resolved.status,hostedAccessEndingAt:cover.get('state')==='ending'?cover.get('exportEndsAt'):resolved.status==='grace'?resolved.graceEndsAt:null,capabilities:resolved.capabilities,publishedRecordCounts:counts,overLimit:counts?{chemicalProducts:resolved.capabilities.maxChemicalProductsPerCompany!==null&&counts.chemicalProducts>resolved.capabilities.maxChemicalProductsPerCompany,workers:resolved.capabilities.maxWorkersPerCompany!==null&&counts.workers>resolved.capabilities.maxWorkersPerCompany,workAreas:resolved.capabilities.maxWorkAreasPerCompany!==null&&counts.workAreas>resolved.capabilities.maxWorkAreasPerCompany}:null};
  });
});

export const updateCompany = onCall(async request => {
  const uid = await identity(request); const data = object(request.data); keys(data,['companyId','company']);
  const companyId = id(data.companyId); const fields = companyFields(data.company);
  await db.runTransaction(async tx => {
    await membership(tx,uid,companyId,['administrator']); await coverage(tx,companyId,'canManageCompanySettings');
    tx.update(db.doc(`companies/${companyId}`), { ...fields, updatedAt: FieldValue.serverTimestamp() });
  });
  return { companyId };
});

export const setActiveCompany = onCall(async request => {
  const uid = await identity(request); const data = object(request.data); keys(data,['companyId']); const companyId = id(data.companyId);
  await db.runTransaction(async tx => {
    await membership(tx,uid,companyId);
    tx.update(db.doc(`accounts/${uid}`), { activeCompanyId: companyId });
  });
  return { companyId };
});

export const setMembership = onCall(async request => {
  const uid = await identity(request); const data = object(request.data);
  keys(data,['companyId','uid','role','active','workerId']);
  const companyId = id(data.companyId); const targetUid = id(data.uid); const targetRole = role(data.role);
  if (typeof data.active !== 'boolean') fail('active must be a boolean.');
  const workerId = data.workerId == null ? null : id(data.workerId);
  const targetUser = await auth.getUser(targetUid);
  if (targetUser.disabled || !targetUser.providerData.some(p=>p.providerId === 'google.com')) denied('Target must have an enabled Google-authenticated account.');
  await db.runTransaction(async tx => {
    const { company,member:actor } = await membership(tx,uid,companyId,['administrator','manager']);
    const subscription=await coverage(tx,companyId,'canInviteCompanyMembers');
    const proSeat=actor.get('role')==='manager'&&actor.get('proTeamSubscriptionId')===subscription.get('accountId')&&resolveCommercial(subscription.data()).plan==='pro';
    if(actor.get('role')!=='administrator'&&(!proSeat||targetRole!=='member'))denied('Only an Administrator may manage Company roles.');
    const ref = db.doc(`companies/${companyId}/memberships/${targetUid}`);
    const [previous, account] = await Promise.all([tx.get(ref),tx.get(db.doc(`accounts/${targetUid}`))]);
    if (!account.exists) throw new HttpsError('failed-precondition','Target must bootstrap their Account first.');
    if(proSeat&&previous.exists&&previous.get('role')!=='member')denied('Pro seat may manage client Members only.');
    if (workerId && data.active) {
      const revisionId = company.get('currentRevisionId');
      if (!revisionId) fail('Publish the Worker before linking membership.');
      const [worker, link] = await Promise.all([tx.get(db.doc(`companies/${companyId}/publishedRevisions/${revisionId}/workers/${workerId}`)),tx.get(db.doc(`companies/${companyId}/workerLinks/${workerId}`))]);
      if (!worker.exists || (link.exists && link.get('uid') !== targetUid)) denied('Worker is missing or already linked.');
    }
    const wasAdmin = previous.get('active') === true && previous.get('role') === 'administrator';
    const isAdmin = data.active && targetRole === 'administrator';
    const count = company.get('administratorCount') + Number(isAdmin) - Number(wasAdmin);
    if (count < 1 && resolveCommercial(subscription.data()).plan==='company') denied('Cannot remove the last Company administrator.');
    if(previous.get('proTeamSubscriptionId'))denied('Pro-team seats are managed through the commercial subscription.');
    const oldWorker = previous.get('workerId');
    if (oldWorker && (oldWorker !== workerId || !data.active)) tx.delete(db.doc(`companies/${companyId}/workerLinks/${oldWorker}`));
    if (workerId && data.active) tx.set(db.doc(`companies/${companyId}/workerLinks/${workerId}`),{uid:targetUid});
    const member = { uid:targetUid, companyId, role:targetRole, active:data.active, workerId, updatedAt:FieldValue.serverTimestamp() };
    tx.set(ref,member); tx.set(db.doc(`accounts/${targetUid}/memberships/${companyId}`),member);
    tx.update(company.ref,{administratorCount:count});
  });
  return { companyId, uid: targetUid };
});

// Existing membership is mandatory. A subscription never grants access to someone else's Company.
export const coverCompany = onCall(async request => {
  const uid = await identity(request); const data = object(request.data); keys(data,['companyId']); const companyId = id(data.companyId);
  await db.runTransaction(async tx => {
    const {company}=await membership(tx,uid,companyId,['administrator','manager']);
    const ref = db.doc(`companies/${companyId}/coverage/current`);
    const [existing, subscription] = await Promise.all([tx.get(ref),tx.get(db.doc(`subscriptions/${uid}`))]);
    const resolved=resolveCommercial(subscription.data());
    if (!resolved.capabilities.canUseProTeam || resolved.plan!=='pro') denied('An active Pro plan is required.');
    if (existing.exists) {
      if (existing.get('accountId') === uid) return;
      throw new HttpsError('failed-precondition','Coverage transfer requires a future audited administrative workflow.');
    }
    if(!mayCreateWithinLimit(resolved.capabilities.maxCoveredCompanies,subscription.get('coveredCompanyCount')??0))denied('Pro Company coverage limit reached.');
    const seats:string[]=subscription.get('seatIds')??[uid];
    const priorMembers=await Promise.all(seats.map(seatId=>tx.get(db.doc(`companies/${companyId}/memberships/${seatId}`))));
    const seatAccounts=await Promise.all(seats.map(seatId=>tx.get(db.doc(`accounts/${seatId}`))));
    if(seatAccounts.some(account=>!account.exists))denied('Pro seat Account missing.');
    tx.create(ref,{accountId:uid,updatedAt:FieldValue.serverTimestamp()});
    if(!company.get('backupEmail'))tx.update(company.ref,{backupEmail:company.get('contact_email'),backupEmailVerified:false});
    for(let i=0;i<seats.length;i++){
      const seatId=seats[i],prior=priorMembers[i];
      const direct=prior.exists?{role:prior.get('role'),active:prior.get('active'),workerId:prior.get('workerId')}:null;
      const inherited={uid:seatId,companyId,role:direct?.role==='administrator'?'administrator':'manager',active:true,workerId:direct?.workerId??null,proTeamSubscriptionId:uid,directMembership:direct,updatedAt:FieldValue.serverTimestamp()};
      tx.set(db.doc(`companies/${companyId}/memberships/${seatId}`),inherited);
      tx.set(db.doc(`accounts/${seatId}/memberships/${companyId}`),inherited);
    }
    tx.update(subscription.ref,{coveredCompanyCount:(subscription.get('coveredCompanyCount') ?? 0)+1,coveredCompanyIds:FieldValue.arrayUnion(companyId)});
  });
  return { companyId };
});

export const recordTrainingCompletion = onCall(async request => {
  const uid = await identity(request); const data = object(request.data);
  keys(data,['companyId','assignmentId','trainingDate','eventId']);
  const companyId = id(data.companyId); const assignmentId = id(data.assignmentId); const eventId = id(data.eventId); const trainingDate = date(data.trainingDate);
  if (trainingDate > new Date().toISOString().slice(0,10)) fail('Training cannot be in the future.');
  return db.runTransaction(async tx => {
    const {company,member} = await membership(tx,uid,companyId); await coverage(tx,companyId);
    const revisionId = company.get('currentRevisionId');
    if (!revisionId) throw new HttpsError('failed-precondition','No published assignment.');
    const ref = db.doc(`companies/${companyId}/trainingEvents/${eventId}`);
    const [assignment,existing] = await Promise.all([tx.get(db.doc(`companies/${companyId}/publishedRevisions/${revisionId}/workAreaAssignments/${assignmentId}`)),tx.get(ref)]);
    if (!assignment.exists || (member.get('role') === 'member' && (!member.get('workerId') || assignment.get('workerId') !== member.get('workerId')))) denied('Assignment is not permitted for this member.');
    if (trainingDate < assignment.get('assigned_date') || (assignment.get('ended_date') && trainingDate > assignment.get('ended_date'))) fail('Training date is outside the assignment.');
    if (existing.exists) {
      if (existing.get('createdByAccountId') !== uid || existing.get('assignmentId') !== assignmentId || existing.get('training_date') !== trainingDate) throw new HttpsError('already-exists','Event ID already used.');
      return {id:eventId,created:false};
    }
    tx.create(ref,{id:eventId,assignmentId,workerId:assignment.get('workerId'),training_date:trainingDate,revisionId,createdByAccountId:uid,createdAt:Timestamp.now()});
    return {id:eventId,created:true};
  });
});

export * from './staged-publication.js';
