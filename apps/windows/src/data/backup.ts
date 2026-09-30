import {observe} from '../diagnostics/session';
import {invoke} from '@tauri-apps/api/core';
import {exportCompanyBackup,prepareNativeCompanyRestore} from '@hazcom/sync/backup';
import {doc,getDocFromServer} from 'firebase/firestore';
import {auth,db as cloud,call,verifyCompany,type OfflineAuthorization} from '../auth/firebase';
import {openDatabase,pinWorkspace} from './database';
import {enforcePublicationLimits,type Capabilities} from '@hazcom/core';

interface CoverageStatus {capabilities:{canExportBackup:boolean};status:string;}

/** Service API for local Company backup, including grace/export periods. No authoring mutation is required. */
async function exportWindowsCompanyBackupImpl(uid:string,companyId:string,offline?:OfflineAuthorization){
 const authorize=async()=>{
  if(offline){if(offline.accountId!==uid||offline.companyId!==companyId||!['administrator','manager'].includes(offline.role))throw Error('Offline backup authorization does not match this workspace.');return;}
  const access=await verifyCompany(uid,companyId);
  if(access.role==='member'||auth.currentUser?.uid!==uid)throw Error('Company backup requires Manager or Administrator access.');
  const coverage=await call<CoverageStatus>('getCompanyCoverageStatus',{companyId});
  if(!coverage.capabilities.canExportBackup)throw Error('Company backup is not available under current coverage.');
 };
 await authorize();
 const release=pinWorkspace();
 try{
 const db=await openDatabase();
 if(db.lease.companyId!==companyId)throw Error('WORKSPACE_COMPANY_MISMATCH');
 const packageData=await exportCompanyBackup(
  {select:(statement:string,values:unknown[]=[])=>db.select(statement,values)},
  db.files,
  companyId
 );
 await authorize();
 return packageData;
 }finally{release();}
}

/** Native import into a separate fresh Company workspace; existing authoring data is never merged. */
async function restoreWindowsCompanyBackupImpl(uid:string,companyId:string,packageData:unknown){
 const authorize=async()=>{
  const access=await verifyCompany(uid,companyId);
  if(access.role==='member'||auth.currentUser?.uid!==uid)throw Error('Company restore requires Manager or Administrator access.');
  const account=await getDocFromServer(doc(cloud,'accounts',uid));
  if(account.get('activeCompanyId')!==companyId)throw Error('Active Company changed. Refresh access.');
  const coverage=await call<{capabilities:Capabilities}> ('getCompanyCapabilities',{companyId});
  if(!coverage.capabilities.canAuthor)throw Error('COMPANY_RESTORE_REQUIRES_ACTIVE_COVERAGE');
  return coverage.capabilities;
 };
 await authorize();
 const plan=await prepareNativeCompanyRestore(packageData);
 if(plan.companyId!==companyId)throw Error('Backup Company does not match the authorized Company.');
 const capabilities=await authorize();
 const tables=(packageData as {tables:Record<string,Array<{deleted_at?:string|null}>>}).tables;
 enforcePublicationLimits(capabilities,{workAreas:tables.work_area.filter(row=>!row.deleted_at).length,chemicalProducts:tables.chemical_product.filter(row=>!row.deleted_at).length,workers:tables.worker.filter(row=>!row.deleted_at).length});
 const db=await openDatabase();if(db.lease.companyId!==companyId)throw Error('WORKSPACE_COMPANY_MISMATCH');
 return invoke<{companyId:string;workspaceId:string;databasePath:string;attachmentCount:number;recordCount:number}>('restore_company_backup',{...plan,token:db.lease.token});
}

/** Rechecks Company access and coverage before reading the separate restored workspace. */
async function inspectWindowsRestoredCompanyBackupImpl(uid:string,companyId:string,workspaceId?:string){
 const access=await verifyCompany(uid,companyId);
 if(access.role==='member'||auth.currentUser?.uid!==uid)throw Error('Company backup inspection requires Manager or Administrator access.');
 const coverage=await call<CoverageStatus>('getCompanyCoverageStatus',{companyId});
 if(!coverage.capabilities.canExportBackup)throw Error('COMPANY_BACKUP_NOT_AVAILABLE');
 return invoke<{companyId:string;packageVersion:number;schemaVersion:number|null;workAreas:number;chemicalProducts:number;workers:number;verifiedSds:number}>('inspect_restored_company_backup',{companyId,workspaceId});
}

export function exportWindowsCompanyBackup(uid:string,companyId:string,offline?:OfflineAuthorization){return observe('backup.export',()=>exportWindowsCompanyBackupImpl(uid,companyId,offline),{company:companyId});}

export function restoreWindowsCompanyBackup(uid:string,companyId:string,packageData:unknown){return observe('backup.restore',()=>restoreWindowsCompanyBackupImpl(uid,companyId,packageData),{company:companyId});}

export function inspectWindowsRestoredCompanyBackup(uid:string,companyId:string,workspaceId?:string){return observe('backup.inspect',()=>inspectWindowsRestoredCompanyBackupImpl(uid,companyId,workspaceId),{company:companyId});}
