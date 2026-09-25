import { initializeApp, getApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, GoogleAuthProvider, signInWithCredential, signOut, type Auth } from 'firebase/auth';
import { collection, doc, getDocFromServer, getDocsFromServer, getFirestore, type Firestore } from 'firebase/firestore';
import {resolveCommercial} from '@hazcom/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { invoke, isTauri } from '@tauri-apps/api/core';

const env=import.meta.env;
export const firebaseConfig={apiKey:env.VITE_FIREBASE_API_KEY,authDomain:env.VITE_FIREBASE_AUTH_DOMAIN,projectId:env.VITE_FIREBASE_PROJECT_ID,appId:env.VITE_FIREBASE_APP_ID};
export const configurationError=Object.values(firebaseConfig).some(v=>!v) ? 'Firebase configuration is missing. Copy the repository .env.example to .env and restart the app.' : '';

// CODEX HANDOFF: Session stays in memory until OS-protected credential storage is designed.
// Google credentials are obtained in the system browser; never in the Tauri webview.
export let auth: Auth;
export let db: Firestore;
if(!configurationError){const app=initializeApp(firebaseConfig);auth=initializeAuth(app,{persistence:inMemoryPersistence});db=getFirestore(app);}
export const call=async<T=unknown>(name:string,data:unknown)=>(await httpsCallable<unknown,T>(getFunctions(getApp(),'us-central1'),name)(data)).data;
export async function signIn(){
  if(!isTauri())throw Error('Open the Windows application to sign in with your system browser.');
  const token=await invoke<string>('google_browser_sign_in',{config:firebaseConfig});
  await signInWithCredential(auth,GoogleAuthProvider.credential(token));
}
export const signOutAccount=()=>signOut(auth);
export type Role='administrator'|'manager'|'member';
export interface CompanyAccess {id:string;name:string;contact_email:string;role:Role}
export interface AccountSession {uid:string;email:string;companies:CompanyAccess[];activeCompanyId:string|null;entitlement:string;canCreate:boolean}

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
