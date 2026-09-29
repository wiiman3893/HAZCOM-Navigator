import {diagnostics,observe} from '../diagnostics/session';
import {invoke} from '@tauri-apps/api/core';
import {doc,getDocFromServer} from 'firebase/firestore';
import { auth,call,db as cloud,verifyCompany, type CompanyAccess } from '../auth/firebase';
import {verifyWindowsSdsIntegrity} from './publication-integrity';
import {buildPublication} from '@hazcom/sync';
import {WorkspaceLifecycle,refreshWorkspaceMode} from './workspace-lifecycle';

export type WorkspaceLease={workspaceId:string;companyId:string;token:string;readOnly:boolean;selectionWarning?:string|null};
export type WorkspaceEntry={workspaceId:string;companyId:string;kind:string;available:boolean;reason:string|null};
export class WorkspaceDatabase {
 constructor(readonly lease:WorkspaceLease){}
 select<T=unknown[]>(statement:string,values:unknown[]=[]):Promise<T>{return invoke('workspace_select',{token:this.lease.token,statement,values});}
 execute(statement:string,values:unknown[]=[]):Promise<void>{return this.batch([{statement,values}]);}
 batch(statements:unknown[]):Promise<void>{return invoke('workspace_batch',{token:this.lease.token,statements});}
 files={
  stage:(companyId:string,id:string,bytes:Uint8Array)=>invoke<string>('workspace_store_pdf',{token:this.lease.token,companyId,id,bytes:Array.from(bytes),importSource:false}),
  stageImport:(companyId:string,id:string,bytes:Uint8Array)=>invoke<string>('workspace_store_pdf',{token:this.lease.token,companyId,id,bytes:Array.from(bytes),importSource:true}),
  materialize:async(sessionId:string,startPage:number,endPage:number)=>{const result=await invoke<{bytes:number[];sha256:string;sizeBytes:number;pageCount:number;materializationVersion:number}>('workspace_materialize_sds_pdf',{token:this.lease.token,sessionId,startPage,endPage});return {...result,bytes:new Uint8Array(result.bytes)};},
  ocrAvailability:()=>invoke<{status:string;language:string|null;ocrVersion:number}>('windows_ocr_availability'),
  ocrPage:(sessionId:string,pageNumber:number)=>invoke<{rawText:string;language:string;ocrVersion:number}>('workspace_ocr_sds_page',{token:this.lease.token,sessionId,pageNumber}),
  read:async(relativePath:string)=>new Uint8Array(await invoke<number[]>('workspace_read_pdf',{token:this.lease.token,relativePath}))
 };
}
let active:WorkspaceDatabase|null=null;
let owner:string|null=null;
const lifecycle=new WorkspaceLifecycle();
export function pinWorkspace(){if(!active)throw Error('Workspace is not open.');return lifecycle.pin();}
export function activeWorkspace(){return active?.lease??null;}
export async function openDatabase():Promise<WorkspaceDatabase>{if(!active)throw Error('Workspace is not open.');return active;}
async function authorizeImpl(uid:string,companyId:string){
 const access=await verifyCompany(uid,companyId);
 const [account,coverage]=await Promise.all([getDocFromServer(doc(cloud,'accounts',uid)),call<{capabilities:{canAuthor:boolean;canExportBackup:boolean}}>('getCompanyCoverageStatus',{companyId})]);
 if(auth.currentUser?.uid!==uid||account.get('activeCompanyId')!==companyId||access.role==='member'||(!coverage.capabilities.canAuthor&&!coverage.capabilities.canExportBackup))throw Error('WORKSPACE_AUTHORIZATION_REQUIRED');
 return !coverage.capabilities.canAuthor;
}
async function selectWorkspaceImpl(uid:string,companyId:string,workspaceId:string):Promise<WorkspaceDatabase>{
 return lifecycle.change(async run=>{
  const readOnly=await authorize(uid,companyId);
  if(run!==lifecycle.generation)throw Error('Workspace access changed.');
  const lease=await invoke<WorkspaceLease>('activate_workspace',{accountId:uid,companyId,workspaceId,readOnly});
  if(run!==lifecycle.generation){await invoke('close_workspace');throw Error('Workspace access changed.');}
  diagnostics.context={...diagnostics.context,company:companyId,workspace:workspaceId,readOnly};diagnostics.emit('workspace.mode','changed',{readOnly});active=new WorkspaceDatabase(lease);owner=uid;return active;
 });
}
export function ensureWorkspace(uid:string,companyId:string):Promise<{database:WorkspaceDatabase;notice:string|null}>{
 return observe('workspace.open',()=>lifecycle.open(uid+'/'+companyId,()=>restoreSelection(uid,companyId)),{company:companyId});
}
async function restoreSelection(uid:string,companyId:string):Promise<{database:WorkspaceDatabase;notice:string|null}>{
 await lifecycle.settled();
 if(active&&owner===uid&&active.lease.companyId===companyId){
  const database=await refreshWorkspaceMode(active,{authorize:()=>authorize(uid,companyId),currentToken:()=>active?.lease.token,close:closeWorkspace,reopen:id=>selectWorkspace(uid,companyId,id)});
  return {database,notice:database.lease.selectionWarning??null};
 }
 let remembered:string|null=null,notice:string|null=null;
 try{remembered=await invoke<string|null>('remembered_workspace',{accountId:uid,companyId});}
 catch(error){notice=`Saved workspace preference could not be read; opening the primary workspace for this Company. ${String(error)}`;}
 try{const database=await selectWorkspace(uid,companyId,remembered??'primary');return {database,notice:notice??database.lease.selectionWarning??null};}
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
  diagnostics.emit('workspace.open','closed');diagnostics.context={screen:'company-selection'};active=null;owner=null;
  await lifecycle.close(()=>invoke<void>('close_workspace'));
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

function authorize(uid:string,companyId:string){return observe('workspace.authorization',()=>authorizeImpl(uid,companyId),{company:companyId});}

export function selectWorkspace(uid:string,companyId:string,workspaceId:string):Promise<WorkspaceDatabase>{return observe('workspace.switch',()=>selectWorkspaceImpl(uid,companyId,workspaceId),{company:companyId,workspace:workspaceId});}
