export type HazcomEnvironment='development'|'production';

export interface PublicFirebaseConfig {
  apiKey:string;
  authDomain:string;
  projectId:string;
  appId:string;
  storageBucket:string;
}

export interface WindowsEnvironmentConfig {
  environment:HazcomEnvironment;
  firebase:PublicFirebaseConfig;
}

type EnvironmentSource=Record<string,unknown>;

const DEVELOPMENT_PROJECT='hazcom-navigator-dev';
const DEVELOPMENT_AUTH_DOMAIN='hazcom-navigator-dev.firebaseapp.com';
const DEVELOPMENT_STORAGE_BUCKET='hazcom-navigator-dev.firebasestorage.app';
const EMULATOR_KEYS=[
  'VITE_FIREBASE_AUTH_EMULATOR_HOST',
  'VITE_FIRESTORE_EMULATOR_HOST',
  'VITE_FIREBASE_STORAGE_EMULATOR_HOST',
  'VITE_FUNCTIONS_EMULATOR_HOST'
] as const;

function required(source:EnvironmentSource,key:string):string{
  const value=source[key];
  if(typeof value!=='string'||!value.trim())throw Error(`Windows configuration is missing ${key}.`);
  const trimmed=value.trim();
  if(trimmed.length>512||/[\s\u0000-\u001f\u007f]/.test(trimmed))throw Error(`Windows configuration has an invalid ${key}.`);
  return trimmed;
}

function hostname(value:string,key:string):string{
  if(value!==value.toLowerCase()||value.includes('://')||value.includes('/')||value.includes(':')||value.length>253)throw Error(`Windows configuration has an invalid ${key}.`);
  const labels=value.split('.');
  if(labels.length<2||labels.some(label=>!label||label.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)))throw Error(`Windows configuration has an invalid ${key}.`);
  return value;
}

function projectId(value:string):string{
  if(!/^[a-z][a-z0-9-]{4,29}$/.test(value)||value.endsWith('-'))throw Error('Windows configuration has an invalid VITE_FIREBASE_PROJECT_ID.');
  return value;
}

function unsafeProductionHost(value:string):boolean{
  return value==='localhost'||value.startsWith('127.')||value==='::1'||value.includes('emulator')||value.endsWith('.local');
}

export function parseWindowsEnvironment(source:EnvironmentSource):WindowsEnvironmentConfig{
  const environment=required(source,'VITE_HAZCOM_ENV');
  if(environment!=='development'&&environment!=='production')throw Error('VITE_HAZCOM_ENV must be development or production.');
  const firebase:PublicFirebaseConfig={
    apiKey:required(source,'VITE_FIREBASE_API_KEY'),
    authDomain:hostname(required(source,'VITE_FIREBASE_AUTH_DOMAIN'),'VITE_FIREBASE_AUTH_DOMAIN'),
    projectId:projectId(required(source,'VITE_FIREBASE_PROJECT_ID')),
    appId:required(source,'VITE_FIREBASE_APP_ID'),
    storageBucket:hostname(required(source,'VITE_FIREBASE_STORAGE_BUCKET'),'VITE_FIREBASE_STORAGE_BUCKET')
  };
  if(!/^AIza[A-Za-z0-9_-]{20,}$/.test(firebase.apiKey))throw Error('Windows configuration has an invalid VITE_FIREBASE_API_KEY.');
  if(!/^\d+:\d+:[a-z]+:[A-Za-z0-9_-]+$/.test(firebase.appId))throw Error('Windows configuration has an invalid VITE_FIREBASE_APP_ID.');
  if(environment==='development'){
    if(firebase.projectId!==DEVELOPMENT_PROJECT||firebase.authDomain!==DEVELOPMENT_AUTH_DOMAIN||firebase.storageBucket!==DEVELOPMENT_STORAGE_BUCKET)throw Error('Development builds accept only the HazCom Navigator development Firebase project.');
  }else{
    if(firebase.projectId===DEVELOPMENT_PROJECT||firebase.projectId.startsWith('demo-')||firebase.projectId.includes('emulator'))throw Error('Production configuration cannot use a development or emulator Firebase project.');
    if(firebase.authDomain===DEVELOPMENT_AUTH_DOMAIN||firebase.storageBucket===DEVELOPMENT_STORAGE_BUCKET||unsafeProductionHost(firebase.authDomain)||unsafeProductionHost(firebase.storageBucket))throw Error('Production configuration cannot use a development, local, or emulator Firebase endpoint.');
    if(EMULATOR_KEYS.some(key=>typeof source[key]==='string'&&String(source[key]).trim()))throw Error('Production configuration cannot enable Firebase emulators.');
  }
  return {environment,firebase};
}

export function readWindowsEnvironment(source:EnvironmentSource):{config:WindowsEnvironmentConfig|null;error:string}{
  try{return {config:parseWindowsEnvironment(source),error:''};}
  catch(error){return {config:null,error:error instanceof Error?error.message:'Windows configuration is invalid.'};}
}
