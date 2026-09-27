import {getDocFromServer,doc} from 'firebase/firestore';
import {authoringService} from '@hazcom/authoring';
import {verifyCompany,auth,db as cloud,call} from '../auth/firebase';
import type {CommercialResolution} from '@hazcom/core';
import {ensureWorkspace,activeWorkspace,type WorkspaceDatabase} from './database';

export async function openAuthoring(uid:string,companyId:string,selected?:WorkspaceDatabase){
 const authorize=async()=>{
  const access=await verifyCompany(uid,companyId);
  const account=await getDocFromServer(doc(cloud,'accounts',uid));
  if(auth.currentUser?.uid!==uid||account.get('activeCompanyId')!==companyId)throw Error('Active Company changed. Refresh access.');
  if(access.role==='member')throw Error('Company authoring permission required.');
  const commercial=await call<CommercialResolution>('getCompanyCapabilities',{companyId});
  if(!commercial.capabilities.canAuthor)throw Error('Company authoring is unavailable under current coverage.');
  if(selected&&activeWorkspace()?.token!==selected.lease.token)throw Error('WORKSPACE_SESSION_STALE');
  return {...access,companyId,active:true,capabilities:commercial.capabilities};
 };
 const access=await authorize(),db=selected??(await ensureWorkspace(uid,companyId)).database;
 await db.execute('INSERT INTO company(id,name,contact_email) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,contact_email=excluded.contact_email',[companyId,access.name,access.contact_email]);
 return authoringService({companyId,authorize,files:db.files,sql:{select:(sql:string,values:unknown[])=>db.select(sql,values),batch:(statements:unknown[])=>db.batch(statements)}});
}
