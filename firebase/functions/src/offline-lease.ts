import {randomUUID} from 'node:crypto';
import {SignJWT,importPKCS8} from 'jose';
import {defineSecret} from 'firebase-functions/params';
import {onCall,HttpsError} from 'firebase-functions/v2/https';
import {identity,membership,db} from './access.js';
import {id,keys,object} from './validation.js';
import {resolveCompanyCommercial,DAY_MS} from '@hazcom/core';

export const OFFLINE_LEASE_SCHEMA=1;
export const OFFLINE_LEASE_AUDIENCE='hazcom-navigator-windows';
export const OFFLINE_LEASE_KEY_ID='offline-lease-es256-v1';
export const OFFLINE_LEASE_MAX_MS=7*DAY_MS;
const privateKey=defineSecret('WINDOWS_OFFLINE_LEASE_PRIVATE_KEY');
// Synthetic P-256 key used only when both emulator and demo-project guards hold.
const EMULATOR_PRIVATE_KEY=`-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgNsATbdpZGtfUxenC
gYn9pqIx3hNVU01ToYYKppCSzL2hRANCAATKpmVxJN9kN9QkESmjpUQXYuTsdgxm
q66Vs9dTlCUUvK8xosjK3WFpPIRPGgyEIEfCF3iecZC8bhCccCOIwf0B
-----END PRIVATE KEY-----`;
export const EMULATOR_PUBLIC_KEY=`-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEyqZlcSTfZDfUJBEpo6VEF2Lk7HYM
ZquulbPXU5QlFLyvMaLIyt1haTyETxoMhCBHwhd4nnGQvG4QnHAjiMH9AQ==
-----END PUBLIC KEY-----`;

export interface OfflineLeaseClaims {v:number;env:string;companyId:string;role:'administrator'|'manager';canAuthor:true;iss:string;aud:string;sub:string;iat:number;exp:number;jti:string}
function projectId(){try{return process.env.GCLOUD_PROJECT||JSON.parse(process.env.FIREBASE_CONFIG??'{}').projectId||'';}catch{return '';}}
function issuer(project:string){return `https://hazcom.navigator/offline-authorization/${project}`;}
function emulatorKey(project:string){
 const emulated=process.env.FUNCTIONS_EMULATOR==='true'||Boolean(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST);
 if(emulated&&project==='demo-hazcom-navigator')return EMULATOR_PRIVATE_KEY;
 return null;
}
export function leaseClaims(input:{project:string;uid:string;companyId:string;role:'administrator'|'manager';nowMs:number;authoringDeadlineMs:number|null}):OfflineLeaseClaims{
 const issued=Math.floor(input.nowMs/1000),maximum=input.nowMs+OFFLINE_LEASE_MAX_MS;
 const expires=Math.floor(Math.min(maximum,input.authoringDeadlineMs??maximum)/1000);
 if(!input.project||expires<=issued)throw new HttpsError('failed-precondition','Current coverage does not permit an offline authoring lease.');
 return {v:OFFLINE_LEASE_SCHEMA,env:input.project,companyId:input.companyId,role:input.role,canAuthor:true,iss:issuer(input.project),aud:OFFLINE_LEASE_AUDIENCE,sub:input.uid,iat:issued,exp:expires,jti:randomUUID()};
}
export async function signOfflineLease(claims:OfflineLeaseClaims,pem:string){
 const key=await importPKCS8(pem,'ES256');
 return new SignJWT({v:claims.v,env:claims.env,companyId:claims.companyId,role:claims.role,canAuthor:claims.canAuthor})
  .setProtectedHeader({alg:'ES256',typ:'JWT',kid:OFFLINE_LEASE_KEY_ID}).setIssuer(claims.iss).setAudience(claims.aud)
  .setSubject(claims.sub).setIssuedAt(claims.iat).setExpirationTime(claims.exp).setJti(claims.jti).sign(key);
}

export const issueWindowsOfflineAuthorizationLease=onCall({secrets:[privateKey]},async request=>{
 const uid=await identity(request),data=object(request.data);keys(data,['companyId']);const companyId=id(data.companyId),now=Date.now(),project=projectId();
 const authorization=await db.runTransaction(async tx=>{
  const {member}=await membership(tx,uid,companyId,['administrator','manager']);
  const cover=await tx.get(db.doc(`companies/${companyId}/coverage/current`));
  if(!cover.exists)throw new HttpsError('permission-denied','Company has no active coverage.');
  const subscription=await tx.get(db.doc(`subscriptions/${cover.get('accountId')}`));
  const resolved=resolveCompanyCommercial(subscription.data(),cover.data(),companyId,now);
  if(!resolved.capabilities.canAuthor||resolved.coverageState!=='active')throw new HttpsError('permission-denied','Current Company coverage does not permit offline authoring.');
  const role=member.get('role');if(role!=='administrator'&&role!=='manager')throw new HttpsError('permission-denied','Offline authoring requires Manager or Administrator access.');
  return {role,deadline:resolved.paidThrough};
 });
 const pem=emulatorKey(project)??privateKey.value();
 if(!pem)throw new HttpsError('failed-precondition','Offline authorization signing is not configured.');
 const claims=leaseClaims({project,uid,companyId,role:authorization.role,nowMs:now,authoringDeadlineMs:authorization.deadline});
 return {lease:await signOfflineLease(claims,pem),metadata:{companyId,role:claims.role,issuedAt:claims.iat*1000,expiresAt:claims.exp*1000,keyId:OFFLINE_LEASE_KEY_ID,schemaVersion:claims.v,environment:project}};
});
