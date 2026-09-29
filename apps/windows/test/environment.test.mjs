import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const folder=await mkdtemp(path.join(tmpdir(),'hazcom-environment-'));
await writeFile(path.join(folder,'package.json'),'{"type":"module"}');
const sourcePath=fileURLToPath(new URL('../src/config/environment.ts',import.meta.url));
const compiler=fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc',import.meta.url));
const compiled=spawnSync(process.execPath,[compiler,'--ignoreConfig','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--outDir',folder,'--rootDir',path.dirname(sourcePath),sourcePath],{encoding:'utf8'});
if(compiled.status!==0)throw Error(`Environment test compile failed: ${compiled.error??''}\n${compiled.stdout??''}${compiled.stderr??''}`);
const modulePath=path.join(folder,'environment.js');
const {parseWindowsEnvironment,readWindowsEnvironment}=await import(pathToFileURL(modulePath));

const development={
  VITE_HAZCOM_ENV:'development',
  VITE_FIREBASE_API_KEY:'AIzaSySyntheticDevelopmentKey123456',
  VITE_FIREBASE_AUTH_DOMAIN:'hazcom-navigator-dev.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID:'hazcom-navigator-dev',
  VITE_FIREBASE_STORAGE_BUCKET:'hazcom-navigator-dev.firebasestorage.app',
  VITE_FIREBASE_APP_ID:'1:391606138651:web:b4b8dab8d0ef45d43f85be'
};
const production={
  ...development,
  VITE_HAZCOM_ENV:'production',
  VITE_FIREBASE_AUTH_DOMAIN:'hazcom-navigator.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID:'hazcom-navigator-prod',
  VITE_FIREBASE_STORAGE_BUCKET:'hazcom-navigator-prod.firebasestorage.app',
  VITE_FIREBASE_APP_ID:'1:123456789012:web:abcdef0123456789'
};

test('accepts the exact development Firebase environment',()=>{
  assert.deepEqual(parseWindowsEnvironment(development),{environment:'development',firebase:{apiKey:development.VITE_FIREBASE_API_KEY,authDomain:development.VITE_FIREBASE_AUTH_DOMAIN,projectId:development.VITE_FIREBASE_PROJECT_ID,storageBucket:development.VITE_FIREBASE_STORAGE_BUCKET,appId:development.VITE_FIREBASE_APP_ID}});
});

test('accepts a production-like public client configuration without server secrets',()=>{
  const parsed=parseWindowsEnvironment(production);
  assert.equal(parsed.environment,'production');
  assert.deepEqual(Object.keys(parsed.firebase).sort(),['apiKey','appId','authDomain','projectId','storageBucket']);
  assert.ok(!Object.keys(parsed.firebase).some(key=>/secret|private|service|billing|email/i.test(key)));
});

test('rejects missing, malformed, and unknown configuration',()=>{
  assert.match(readWindowsEnvironment({...development,VITE_FIREBASE_API_KEY:''}).error,/missing VITE_FIREBASE_API_KEY/);
  assert.throws(()=>parseWindowsEnvironment({...development,VITE_FIREBASE_AUTH_DOMAIN:'https://hazcom-navigator-dev.firebaseapp.com/path'}),/invalid VITE_FIREBASE_AUTH_DOMAIN/);
  assert.throws(()=>parseWindowsEnvironment({...development,VITE_HAZCOM_ENV:'staging'}),/development or production/);
  assert.throws(()=>parseWindowsEnvironment({...development,VITE_HAZCOM_ENV:undefined}),/missing VITE_HAZCOM_ENV/);
});

test('production never falls back to development or emulator resources',()=>{
  assert.throws(()=>parseWindowsEnvironment({...production,VITE_FIREBASE_PROJECT_ID:'hazcom-navigator-dev'}),/development or emulator Firebase project/);
  assert.throws(()=>parseWindowsEnvironment({...production,VITE_FIREBASE_PROJECT_ID:'demo-hazcom-navigator'}),/development or emulator Firebase project/);
  assert.throws(()=>parseWindowsEnvironment({...production,VITE_FIREBASE_AUTH_DOMAIN:'firebase-emulator.example.com'}),/development, local, or emulator/);
  assert.throws(()=>parseWindowsEnvironment({...production,VITE_FIREBASE_AUTH_DOMAIN:'localhost.local'}),/development, local, or emulator/);
  assert.throws(()=>parseWindowsEnvironment({...production,VITE_FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'}),/cannot enable Firebase emulators/);
});
