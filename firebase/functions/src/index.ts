import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();
const db = getFirestore();

type Role = 'administrator' | 'manager' | 'member';

async function requireMembership(uid: string, companyId: string): Promise<{ role: Role; workerId?: string }> {
  const snap = await db.doc(`companies/${companyId}/memberships/${uid}`).get();
  if (!snap.exists || snap.get('active') !== true) throw new HttpsError('permission-denied','No active Company membership.');
  return { role: snap.get('role') as Role, workerId: snap.get('workerId') as string | undefined };
}

/** Append-only Training Event creation. Members are limited to assignments for their linked Worker. */
export const recordTrainingCompletion = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated','Sign-in required.');
  const { companyId, assignmentId, trainingDate } = request.data ?? {};
  if (typeof companyId !== 'string' || typeof assignmentId !== 'string' || typeof trainingDate !== 'string') {
    throw new HttpsError('invalid-argument','companyId, assignmentId, and trainingDate are required.');
  }
  const membership = await requireMembership(request.auth.uid, companyId);
  const assignmentRef = db.doc(`companies/${companyId}/workAreaAssignments/${assignmentId}`);
  const assignment = await assignmentRef.get();
  if (!assignment.exists) throw new HttpsError('not-found','Work Area Assignment not found.');
  if (membership.role === 'member') {
    if (!membership.workerId || assignment.get('workerId') !== membership.workerId) {
      throw new HttpsError('permission-denied','Assignment is not related to the linked Worker record.');
    }
  }
  const eventRef = db.collection(`companies/${companyId}/trainingEvents`).doc();
  await eventRef.create({
    id: eventRef.id,
    assignmentId,
    training_date: trainingDate,
    createdByAccountId: request.auth.uid,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: eventRef.id };
});
