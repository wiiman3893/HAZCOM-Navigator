import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';

// Deliberately not exported as a Cloud Function. IAM-authorized operator only.
const [command, uid, argument, duration = '30'] = process.argv.slice(2);
const projectId = 'hazcom-navigator-dev';
if (process.env.GOOGLE_CLOUD_PROJECT !== projectId || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Set GOOGLE_CLOUD_PROJECT=hazcom-navigator-dev; this utility only targets the real development project.');
initializeApp({credential:applicationDefault(),projectId});
const user=await getAuth().getUser(uid);
if (user.disabled || !user.providerData.some(p=>p.providerId === 'google.com')) throw new Error('Target must be an enabled, real Google-authenticated Firebase user.');
const db=getFirestore();
if (command === 'entitlement') {
  if (!['customer','professional'].includes(argument)) throw new Error('Plan must be customer or professional.');
  const days=Number(duration);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('Duration must be 1–90 days.');
  await db.runTransaction(async tx=> {
    const ref=db.doc(`subscriptions/${uid}`),account=db.doc(`accounts/${uid}`);
    const [prior,profile]=await Promise.all([tx.get(ref),tx.get(account)]);
    if (!profile.exists) throw new Error('Call bootstrapAccount after sign-in first.');
    const count=prior.get('coveredCompanyCount') ?? 0;
    if (argument === 'customer' && count > 1) throw new Error('Cannot downgrade multiple covered Companies to Customer.');
    const validUntil=Timestamp.fromMillis(Date.now()+days*86400000);
    tx.set(ref,{accountId:uid,plan:argument,status:'active',validUntil,graceUntil:Timestamp.fromMillis(validUntil.toMillis()+14*86400000),coveredCompanyCount:count,source:'development-manual',version:(prior.get('version') ?? 0)+1,updatedAt:FieldValue.serverTimestamp()});
    tx.create(db.collection('administrativeAudit').doc(),{action:'development-entitlement',uid,plan:argument,days,createdAt:FieldValue.serverTimestamp()});
  });
} else if (command === 'first-administrator') {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(argument ?? '')) throw new Error('Company ID required.');
  await db.runTransaction(async tx=> {
    const company=db.doc(`companies/${argument}`),member=db.doc(`companies/${argument}/memberships/${uid}`);
    const [c,m,account]=await Promise.all([tx.get(company),tx.get(member),tx.get(db.doc(`accounts/${uid}`))]);
    if (!c.exists || c.get('administratorCount') !== 0 || !account.exists) throw new Error('Only bootstrap an existing Company with no administrator and an existing Account.');
    const record={uid,companyId:argument,active:true,role:'administrator',workerId:m.get('workerId') ?? null,updatedAt:FieldValue.serverTimestamp()};
    tx.set(member,record);tx.set(db.doc(`accounts/${uid}/memberships/${argument}`),record);tx.update(company,{administratorCount:1});
    tx.create(db.collection('administrativeAudit').doc(),{action:'development-first-administrator',uid,companyId:argument,createdAt:FieldValue.serverTimestamp()});
  });
} else throw new Error('Usage: node scripts/dev-admin.mjs entitlement UID customer|professional [days] OR first-administrator UID COMPANY_ID');
console.log(`Completed ${command} for ${uid} in ${projectId}.`);
