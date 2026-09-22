import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { getApp } from 'firebase/app';
import { getDocFromServer, doc } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { publish } from '@hazcom/sync';
import { firebaseTransport } from '@hazcom/sync/firebase';
import { auth, db, verifyCompany } from '../auth/firebase';
import { buildWindowsPublication } from './database';

const managedFiles={read:async(relativePath:string)=>new Uint8Array(await invoke<number[]>('read_publication_sds',{relativePath}))};
let running=false;
// Service entry point; UI is intentionally out of scope. Keep revisionId and parent on retry.
export async function publishWindowsCompany(companyId:string,revisionId:string,parentRevisionId:string|null,signal?:AbortSignal) {
  if(running) throw Error('A Windows publication is already running.');
  running=true;
  let journalDb:Database|undefined;
  try {
    const uid=auth.currentUser?.uid;if(!uid)throw Error('Sign in required.');
    const access=await verifyCompany(uid,companyId);if(access.role==='member')throw Error('Company authoring access required.');
    const account=await getDocFromServer(doc(db,'accounts',uid));
    if(account.get('activeCompanyId')!==companyId)throw Error('Select this Company before publishing.');
    const projection=await buildWindowsPublication(uid,companyId,managedFiles);
    journalDb=await Database.load('sqlite:hazcom-publication-journal.db');
    await journalDb.execute('CREATE TABLE IF NOT EXISTS publication_journal (id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    const handle=journalDb;
    const journal={
      async get(key:string){const rows=await handle.select<Array<{value:string}>>('SELECT value FROM publication_journal WHERE id=$1',[`${uid}/${key}`]);return rows.length?JSON.parse(rows[0].value):null;},
      async put(key:string,value:unknown){await handle.execute('INSERT INTO publication_journal(id,value) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET value=excluded.value',[`${uid}/${key}`,JSON.stringify(value)]);}
    };
    const transport=firebaseTransport({auth,db,functions:getFunctions(getApp(),'us-central1'),storage:getStorage(getApp(),`gs://${getApp().options.projectId}.firebasestorage.app`)});
    return await publish({projection,revisionId,parentRevisionId,transport,files:managedFiles,journal,signal});
  } finally {try {await journalDb?.close();} finally {running=false;}}
}
