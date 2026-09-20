import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { auth, db, identity, membership, coverage, canAuthor, denied } from './access.js';
import { companyFields, id, object, keys, role, date, fail } from './validation.js';

setGlobalOptions({ region: 'us-central1', maxInstances: 3, memory: '512MiB', timeoutSeconds: 120 });
export { beginPublication, uploadPublicationSds, finalizePublication } from './publication.js';

export const bootstrapAccount = onCall(async request => {
  const uid = await identity(request);
  const user = await auth.getUser(uid);
  await db.runTransaction(async tx => {
    const ref = db.doc(`accounts/${uid}`);
    if (!(await tx.get(ref)).exists) tx.create(ref, { uid, displayName: user.displayName ?? '', email: user.email ?? '', createdAt: FieldValue.serverTimestamp(), activeCompanyId: null });
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
    if (!canAuthor(subscription.data())) denied('An active entitlement is required.');
    const count = subscription.get('coveredCompanyCount') ?? 0;
    if (subscription.get('plan') === 'customer' && count >= 1) denied('Customer plan covers at most one Company.');
    const initialRole = subscription.get('plan') === 'customer' ? 'administrator' : 'manager';
    const member = { uid, companyId, role: initialRole, active: true, workerId: null, updatedAt: FieldValue.serverTimestamp() };
    tx.create(companyRef, { id: companyId, ...fields, active: true, createdByAccountId: uid, createdAt: FieldValue.serverTimestamp(), currentRevisionId: null, currentRevisionNumber: 0, administratorCount: initialRole === 'administrator' ? 1 : 0 });
    tx.create(db.doc(`companies/${companyId}/coverage/current`), { accountId: uid, updatedAt: FieldValue.serverTimestamp() });
    tx.create(db.doc(`companies/${companyId}/memberships/${uid}`), member);
    tx.create(db.doc(`accounts/${uid}/memberships/${companyId}`), member);
    tx.update(subscriptionRef, { coveredCompanyCount: count + 1 });
    return { companyId, role: initialRole, created: true };
  });
});

export const updateCompany = onCall(async request => {
  const uid = await identity(request); const data = object(request.data); keys(data,['companyId','company']);
  const companyId = id(data.companyId); const fields = companyFields(data.company);
  await db.runTransaction(async tx => {
    await membership(tx,uid,companyId,['administrator']); await coverage(tx,companyId);
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
    const { company } = await membership(tx,uid,companyId,['administrator']); await coverage(tx,companyId);
    const ref = db.doc(`companies/${companyId}/memberships/${targetUid}`);
    const [previous, account] = await Promise.all([tx.get(ref),tx.get(db.doc(`accounts/${targetUid}`))]);
    if (!account.exists) throw new HttpsError('failed-precondition','Target must bootstrap their Account first.');
    if (workerId && data.active) {
      const revisionId = company.get('currentRevisionId');
      if (!revisionId) fail('Publish the Worker before linking membership.');
      const [worker, link] = await Promise.all([tx.get(db.doc(`companies/${companyId}/publishedRevisions/${revisionId}/workers/${workerId}`)),tx.get(db.doc(`companies/${companyId}/workerLinks/${workerId}`))]);
      if (!worker.exists || (link.exists && link.get('uid') !== targetUid)) denied('Worker is missing or already linked.');
    }
    const wasAdmin = previous.get('active') === true && previous.get('role') === 'administrator';
    const isAdmin = data.active && targetRole === 'administrator';
    const count = company.get('administratorCount') + Number(isAdmin) - Number(wasAdmin);
    if (count < 1) denied('Cannot remove the last Company administrator.');
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
    await membership(tx,uid,companyId,['administrator','manager']);
    const ref = db.doc(`companies/${companyId}/coverage/current`);
    const [existing, subscription] = await Promise.all([tx.get(ref),tx.get(db.doc(`subscriptions/${uid}`))]);
    if (!canAuthor(subscription.data()) || subscription.get('plan') !== 'professional') denied('An active Professional plan is required.');
    if (existing.exists) {
      if (existing.get('accountId') === uid) return;
      throw new HttpsError('failed-precondition','Coverage transfer requires a future audited administrative workflow.');
    }
    tx.create(ref,{accountId:uid,updatedAt:FieldValue.serverTimestamp()});
    tx.update(subscription.ref,{coveredCompanyCount:(subscription.get('coveredCompanyCount') ?? 0)+1});
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
