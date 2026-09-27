import {invoke} from '@tauri-apps/api/core';
import {getApp} from 'firebase/app';
import {getDocFromServer,doc} from 'firebase/firestore';
import {getFunctions} from 'firebase/functions';
import {getStorage} from 'firebase/storage';
import {publish} from '@hazcom/sync';
import {firebaseTransport} from '@hazcom/sync/firebase';
import type {CommercialResolution} from '@hazcom/core';
import {auth,db,verifyCompany,call} from '../auth/firebase';
import {buildWindowsPublication,activeWorkspace,pinWorkspace,type WorkspaceDatabase} from './database';
import {createPublicationWorkflow,type Attempt,type PublishedRevision,type Projection} from './publication-workflow';

function currentUid(){const uid=auth.currentUser?.uid;if(!uid)throw Error('Sign in required.');return uid;}
function transport(){const app=getApp();return firebaseTransport({auth,db,functions:getFunctions(app,'us-central1'),storage:getStorage(app,`gs://${app.options.projectId}.firebasestorage.app`)});}
function timestamp(value:unknown):string|null{
 if(typeof value==='string')return value;
 if(value&&typeof value==='object'&&'toDate' in value&&typeof value.toDate==='function')return (value.toDate() as Date).toISOString();
 return null;
}
export function createWindowsPublication(database:WorkspaceDatabase){
 const managedFiles=database.files;
 const assertWorkspace=()=>{
  if(activeWorkspace()?.token!==database.lease.token)throw Error('Workspace changed. Refresh publication readiness.');
  if(database.lease.workspaceId!=='primary')throw Error('Publication from restored workspaces is blocked until publication isolation acceptance is complete.');
 };
 async function withJournal<T>(uid:string,work:(journal:{get:(key:string)=>Promise<any>;put:(key:string,value:unknown)=>Promise<void>})=>Promise<T>):Promise<T>{
  assertWorkspace();
  const journal={
   async get(key:string){assertWorkspace();const value=await invoke<string|null>('workspace_journal',{token:database.lease.token,key:uid+'/'+key,value:null});return value?JSON.parse(value):null;},
   async put(key:string,value:unknown){assertWorkspace();await invoke('workspace_journal',{token:database.lease.token,key:uid+'/'+key,value:JSON.stringify(value)});}
  };return work(journal);
 }
 const workflow=createPublicationWorkflow({
 async context(companyId){
  assertWorkspace();
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
 projection:async companyId=>{assertWorkspace();return buildWindowsPublication(currentUid(),companyId,managedFiles,database) as Promise<Projection>;},
 getAttempt:async companyId=>withJournal(currentUid(),j=>j.get('ui-attempt/'+companyId) as Promise<Attempt|null>),
 setAttempt:async(companyId,value)=>withJournal(currentUid(),j=>j.put('ui-attempt/'+companyId,value)),
 getPublishedLocal:async companyId=>withJournal(currentUid(),j=>j.get('ui-published/'+companyId) as Promise<PublishedRevision|null>),
 setPublishedLocal:async(companyId,value)=>withJournal(currentUid(),j=>j.put('ui-published/'+companyId,value)),
 async publish({projection,revisionId,parentRevisionId,signal,onProgress}){
  assertWorkspace();
  const guarded=new Proxy(transport(),{get(target,key,receiver){const value=Reflect.get(target,key,receiver);return typeof value==='function'?(...args:unknown[])=>{assertWorkspace();return Reflect.apply(value,target,args);}:value;}});
  return withJournal(currentUid(),journal=>publish({projection,revisionId,parentRevisionId,transport:guarded,files:managedFiles,journal,signal,onProgress}));
 },
 revisionId:()=>crypto.randomUUID(),
 log:event=>console.info('[hazcom-publication]',event)
});
 return {check:workflow.check,run:async(...args:Parameters<typeof workflow.run>)=>{assertWorkspace();const release=pinWorkspace();try{return await workflow.run(...args);}finally{release();}}};
}
