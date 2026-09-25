import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { role, type Role } from './validation.js';
import { resolveCommercial, type Capabilities } from '@hazcom/core';

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
  return resolveCommercial(entitlement,now).capabilities.canAuthor;
}
export async function membership(tx: Transaction, uid: string, companyId: string, allowed: readonly Role[] = ['administrator','manager','member']) {
  const [company, member] = await Promise.all([
    tx.get(db.doc(`companies/${companyId}`)), tx.get(db.doc(`companies/${companyId}/memberships/${uid}`)),
  ]);
  if (!company.exists || company.get('active') !== true || !member.exists || member.get('active') !== true || !allowed.includes(role(member.get('role')))) denied('Company membership does not permit this operation.');
  return { company, member };
}
export async function coverage(tx: Transaction, companyId: string, capability: keyof Capabilities = 'canAuthor') {
  const cover = await tx.get(db.doc(`companies/${companyId}/coverage/current`));
  if (!cover.exists) denied('Company has no subscription coverage.');
  if(cover.get('state')==='ending'&&capability!=='canReadPublished'&&capability!=='canExportBackup')denied('Company coverage is ending; authoring is disabled.');
  const subscription = await tx.get(db.doc(`subscriptions/${cover.get('accountId')}`));
  const resolved = resolveCommercial(subscription.data());
  if (resolved.capabilities[capability] !== true) denied(`Company coverage lacks ${capability}.`);
  if (resolved.plan === 'demo' && resolved.demoType === 'company' && subscription.get('selectedDemoCompanyId') !== companyId) denied('This Company is parked in Company Demo.');
  const covered=subscription.get('coveredCompanyIds');
  if(cover.get('state')!=='ending'&&Array.isArray(covered)&&!covered.includes(companyId))denied('Company is not covered by this subscription.');
  return subscription;
}
