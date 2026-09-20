// CODEX HANDOFF (2026-09-20): Temporary browser-only real Google sign-in harness for hazcom-navigator-dev.
// It is not the final Tauri auth UI and grants no entitlement. Use it only to obtain/bootstrap a real development Firebase UID.

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
const env=import.meta.env;
if (!env.DEV || env.VITE_FIREBASE_PROJECT_ID !== 'hazcom-navigator-dev') throw new Error('This harness only runs locally against HazCom Navigator Dev.');
const app=initializeApp({apiKey:env.VITE_FIREBASE_API_KEY,authDomain:env.VITE_FIREBASE_AUTH_DOMAIN,projectId:env.VITE_FIREBASE_PROJECT_ID,storageBucket:env.VITE_FIREBASE_STORAGE_BUCKET,messagingSenderId:env.VITE_FIREBASE_MESSAGING_SENDER_ID,appId:env.VITE_FIREBASE_APP_ID});
const status=document.querySelector('#status')!;
const bootstrap=document.querySelector<HTMLButtonElement>('#bootstrap')!;
document.querySelector('#signin')!.addEventListener('click',async()=> {
  try { const {user}=await signInWithPopup(getAuth(app),new GoogleAuthProvider()); status.textContent=`Google-authenticated UID: ${user.uid}\nEmail: ${user.email}\nBootstrap the Account after Functions are deployed.`; bootstrap.disabled=false; }
  catch(error){status.textContent=String(error);}
});
bootstrap.addEventListener('click',async()=> {
  try {const result=await httpsCallable(getFunctions(app,'us-central1'),'bootstrapAccount')({});status.textContent=`Account ready: ${JSON.stringify(result.data)}\nAn IAM-authorized operator can now assign a test entitlement.`;}
  catch(error){status.textContent=String(error);}
});
