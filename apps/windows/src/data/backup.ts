import {invoke} from '@tauri-apps/api/core';
import {exportCompanyBackup} from '@hazcom/sync/backup';
import {auth,call,verifyCompany} from '../auth/firebase';
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
