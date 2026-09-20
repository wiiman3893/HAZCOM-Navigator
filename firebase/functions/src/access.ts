// CODEX HANDOFF (2026-09-20): Firebase foundation was built and emulator-tested locally.
// Project hazcom-navigator-dev exists; Google Auth + Firestore are live. Functions/Storage cloud deploy awaits Blaze + bucket provisioning.
// Continue from firebase/CODEX_HANDOFF.md; do not recreate the Firebase project or replace this entitlement/membership authority model.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { role, type Role } from './validation.js';

initializeApp();
export const db = getFirestore();
export const auth = getAuth();
export const GRACE_MS = 14 * 24 * 60 * 60 * 1000;
export function denied(message: string): never { throw new HttpsError('permission-denied', message); }
export async function identity(request: CallableRequest): Promise<string> {
  if (!request.auth || request.auth.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Real sign-in required.');
  // Callable token validation alone does not check disabled/revoked accounts.
  const user = await auth.getUser(request.auth.uid);
  if (user.disabled || !user.providerData.some(p => p.providerId === 'google.com')) denied('An enabled Google-authenticated account is required.');
  if (user.tokensValidAfterTime && Number(request.auth.token.auth_time) * 1000 < Date.parse(user.tokensValidAfterTime)) denied('Sign in again.');
  return user.uid;
}
export function canAuthor(entitlement: Record<string, any> | undefined, now = Date.now()): boolean {
  if (!entitlement || !['customer','professional'].includes(entitlement.plan) || !['active','grace'].includes(entitlement.status)) return false;
  const end = entitlement.validUntil instanceof Timestamp ? entitlement.validUntil.toMillis() : NaN;
  const grace = entitlement.graceUntil instanceof Timestamp ? entitlement.graceUntil.toMillis() : NaN;
  return Number.isFinite(end) && Number.isFinite(grace) && grace >= end && grace <= end + GRACE_MS && now < grace;
}
export async function membership(tx: Transaction, uid: string, companyId: string, allowed: readonly Role[] = ['administrator','manager','member']) {
  const [company, member] = await Promise.all([
    tx.get(db.doc(`companies/${companyId}`)), tx.get(db.doc(`companies/${companyId}/memberships/${uid}`)),
  ]);
  if (!company.exists || company.get('active') !== true || !member.exists || member.get('active') !== true || !allowed.includes(role(member.get('role')))) denied('Company membership does not permit this operation.');
  return { company, member };
}
export async function coverage(tx: Transaction, companyId: string) {
  const cover = await tx.get(db.doc(`companies/${companyId}/coverage/current`));
  if (!cover.exists) denied('Company has no subscription coverage.');
  const subscription = await tx.get(db.doc(`subscriptions/${cover.get('accountId')}`));
  if (!canAuthor(subscription.data())) denied('Company coverage is not active or within the 14-day grace period.');
  return subscription;
}
