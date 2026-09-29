import {test,expect,chromium} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

test('Firebase-managed local persistence survives process restart and sign-out clears it',async()=>{
 const profile=await mkdtemp(path.join(tmpdir(),'hazcom-auth-profile-'));
 const url='http://127.0.0.1:1435/auth-persistence.html';
 const email=`session-${Date.now()}@example.test`,password='Synthetic-only-Password-9182!';
 let context;
 try{
  context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true});
  let page=context.pages()[0]??await context.newPage();await page.goto(url);await page.evaluate(()=>window.authPersistenceTest.settle());
  expect(await page.evaluate(()=>window.authPersistenceTest.uid())).toBeNull();
  await page.evaluate(([email,password])=>window.authPersistenceTest.login(email,password),[email,password]);
  const uid=await page.evaluate(()=>window.authPersistenceTest.uid());expect(uid).toBeTruthy();
  const databases=await page.evaluate(async()=>typeof indexedDB.databases==='function'?(await indexedDB.databases()).map(value=>value.name):[]);
  expect(databases.some(name=>name?.includes('firebaseLocalStorage'))).toBe(true);
  await context.close();context=undefined;

  context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true});
  page=context.pages()[0]??await context.newPage();await page.goto(url);await page.evaluate(()=>window.authPersistenceTest.settle());
  expect(await page.evaluate(()=>window.authPersistenceTest.uid())).toBe(uid);
  await page.evaluate(()=>window.authPersistenceTest.logout());
  expect(await page.evaluate(()=>window.authPersistenceTest.uid())).toBeNull();
  await context.close();context=undefined;

  context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true});
  page=context.pages()[0]??await context.newPage();await page.goto(url);await page.evaluate(()=>window.authPersistenceTest.settle());
  expect(await page.evaluate(()=>window.authPersistenceTest.uid())).toBeNull();
 }finally{if(context)await context.close();await rm(profile,{recursive:true,force:true});}
});
