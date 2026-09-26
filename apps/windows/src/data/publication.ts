import Database from '@tauri-apps/plugin-sql';
import {invoke} from '@tauri-apps/api/core';
import {getApp} from 'firebase/app';
import {getDocFromServer,doc} from 'firebase/firestore';
import {getFunctions} from 'firebase/functions';
import {getStorage} from 'firebase/storage';
import {publish} from '@hazcom/sync';
import {firebaseTransport} from '@hazcom/sync/firebase';
import type {CommercialResolution} from '@hazcom/core';
import {auth,db,verifyCompany,call} from '../auth/firebase';
import {buildWindowsPublication} from './database';
import {createPublicationWorkflow,type Attempt,type PublishedRevision,type Projection} from './publication-workflow';

const managedFiles={read:async(relativePath:string)=>new Uint8Array(await invoke<number[]>('read_publication_sds',{relativePath}))};
let journalPromise:Promise<Database>|null=null;
function openJournal():Promise<Database>{
 if(!journalPromise)journalPromise=Database.load('sqlite:hazcom-publication-journal.db').then(async handle=>{
  await handle.execute('CREATE TABLE IF NOT EXISTS publication_journal (id TEXT PRIMARY KEY,value TEXT NOT NULL)');
  return handle;
 }).catch(error=>{journalPromise=null;throw error;});
 return journalPromise;
}
async function withJournal<T>(uid:string,work:(journal:{get:(key:string)=>Promise<any>;put:(key:string,value:unknown)=>Promise<void>})=>Promise<T>):Promise<T>{
 const handle=await openJournal();
  const journal={
   async get(key:string){const rows=await handle.select<Array<{value:string}>>('SELECT value FROM publication_journal WHERE id=$1',[uid+'/'+key]);return rows.length?JSON.parse(rows[0].value):null;},
   async put(key:string,value:unknown){await handle.execute('INSERT INTO publication_journal(id,value) VALUES ($1,$2) ON CONFLICT(id) DO UPDATE SET value=excluded.value',[uid+'/'+key,JSON.stringify(value)]);}
  };
  return await work(journal);
}
function currentUid(){const uid=auth.currentUser?.uid;if(!uid)throw Error('Sign in required.');return uid;}
function transport(){const app=getApp();return firebaseTransport({auth,db,functions:getFunctions(app,'us-central1'),storage:getStorage(app,`gs://${app.options.projectId}.firebasestorage.app`)});}
function timestamp(value:unknown):string|null{
 if(typeof value==='string')return value;
 if(value&&typeof value==='object'&&'toDate' in value&&typeof value.toDate==='function')return (value.toDate() as Date).toISOString();
 return null;
}
export const windowsPublication=createPublicationWorkflow({
 async context(companyId){
  const uid=currentUid(),access=await verifyCompany(uid,companyId);
  const [account,company,commercial]=await Promise.all([
   getDocFromServer(doc(db,'accounts',uid)),getDocFromServer(doc(db,'companies',companyId)),
   call<CommercialResolution>('getCompanyCapabilities',{companyId})
  ]);
  if(account.get('activeCompanyId')!==companyId)throw Error('The active Company changed. Select it again.');
  const currentRevisionId=company.get('currentRevisionId')??null;
  let published:PublishedRevision|null=null;
  if(currentRevisionId){
   const revision=await getDocFromServer(doc(db,'companies',companyId,'publishedRevisions',currentRevisionId));
   if(!revision.exists()||revision.get('status')!=='published'||revision.get('companyId')!==companyId)throw Error('Current published revision is unavailable.');
   published={revisionId:currentRevisionId,revisionNumber:revision.get('revisionNumber'),publishedAt:timestamp(revision.get('publishedAt')),recordCounts:revision.get('recordCounts')??{},attachmentCount:revision.get('attachmentCount')??0,fingerprint:null,manifestHash:revision.get('manifestHash')??null,contentHash:revision.get('contentHash')??null};
  }
  return {uid,companyId,companyName:access.name,companyEmail:access.contact_email,role:access.role,canPublish:commercial.capabilities.canPublish,coverageStatus:commercial.status,currentRevisionId,currentRevisionNumber:company.get('currentRevisionNumber')??null,published};
 },
 projection:async companyId=>buildWindowsPublication(currentUid(),companyId,managedFiles) as Promise<Projection>,
 getAttempt:async companyId=>withJournal(currentUid(),j=>j.get('ui-attempt/'+companyId) as Promise<Attempt|null>),
 setAttempt:async(companyId,value)=>withJournal(currentUid(),j=>j.put('ui-attempt/'+companyId,value)),
 getPublishedLocal:async companyId=>withJournal(currentUid(),j=>j.get('ui-published/'+companyId) as Promise<PublishedRevision|null>),
 setPublishedLocal:async(companyId,value)=>withJournal(currentUid(),j=>j.put('ui-published/'+companyId,value)),
 async publish({projection,revisionId,parentRevisionId,signal,onProgress}){
  return withJournal(currentUid(),journal=>publish({projection,revisionId,parentRevisionId,transport:transport(),files:managedFiles,journal,signal,onProgress}));
 },
 revisionId:()=>crypto.randomUUID(),
 log:event=>console.info('[hazcom-publication]',event)
});
