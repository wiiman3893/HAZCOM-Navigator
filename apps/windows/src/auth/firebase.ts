import {observe} from '../diagnostics/session';
import { initializeApp, getApp } from 'firebase/app';
import { GoogleAuthProvider, signInWithCredential, signOut, type Auth } from 'firebase/auth';
import { collection, doc, getDocFromServer, getDocsFromServer, getFirestore, type Firestore } from 'firebase/firestore';
import {resolveCommercial} from '@hazcom/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {readWindowsEnvironment} from '../config/environment';
import {initializeWindowsAuth} from './persistence';

const environmentResult=readWindowsEnvironment(import.meta.env);
export const windowsEnvironment=environmentResult.config;
export const firebaseConfig=windowsEnvironment?.firebase;
export const configurationError=environmentResult.error;

// Firebase owns durable session persistence in the Tauri WebView2 application
// profile. Google credentials are obtained in the system browser; never in the
// Tauri webview, Company SQLite, backups, diagnostics, logs, or URLs.
export let auth: Auth;
export let db: Firestore;
if(firebaseConfig){const app=initializeApp(firebaseConfig);auth=initializeWindowsAuth(app);db=getFirestore(app);}
export const call=async<T=unknown>(name:string,data:unknown)=>(await httpsCallable<unknown,T>(getFunctions(getApp(),'us-central1'),name)(data)).data;
async function signInImpl(){
  if(!windowsEnvironment||!firebaseConfig)throw Error(configurationError||'Windows configuration is invalid.');
  if(!isTauri())throw Error('Open the Windows application to sign in with your system browser.');
  const token=await invoke<string>('google_browser_sign_in',{environment:windowsEnvironment.environment,config:firebaseConfig});
  await signInWithCredential(auth,GoogleAuthProvider.credential(token));
}
export const signIn=()=>observe('auth.signin',signInImpl);
export const signOutAccount=()=>observe('auth.signout',()=>signOut(auth));
export type Role='administrator'|'manager'|'member';
export interface CompanyAccess {id:string;name:string;contact_email:string;role:Role}
export interface AccountSession {uid:string;email:string;companies:CompanyAccess[];activeCompanyId:string|null;entitlement:string;canCreate:boolean}
export interface CompanyCoverageAuthorization {companyId:string;effectiveRole:Role;capabilities:{canAuthor:boolean;canExportBackup:boolean}}
export interface OfflineAuthorization {accountId:string;companyId:string;environment:string;role:'administrator'|'manager';issuedAt:number;expiresAt:number;state:'writable'|'read_only'}

/** The signed artifact crosses into native protected storage immediately. */
export async function refreshOfflineAuthorization(uid:string,companyId:string):Promise<OfflineAuthorization>{
 if(!windowsEnvironment||auth.currentUser?.uid!==uid||!navigator.onLine)throw Error('Connect and sign in to refresh offline authorization.');
 const result=await call<{lease:string;metadata:{environment:string}}>('issueWindowsOfflineAuthorizationLease',{companyId});
 return invoke<OfflineAuthorization>('store_offline_authorization',{accountId:uid,companyId,environment:result.metadata.environment,lease:result.lease});
}
export function listOfflineAuthorizations(uid:string):Promise<OfflineAuthorization[]>{
 if(!firebaseConfig)throw Error('Windows configuration is unavailable.');
 return invoke('list_offline_authorizations',{accountId:uid,environment:firebaseConfig.projectId});
}
export function clearOfflineAuthorizations(uid:string,companyId?:string):Promise<void>{return invoke('clear_offline_authorizations',{accountId:uid,companyId:companyId??null});}

export async function verifyCompany(uid:string,companyId:string):Promise<CompanyAccess>{
  if(auth.currentUser?.uid!==uid || !navigator.onLine)throw Error('Connect and sign in to open this workspace.');
  const [company,member]=await Promise.all([getDocFromServer(doc(db,'companies',companyId)),getDocFromServer(doc(db,'companies',companyId,'memberships',uid))]);
  const c=company.data(),m=member.data();
  if(auth.currentUser?.uid!==uid || !c?.active || !m?.active || !['administrator','manager','member'].includes(m.role))throw Error('Company access is no longer active.');
  return {id:companyId,name:c.name,contact_email:c.contact_email,role:m.role};
}

export async function loadAccount(uid:string):Promise<AccountSession>{
  await call('bootstrapAccount',{});
  const [account,subscription,index]=await Promise.all([getDocFromServer(doc(db,'accounts',uid)),getDocFromServer(doc(db,'subscriptions',uid)),getDocsFromServer(collection(db,'accounts',uid,'memberships'))]);
  const companies:CompanyAccess[]=[];
  for(const membership of index.docs){
    if(membership.data().active!==true)continue;
    try{companies.push(await verifyCompany(uid,membership.id));}
    catch(error){if((error as {code?:string}).code!=='permission-denied')throw error;}
  }
  if(auth.currentUser?.uid!==uid)throw Error('The signed-in account changed.');
  const entitlement=subscription.data(),commercial=resolveCommercial(entitlement);
  const canCreate=commercial.capabilities.canCreateCompanies&&(entitlement?.coveredCompanyCount??0)<commercial.capabilities.maxCoveredCompanies;
  const label=commercial.plan==='demo'?`${commercial.demoType==='pro'?'Pro':'Company'} Demo`:commercial.plan==='pro'?'Pro':commercial.plan==='company'?'Company':'No personal subscription';
  const state=commercial.status==='active'?'Active':commercial.status==='grace'?'Grace and export period':'Read access only';
  return {uid,email:auth.currentUser?.email??'',companies:companies.sort((a,b)=>a.name.localeCompare(b.name)),activeCompanyId:account.get('activeCompanyId')??null,entitlement:`${label} · ${state}`,canCreate};
}

/** A restored Firebase identity is never sufficient to expose a Company. */
export async function verifyActiveCompanyAuthorization(uid:string,company:CompanyAccess):Promise<CompanyCoverageAuthorization>{
  if(auth.currentUser?.uid!==uid||!navigator.onLine)throw Error('Connect to the internet to verify your Company access.');
  const result=await call<CompanyCoverageAuthorization>('getCompanyCoverageStatus',{companyId:company.id});
  if(auth.currentUser?.uid!==uid||result.companyId!==company.id||result.effectiveRole!==company.role)throw Error('Company access changed. Sign in again or refresh your access.');
  if(company.role!=='member'&&!result.capabilities.canAuthor&&!result.capabilities.canExportBackup)throw Error('Company coverage does not currently permit Windows workspace access.');
  return result;
}
