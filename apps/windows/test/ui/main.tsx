import React,{useCallback,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import AuthoringWorkspace from '../../src/AuthoringWorkspace';
import '../../src/styles.css';
import {createPublicationWorkflow} from '../../src/data/publication-workflow';
// This standalone development test entry is never imported by the Windows application.
const attempts=new Map(),publishedLocal=new Map();
function Harness(){const [companyId,setCompany]=useState('ui-company'),[role,setRole]=useState('manager'),[entitlement,setEntitlement]=useState('paid');const open=useCallback(async()=>{
 const invoke=async(method:string,args:any[])=>{const response=await fetch('/authoring-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,role,method,args})});const body=await response.json();if(!response.ok)throw Error(body.error);return method==='readSds'?new Uint8Array(body):body;};
 return Object.fromEntries(['snapshot','create','update','trash','importSds','unlinkSds','readSds'].map(method=>[method,(...args:any[])=>invoke(method,args.map(a=>a instanceof Uint8Array?Array.from(a):a))]));
 },[companyId,role]);
 const publication=useMemo(()=>{
  const key=companyId+'/'+role;
  const api=async(method:string,extra:Record<string,unknown>={})=>{const response=await fetch('/publication-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,role,entitlement,method,...extra})});const value=await response.json();if(!response.ok)throw Error(value.error);return value;};
  return createPublicationWorkflow({
   context:()=>api('context'),projection:()=>api('projection'),getAttempt:async()=>attempts.get(key)??null,setAttempt:async(_c,v)=>{attempts.set(key,v);},
   getPublishedLocal:async()=>publishedLocal.get(key)??null,setPublishedLocal:async(_c,v)=>{publishedLocal.set(key,v);},
   revisionId:()=>crypto.randomUUID(),publish:async({revisionId,parentRevisionId,projection,onProgress})=>{onProgress({phase:'chunks',completed:1,total:1});onProgress({phase:'sds',completed:projection.attachments.length,total:projection.attachments.length});onProgress({phase:'finalizing'});return api('publish',{revisionId,parentRevisionId,fingerprint:projection.fingerprint});}
  });
 },[companyId,role,entitlement]);
 return <div className="shell"><aside><h2>Synthetic UI test</h2><p>No Firebase connection. Separate temporary SQLite only.</p><label>Test Company<select value={companyId} onChange={e=>{const next=e.currentTarget.value;if(window.dispatchEvent(new Event('hazcom:before-navigation',{cancelable:true})))setCompany(next);else e.currentTarget.value=companyId;}}><option value="ui-company">Fixture Company</option><option value="empty-company">Empty Company</option></select></label><label>Test role<select value={role} onChange={e=>setRole(e.target.value)}><option>manager</option><option>administrator</option><option>member</option></select></label><label>Test entitlement<select value={entitlement} onChange={e=>setEntitlement(e.target.value)}><option value="paid">Paid</option><option value="company-demo">Company Demo</option><option value="pro-demo">Pro Demo</option><option value="grace">Grace</option><option value="expired">Expired</option></select></label></aside>{role==='member'?<main><h1>Company member access</h1><p>Authoring is unavailable.</p></main>:<AuthoringWorkspace key={`${companyId}/${role}/${entitlement}`} open={open} publication={publication} company={{id:companyId,name:companyId==='ui-company'?'Synthetic UI Company':'Empty Company',contact_email:'safety@example.test',role}}/>}</div>;}
createRoot(document.getElementById('root')!).render(<Harness/>);
