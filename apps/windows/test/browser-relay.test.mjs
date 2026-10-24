import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const html=await readFile(new URL('../src-tauri/src/browser-auth.html',import.meta.url),'utf8');
const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^import .*;$/gm,'').replace('__FIREBASE_CONFIG__','{}');
function relay({nonce='a'.repeat(64),blocked=false}={}){
 const button={hidden:true,disabled:false},status={textContent:''},calls=[];
 class GoogleAuthProvider{setCustomParameters(value){assert.equal(value.prompt,'select_account');}static credentialFromResult(){return {idToken:'synthetic-google-credential'};}}
 const context={location:{hash:'#'+nonce},history:{replaceState(...args){calls.push(['history',args]);}},document:{querySelector:id=>id==='#signin'?button:status},initializeApp:()=>({}),initializeAuth:()=>({}),inMemoryPersistence:{},browserPopupRedirectResolver:{},GoogleAuthProvider,signInWithPopup:async()=>{calls.push(['popup']);if(blocked){blocked=false;throw Object.assign(Error('blocked'),{code:'auth/popup-blocked'});}return {};},signOut:async()=>calls.push(['signout']),fetch:async(url,options)=>{calls.push(['post',url,JSON.parse(options.body)]);return {ok:true};}};
 vm.runInNewContext(script,context);
 return {button,status,calls};
}
test('valid desktop launch opens account selection and posts credentials only to relay',async()=>{
 const r=relay();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(r.calls.filter(c=>c[0]==='popup').length,1);
 assert.deepEqual(r.calls.find(c=>c[0]==='post').slice(1),['/complete',{nonce:'a'.repeat(64),idToken:'synthetic-google-credential'}]);
 assert.match(r.status.textContent,/Return to the Windows app/);assert.equal(r.button.hidden,true);
});
test('popup blocking exposes a user initiated retry',async()=>{
 const r=relay({blocked:true});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(r.button.hidden,false);assert.equal(r.button.disabled,false);assert.match(r.status.textContent,/blocked automatic/);
 await r.button.onclick();assert.match(r.status.textContent,/Return to the Windows app/);
});
test('a page without a desktop nonce cannot start sign in',async()=>{
 const r=relay({nonce:''});await r.button.onclick();assert.equal(r.calls.some(c=>c[0]==='popup'),false);assert.equal(r.button.disabled,true);
});
