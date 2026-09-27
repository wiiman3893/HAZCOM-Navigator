import {invoke} from '@tauri-apps/api/core';
import {doc,getDocFromServer} from 'firebase/firestore';
import { auth,call,db as cloud,verifyCompany, type CompanyAccess } from '../auth/firebase';
import {verifyWindowsSdsIntegrity} from './publication-integrity';
import {buildPublication} from '@hazcom/sync';

export type WorkspaceLease={workspaceId:string;companyId:string;token:string;readOnly:boolean};
export type WorkspaceEntry={workspaceId:string;companyId:string;kind:string;available:boolean;reason:string|null};
export class WorkspaceDatabase {
 constructor(readonly lease:WorkspaceLease){}
 select<T=unknown[]>(statement:string,values:unknown[]=[]):Promise<T>{return invoke('workspace_select',{token:this.lease.token,statement,values});}
 execute(statement:string,values:unknown[]=[]):Promise<void>{return this.batch([{statement,values}]);}
 batch(statements:unknown[]):Promise<void>{return invoke('workspace_batch',{token:this.lease.token,statements});}
 files={
  stage:(companyId:string,id:string,bytes:Uint8Array)=>invoke<string>('workspace_store_pdf',{token:this.lease.token,companyId,id,bytes:Array.from(bytes),importSource:false}),
  stageImport:(companyId:string,id:string,bytes:Uint8Array)=>invoke<string>('workspace_store_pdf',{token:this.lease.token,companyId,id,bytes:Array.from(bytes),importSource:true}),
  read:async(relativePath:string)=>new Uint8Array(await invoke<number[]>('workspace_read_pdf',{token:this.lease.token,relativePath}))
 };
}
let active:WorkspaceDatabase|null=null;
let owner:string|null=null;
let generation=0;
let transition:Promise<unknown>=Promise.resolve();
let pinned=0;
export function pinWorkspace(){if(!active)throw Error('Workspace is not open.');pinned++;let released=false;return()=>{if(!released){released=true;pinned--;}};}
export function activeWorkspace(){return active?.lease??null;}
export async function openDatabase():Promise<WorkspaceDatabase>{if(!active)throw Error('Workspace is not open.');return active;}
async function authorize(uid:string,companyId:string){
 const access=await verifyCompany(uid,companyId);
 const [account,coverage]=await Promise.all([getDocFromServer(doc(cloud,'accounts',uid)),call<{capabilities:{canAuthor:boolean;canExportBackup:boolean}}>('getCompanyCoverageStatus',{companyId})]);
 if(auth.currentUser?.uid!==uid||account.get('activeCompanyId')!==companyId||access.role==='member'||(!coverage.capabilities.canAuthor&&!coverage.capabilities.canExportBackup))throw Error('WORKSPACE_AUTHORIZATION_REQUIRED');
 return !coverage.capabilities.canAuthor;
}
export async function selectWorkspace(uid:string,companyId:string,workspaceId:string):Promise<WorkspaceDatabase>{
 const run=generation;
 const work=transition.catch(()=>{}).then(async()=>{
  if(pinned)throw Error('Finish the active backup or publication before switching workspaces.');
  const readOnly=await authorize(uid,companyId);
  if(run!==generation)throw Error('Workspace access changed.');
  if(pinned)throw Error('Finish the active backup or publication before switching workspaces.');
  const lease=await invoke<WorkspaceLease>('activate_workspace',{accountId:uid,companyId,workspaceId,readOnly});
  if(run!==generation){await invoke('close_workspace');throw Error('Workspace access changed.');}
  active=new WorkspaceDatabase(lease);owner=uid;return active;
 });transition=work;return work;
}
export async function ensureWorkspace(uid:string,companyId:string):Promise<{database:WorkspaceDatabase;notice:string|null}>{
 await transition.catch(()=>{});
 if(active&&owner===uid&&active.lease.companyId===companyId)return {database:active,notice:null};
 const remembered=await invoke<string|null>('remembered_workspace',{accountId:uid,companyId});
 try{return {database:await selectWorkspace(uid,companyId,remembered??'primary'),notice:null};}
 catch(error){
  if(!remembered||remembered==='primary')throw error;
  return {database:await selectWorkspace(uid,companyId,'primary'),notice:`Saved workspace unavailable; primary opened for this Company. ${String(error)}`};
 }
}
export async function listWorkspaces(uid:string,companyId:string){await authorize(uid,companyId);return invoke<WorkspaceEntry[]>('list_workspaces',{companyId});}

export interface DashboardCounts {
  companies: number;
  workAreas: number;
  chemicalProducts: number;
  workers: number;
  assignments: number;
}

async function count(db: WorkspaceDatabase, sql: string, binds: unknown[] = []): Promise<number> {
  const rows = await db.select<Array<{ count: number }>>(sql, binds);
  return Number(rows[0]?.count ?? 0);
}

// CODEX HANDOFF: No SQLite load before live Google/Company authorization.
export async function getDashboardCounts(uid: string, company: CompanyAccess): Promise<DashboardCounts> {
  const verified = await verifyCompany(uid, company.id);
  if (verified.role === 'member') throw new Error('Company authoring access is required for local drafts.');
  const activeCompanyId = verified.id;
  const db = await openDatabase();
  await db.execute('INSERT INTO company (id,name,contact_email) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,contact_email=excluded.contact_email', [verified.id,verified.name,verified.contact_email]);
  return {
    companies: 1,
    workAreas: await count(db, `SELECT COUNT(*) AS count FROM work_area wa JOIN work_area__ownership o ON o.child_id=wa.id WHERE o.company_id=$1 AND wa.deleted_at IS NULL`, [activeCompanyId]),
    chemicalProducts: await count(db, `SELECT COUNT(*) AS count FROM chemical_product cp JOIN chemical_product__ownership o ON o.child_id=cp.id WHERE o.company_id=$1 AND cp.deleted_at IS NULL`, [activeCompanyId]),
    workers: await count(db, `SELECT COUNT(*) AS count FROM worker w JOIN worker__ownership o ON o.child_id=w.id WHERE o.company_id=$1 AND w.deleted_at IS NULL`, [activeCompanyId]),
    assignments: await count(db, `SELECT COUNT(*) AS count FROM work_area_assignment waa JOIN work_area_assignment__ownership ao ON ao.child_id=waa.id JOIN work_area__ownership wo ON wo.child_id=ao.work_area_id WHERE wo.company_id=$1 AND waa.deleted_at IS NULL`, [activeCompanyId]),
  };
}

export async function closeWorkspace(): Promise<void> {
  ++generation;active=null;owner=null;
  const work=transition.catch(()=>{}).then(()=>invoke<void>('close_workspace'));transition=work;await work;
}

// One Company-scoped SELECT; managed file reader is bounded to app attachments.
export async function buildWindowsPublication(uid:string,companyId:string,files:{read(path:string):Promise<Uint8Array>},selected?:WorkspaceDatabase) {
  const access=await verifyCompany(uid,companyId);
  if(access.role==='member')throw Error('Company authoring access required.');
  const db=selected??await openDatabase();
  if(db.lease.companyId!==companyId||active?.lease.token!==db.lease.token)throw Error('WORKSPACE_SESSION_STALE');
  const projection=await buildPublication({select:(sql:string,values:unknown[])=>db.select(sql,values)},companyId,files);
  await verifyWindowsSdsIntegrity(projection.attachments,(sql,values)=>db.select(sql,values));
  return projection;
}
