import React,{useEffect,useState} from 'react';
const params=new URLSearchParams(location.search);
let active:any=null;
export const calls:string[]=[];
(window as any).workspaceTest={calls};
export const auth={},db={},configurationError='';
export async function signIn(){} export async function signOutAccount(){} export async function loadAccount(){} export async function call(){}
const entries=['primary','restored-a','restored-b','restored-broken'].map(workspaceId=>({workspaceId,companyId:'workspace-company',kind:workspaceId==='primary'?'primary':'restored',available:workspaceId!=='restored-broken',reason:workspaceId==='restored-broken'?'WORKSPACE_INTEGRITY_FAILED':null}));
export async function closeWorkspace(){active=null;}
export async function ensureWorkspace(){calls.push('ensure');const saved=localStorage.getItem('workspace-test-selection')??'primary';active={lease:{workspaceId:saved==='restored-missing'?'primary':saved,token:crypto.randomUUID(),readOnly:params.has('readonly')}};return {database:active,notice:saved==='restored-missing'?'Saved workspace unavailable; primary opened for this Company.':null};}
export async function listWorkspaces(){return entries;}
export async function selectWorkspace(_uid:string,_company:string,id:string){calls.push('select:'+id);if(params.has('fail')&&id==='restored-b')throw Error('WORKSPACE_INTEGRITY_FAILED');active={lease:{workspaceId:id,token:crypto.randomUUID(),readOnly:params.has('readonly')}};localStorage.setItem('workspace-test-selection',id);return active;}
export async function openAuthoring(_uid:string,_company:string,database:any){return database.lease.workspaceId;}
export function createWindowsPublication(database:any){return {workspaceId:database.lease.workspaceId};}
export async function exportWindowsCompanyBackup(){calls.push('export:'+active.lease.workspaceId);return {synthetic:true,workspaceId:active.lease.workspaceId};}
export async function restoreWindowsCompanyBackup(){calls.push('restore');}
export default function Authoring({open,publication}:any){const [id,setId]=useState('');useEffect(()=>{void open().then(setId);},[open]);return <main><p data-testid="authoring-workspace">{id}</p><p data-testid="publication-workspace">{publication.workspaceId}</p></main>;}
