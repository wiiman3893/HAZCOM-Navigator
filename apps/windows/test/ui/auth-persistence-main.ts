import {initializeApp} from 'firebase/app';
import {connectAuthEmulator,createUserWithEmailAndPassword,onAuthStateChanged,signInWithEmailAndPassword,signOut} from 'firebase/auth';
import {initializeWindowsAuth} from '../../src/auth/persistence';

const app=initializeApp({apiKey:'demo-api-key',authDomain:'demo-hazcom-navigator.firebaseapp.com',projectId:'demo-hazcom-navigator',appId:'1:123456789:web:persistence-test'},'windows-persistence-test');
const auth=initializeWindowsAuth(app);
connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
let readyResolve:()=>void=()=>{};
let ready=new Promise<void>(resolve=>{readyResolve=resolve;});
onAuthStateChanged(auth,user=>{document.body.dataset.uid=user?.uid??'';document.body.dataset.ready='true';readyResolve();});
async function settle(){await ready;}
async function login(email:string,password:string){
 try{await createUserWithEmailAndPassword(auth,email,password);}catch(error){if((error as {code?:string}).code!=='auth/email-already-in-use')throw error;await signInWithEmailAndPassword(auth,email,password);}
}
(window as any).authPersistenceTest={
 settle,
 uid:()=>auth.currentUser?.uid??null,
 login,
 logout:async()=>{ready=new Promise<void>(resolve=>{readyResolve=resolve;});await signOut(auth);await ready;}
};
