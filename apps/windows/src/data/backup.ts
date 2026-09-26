import {invoke} from '@tauri-apps/api/core';
import {exportCompanyBackup,prepareNativeCompanyRestore} from '@hazcom/sync/backup';
import {doc,getDocFromServer} from 'firebase/firestore';
import {auth,db as cloud,call,verifyCompany} from '../auth/firebase';
import {openDatabase} from './database';

interface CoverageStatus {capabilities:{canExportBackup:boolean};status:string;}

/** Service API for local Company backup, including grace/export periods. No authoring mutation is required. */
export async function exportWindowsCompanyBackup(uid:string,companyId:string){
 const authorize=async()=>{
  const access=await verifyCompany(uid,companyId);
  if(access.role==='member'||auth.currentUser?.uid!==uid)throw Error('Company backup requires Manager or Administrator access.');
  const coverage=await call<CoverageStatus>('getCompanyCoverageStatus',{companyId});
  if(!coverage.capabilities.canExportBackup||coverage.status==='expired')throw Error('Company backup is not available under current coverage.');
 };
 await authorize();
 const db=await openDatabase();
 const packageData=await exportCompanyBackup(
  {select:(statement:string,values:unknown[]=[])=>db.select(statement,values)},
  {read:async(relativePath:string)=>new Uint8Array(await invoke<number[]>('read_publication_sds',{relativePath}))},
  companyId
 );
 await authorize();
 return packageData;
}

/** Native import into a separate fresh Company workspace; existing authoring data is never merged. */
export async function restoreWindowsCompanyBackup(uid:string,companyId:string,packageData:unknown){
 const authorize=async()=>{
  const access=await verifyCompany(uid,companyId);
  if(access.role==='member'||auth.currentUser?.uid!==uid)throw Error('Company restore requires Manager or Administrator access.');
  const account=await getDocFromServer(doc(cloud,'accounts',uid));
  if(account.get('activeCompanyId')!==companyId)throw Error('Active Company changed. Refresh access.');
  const coverage=await call<{capabilities:{canAuthor:boolean}}> ('getCompanyCapabilities',{companyId});
  if(!coverage.capabilities.canAuthor)throw Error('COMPANY_RESTORE_REQUIRES_ACTIVE_COVERAGE');
 };
 await authorize();
 const plan=await prepareNativeCompanyRestore(packageData);
 if(plan.companyId!==companyId)throw Error('Backup Company does not match the authorized Company.');
 await authorize();
 return invoke<{companyId:string;databasePath:string;attachmentCount:number;recordCount:number}>('restore_company_backup',plan);
}
