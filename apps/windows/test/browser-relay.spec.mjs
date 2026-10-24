import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function openRelay(page,options={}){
 const html=(await readFile(new URL('../src-tauri/src/browser-auth.html',import.meta.url),'utf8')).replace('__FIREBASE_CONFIG__','{}').replace('__ENVIRONMENT_LABEL__','test');
 await page.addInitScript(options=>{window.relayTest={...options,attempts:0,signouts:0,completions:[]};},options);
 await page.route('**/relay-fixture',route=>route.fulfill({contentType:'text/html',body:html}));
 await page.route('https://www.gstatic.com/firebasejs/**',route=>route.fulfill({contentType:'text/javascript',body:route.request().url().endsWith('/firebase-app.js')
  ?'export const initializeApp=config=>config;'
  :`export const initializeAuth=()=>({});export const inMemoryPersistence={};export const browserPopupRedirectResolver={};
export class GoogleAuthProvider{setCustomParameters(value){window.relayTest.parameters=value;}static credentialFromResult(result){return result.credential;}}
export async function signInWithPopup(){const test=window.relayTest;test.attempts++;if(test.blockFirst&&test.attempts===1)throw Object.assign(Error('blocked'),{code:'auth/popup-blocked'});return {credential:test.missingCredential?null:{idToken:'synthetic-test-token'}};}
export async function signOut(){window.relayTest.signouts++;}`}));
 await page.route('**/complete',async route=>{
  await page.evaluate(value=>window.relayTest.completions.push(value),route.request().postDataJSON());
  await route.fulfill({status:204});
 });
 await page.goto('/relay-fixture#'+(options.invalidNonce?'invalid':'a'.repeat(64)));
}

test('Relay opens the Google selector automatically and completes once',async({page})=>{
 await openRelay(page);
 await expect(page.getByRole('status')).toContainText('Sign-in sent to HazCom Navigator');
 expect(await page.evaluate(()=>window.relayTest.attempts)).toBe(1);
 expect(await page.evaluate(()=>window.relayTest.parameters)).toEqual({prompt:'select_account'});
 expect(await page.evaluate(()=>window.relayTest.completions)).toEqual([{nonce:'a'.repeat(64),idToken:'synthetic-test-token'}]);
 expect(await page.evaluate(()=>window.relayTest.signouts)).toBe(1);
 await expect(page.getByRole('button',{name:'Continue with Google'})).toBeHidden();
 expect(page.url()).not.toContain('#');
});

test('Blocked automatic popup provides one working click fallback',async({page})=>{
 await openRelay(page,{blockFirst:true});
 await expect(page.getByRole('status')).toContainText('Your browser blocked the Google window');
 await page.getByRole('button',{name:'Continue with Google'}).click();
 await expect(page.getByRole('status')).toContainText('Sign-in sent to HazCom Navigator');
 expect(await page.evaluate(()=>window.relayTest.attempts)).toBe(2);
 expect(await page.evaluate(()=>window.relayTest.completions.length)).toBe(1);
});

test('Invalid relay nonce and absent Google credentials never complete login',async({page})=>{
 await openRelay(page,{invalidNonce:true});
 await expect(page.getByRole('status')).toHaveText('Open sign-in from the Windows app.');
 expect(await page.evaluate(()=>window.relayTest.attempts)).toBe(0);
 await page.unrouteAll({behavior:'wait'});
 await openRelay(page,{missingCredential:true});
 await expect(page.getByRole('status')).toContainText('Google did not return a sign-in credential');
 expect(await page.evaluate(()=>window.relayTest.completions)).toEqual([]);
});
