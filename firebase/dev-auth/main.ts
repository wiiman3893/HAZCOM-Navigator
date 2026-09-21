import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getStorage, ref, getBytes, uploadBytes, deleteObject, listAll } from 'firebase/storage';

// CODEX HANDOFF: Local-only real-Google cloud test harness. No entitlement or role writes are permitted here.
const env=import.meta.env;
if (!env.DEV || env.VITE_FIREBASE_PROJECT_ID !== 'hazcom-navigator-dev') throw new Error('Development project only.');
const config={apiKey:env.VITE_FIREBASE_API_KEY,authDomain:env.VITE_FIREBASE_AUTH_DOMAIN,projectId:env.VITE_FIREBASE_PROJECT_ID,storageBucket:env.VITE_FIREBASE_STORAGE_BUCKET,messagingSenderId:env.VITE_FIREBASE_MESSAGING_SENDER_ID,appId:env.VITE_FIREBASE_APP_ID};
const app=initializeApp(config), auth=getAuth(app), db=getFirestore(app), storage=getStorage(app);
const status=document.querySelector('#status')!;
const bootstrap=document.querySelector<HTMLButtonElement>('#bootstrap')!;
const smoke=document.querySelector<HTMLButtonElement>('#smoke')!;
const call=async(name:string,data:unknown)=>(await httpsCallable(getFunctions(app,'us-central1'),name)(data)).data as any;
onAuthStateChanged(auth,user=>{
  bootstrap.disabled=smoke.disabled=!user;
  status.textContent=user?`Signed in: ${user.email}\nUID: ${user.uid}\nReady to bootstrap or run the development cloud checks.`:'Sign in with Google to continue.';
});
document.querySelector('#signin')!.addEventListener('click',async()=> {
  try {await signInWithPopup(auth,new GoogleAuthProvider());}catch(e){status.textContent=String(e);}
});
bootstrap.addEventListener('click',async()=> {
  try {status.textContent=`Account ready: ${JSON.stringify(await call('bootstrapAccount',{}))}`;}catch(e){status.textContent=String(e);}
});
smoke.addEventListener('click',async()=> {
  smoke.disabled=true;
  const checks:string[]=[];
  const report:Record<string,unknown>={uid:auth.currentUser?.uid,startedAt:new Date().toISOString(),checks};
  const pass=(s:string)=>{checks.push(s);status.textContent=checks.join('\n');};
  const denied=async(s:string,fn:()=>Promise<unknown>)=>{
    try{await fn();}catch(e:any){if(['permission-denied','functions/permission-denied','storage/unauthorized','functions/unauthenticated'].includes(e.code)){pass(s);return;}throw e;}
    throw Error(`Expected access denial: ${s}`);
  };
  try {
    const uid=auth.currentUser!.uid;
    await call('bootstrapAccount',{});pass('PASS real Google sign-in and Account bootstrap');
    for(let i=0;i<120;i++){
      const subscription=await getDoc(doc(db,'subscriptions',uid));
      if(subscription.exists() && subscription.data().status==='active' && subscription.data().plan==='professional') break;
      status.textContent=checks.join('\n')+'\nWaiting for the IAM operator to assign the temporary Professional entitlement…';
      if(i===119)throw Error('Temporary entitlement was not assigned within four minutes.');
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    pass('PASS authoritative development entitlement read');
    const companyId=`smoke-${crypto.randomUUID()}`,revisionId=crypto.randomUUID();report.companyId=companyId;report.revisionId=revisionId;
    const created=await call('createCompany',{companyId,company:{name:'Development Smoke Test',contact_email:auth.currentUser!.email}});
    if(created.role!=='manager')throw Error('Professional incorrectly received administrator authority.');
    await call('setActiveCompany',{companyId});
    if((await getDoc(doc(db,`companies/${companyId}/memberships/${uid}`))).data()?.role!=='manager')throw Error('Membership mismatch.');
    pass('PASS Company creation, Manager membership and active Company');
    await denied('PASS Manager cannot administer Company',()=>call('updateCompany',{companyId,company:{name:'Forbidden',contact_email:auth.currentUser!.email}}));
    await denied('PASS client cannot grant an entitlement',()=>setDoc(doc(db,'subscriptions',uid),{status:'active'}));
    await denied('PASS client cannot self-promote',()=>setDoc(doc(db,`companies/${companyId}/memberships/${uid}`),{role:'administrator'}));
    await call('beginPublication',{companyId,revisionId,parentRevisionId:null});
    const pdf='%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n';
    const attachment=await call('uploadPublicationSds',{companyId,revisionId,attachmentId:'smoke-sds',chemicalProductId:'smoke-product',base64:btoa(pdf)});
    report.storagePath=attachment.relativePath;
    await call('finalizePublication',{companyId,revisionId,attachmentIds:['smoke-sds'],dataset:{chemicalProducts:[{id:'smoke-product',product_name:'SYNTHETIC TEST ONLY',manufacturer:'Development fixture',sds_date:'2026-09-20'}]}});
    pass('PASS trusted SDS upload and atomic publication');
    const file=ref(storage,attachment.relativePath);
    let bytes: ArrayBuffer | undefined; for(let attempt=0;attempt<30;attempt++){ try {bytes=await getBytes(file);break;} catch(e:any){if(e.code!=="storage/unauthorized" || attempt===29)throw e;status.textContent=checks.join("\n")+"\nWaiting for Storage permission propagation…";await new Promise(r=>setTimeout(r,10000));}} const downloaded=new Uint8Array(bytes!);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',downloaded))).map(v=>v.toString(16).padStart(2,'0')).join('');
    if(digest!==attachment.sha256)throw Error('SDS hash mismatch.');
    pass('PASS authorized SDS download and checksum');
    await denied('PASS direct client overwrite denied',()=>uploadBytes(file,new TextEncoder().encode(pdf)));
    await denied('PASS direct client delete denied',()=>deleteObject(file));
    await denied('PASS client bucket listing denied',()=>listAll(ref(storage,'companies')));
    const unauth=initializeApp(config,`unauth-${crypto.randomUUID()}`);
    await denied('PASS unauthenticated SDS download denied',()=>getBytes(ref(getStorage(unauth),attachment.relativePath)));
    // The operator seeds an existing, published fixture without giving this UID membership.
    await denied('PASS signed-in nonmember SDS download denied',()=>getBytes(ref(storage,'companies/cloud-smoke-private/revisions/fixture/sds/fixture/0000000000000000000000000000000000000000000000000000000000000000.pdf')));
    report.passed=true;pass('PASS cloud smoke checks complete (operator verifies token metadata separately)');
  }catch(e:any){report.passed=false;report.error={code:e.code??'',message:String(e.message??e)};status.textContent=checks.join('\n')+'\nFAILED: '+String(e);}
  finally{report.finishedAt=new Date().toISOString();await fetch('/__cloud-smoke-result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report)}).catch(()=>{});smoke.disabled=false;}
});
