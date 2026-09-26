import {invoke} from '@tauri-apps/api/core';
import {getDocFromServer,doc} from 'firebase/firestore';
import {authoringService} from '@hazcom/authoring';
import {verifyCompany,auth,db as cloud,call} from '../auth/firebase';
import type {CommercialResolution} from '@hazcom/core';
import {openDatabase} from './database';

export async function openAuthoring(uid:string,companyId:string){
 const authorize=async()=>{
  const access=await verifyCompany(uid,companyId);
  const account=await getDocFromServer(doc(cloud,'accounts',uid));
  if(auth.currentUser?.uid!==uid||account.get('activeCompanyId')!==companyId)throw Error('Active Company changed. Refresh access.');
  if(access.role==='member')throw Error('Company authoring permission required.');
  const commercial=await call<CommercialResolution>('getCompanyCapabilities',{companyId});
  if(!commercial.capabilities.canAuthor)throw Error('Company authoring is unavailable under current coverage.');
  return {...access,companyId,active:true,capabilities:commercial.capabilities};
 };
 const access=await authorize(),db=await openDatabase();
 await db.execute('INSERT INTO company(id,name,contact_email) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,contact_email=excluded.contact_email',[companyId,access.name,access.contact_email]);
 const files={
  stage:(companyId:string,id:string,bytes:Uint8Array)=>invoke<string>('store_authoring_pdf',{companyId,id,bytes:Array.from(bytes)}),
  read:async(relativePath:string)=>new Uint8Array(await invoke<number[]>('read_authoring_pdf',{relativePath}))
 };
 return authoringService({companyId,authorize,files,sql:{select:(sql:string,values:unknown[])=>db.select(sql,values),batch:(statements:unknown[])=>invoke('authoring_batch',{statements})}});
}
