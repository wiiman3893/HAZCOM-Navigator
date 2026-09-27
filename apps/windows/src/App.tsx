import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, getDocsFromServer, doc, onSnapshot } from 'firebase/firestore';
import { auth, db, configurationError, signIn, signOutAccount, loadAccount, call, type AccountSession, type CompanyAccess } from './auth/firebase';
import { closeWorkspace,ensureWorkspace,listWorkspaces,selectWorkspace,type WorkspaceDatabase,type WorkspaceEntry } from './data/database';
import { openAuthoring } from './data/authoring';
import AuthoringWorkspace from './AuthoringWorkspace';
import {createWindowsPublication} from './data/publication';
import {exportWindowsCompanyBackup,restoreWindowsCompanyBackup} from './data/backup';



export default function App(){
  return configurationError?<main className="entry"><section className="panel"><h1>HazCom Navigator</h1><p role="alert">{configurationError}</p></section></main>:<AuthenticatedApp/>;
}
function AuthenticatedApp(){
  const [session,setSession]=useState<AccountSession|null>(null),[company,setCompany]=useState<CompanyAccess|null>(null);
  const [signedIn,setSignedIn]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(configurationError);
  const [name,setName]=useState(''),[email,setEmail]=useState('');
  const generation=useRef(0);
  const creatingId=useRef<string|null>(null);
  const refresh=useCallback(async()=>{
    const run=++generation.current,uid=auth.currentUser?.uid;
    setError('');
    if(!uid){setSession(null);setCompany(null);setBusy(false);return;}
    setBusy(true);
    try{
      const next=await loadAccount(uid);
      if(run!==generation.current)return;
      setSession(next);setEmail(next.email);setCompany(next.companies.find(c=>c.id===next.activeCompanyId)??null);
    }catch(e){if(run===generation.current){setSession(null);setCompany(null);setError(message(e));void closeWorkspace();}}
    finally{if(run===generation.current)setBusy(false);}
  },[]);
  useEffect(()=>{
    const stop=onAuthStateChanged(auth,user=>{setSession(null);setCompany(null);setSignedIn(!!user);void closeWorkspace();void refresh();});
    const offline=()=>{++generation.current;setSession(null);setCompany(null);setBusy(false);setError('Connect to the internet to verify your Company access.');void closeWorkspace();};
    const focus=()=>{if(auth.currentUser)void refresh();};
    window.addEventListener('offline',offline);window.addEventListener('online',focus);window.addEventListener('focus',focus);
    const timer=window.setInterval(focus,60000);
    return()=>{stop();++generation.current;clearInterval(timer);window.removeEventListener('offline',offline);window.removeEventListener('online',focus);window.removeEventListener('focus',focus);};
  },[refresh]);
  useEffect(()=>{
    if(!session || !company)return;
    const revoke=()=>{setCompany(null);setError('Company access changed. Refresh your access to continue.');void closeWorkspace();};
    const stopMember=onSnapshot(doc(db,'companies',company.id,'memberships',session.uid),snapshot=>{
      if(snapshot.metadata.fromCache)return;
      const data=snapshot.data();if(!data?.active || data.role!==company.role)revoke();
    },revoke);
    const stopCompany=onSnapshot(doc(db,'companies',company.id),snapshot=>{if(snapshot.metadata.fromCache)return;const c=snapshot.data();if(c?.active!==true)revoke();else setCompany(previous=>previous&&previous.id===company.id&& (previous.name!==c.name||previous.contact_email!==c.contact_email)?{...previous,name:c.name,contact_email:c.contact_email}:previous);},revoke);
    return()=>{stopMember();stopCompany();};
  },[session,company]);
  async function action(work:()=>Promise<unknown>){setBusy(true);setError('');try{await work();}catch(e){setError(message(e));}finally{setBusy(false);}}
  async function choose(id:string){
    if(!window.dispatchEvent(new Event('hazcom:before-navigation',{cancelable:true})))return;
    setCompany(null);await closeWorkspace();
    if(!id)return;
    await call('setActiveCompany',{companyId:id});await refresh();
  }
  async function create(){creatingId.current??=crypto.randomUUID();await call('createCompany',{companyId:creatingId.current,company:{name:name.trim(),contact_email:email.trim()}}).then(async result=>{await call('setActiveCompany',{companyId:(result as {companyId:string}).companyId});});creatingId.current=null;setName('');await refresh();}
  const controls=<><button disabled={busy} onClick={()=>void refresh()}>Refresh access</button><button disabled={busy} onClick={()=>{if(window.dispatchEvent(new Event('hazcom:before-navigation',{cancelable:true})))void action(signOutAccount);}}>Sign out</button></>;
  if(!session || !company)return <main className="entry"><section className="panel">
    <h1>HazCom Navigator</h1><p>Sign in, then choose your Company workspace.</p>
    {error&&<p className="error" role="alert">{error}</p>}
    {busy&&<p role="status">Checking your account and Company access…</p>}
    {!signedIn?<button disabled={busy||!!configurationError} onClick={()=>void action(signIn)}>Sign in with Google</button>:<>
      <div className="actions">{controls}</div>
      {session&&<><p>{session.email}</p><p>{session.entitlement}</p>
        <label>Company<select aria-label="Company" disabled={busy} value="" onChange={e=>{const id=e.currentTarget.value;e.currentTarget.value="";void action(()=>choose(id));}}><option value="">Choose a Company</option>{session.companies.map(c=><option key={c.id} value={c.id}>{c.name} · {c.role}</option>)}</select></label>
        {!session.companies.length&&<p>No active Company memberships yet. Ask your Company administrator for access, or create a Company with an eligible subscription.</p>}
        {session.canCreate&&<form onSubmit={e=>{e.preventDefault();void action(create);}}><h2>Create Company</h2><label>Company name<input required maxLength={300} value={name} onChange={e=>setName(e.target.value)}/></label><label>Contact email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><button disabled={busy}>Create Company</button></form>}
      </>}
    </>}
  </section></main>;
  return <div className="shell"><aside><div className="brand"><strong>HazCom Navigator</strong><span>Windows workspace</span></div>
    <label className="company-label">Active Company<select value={company.id} disabled={busy} onChange={e=>{const id=e.currentTarget.value;e.currentTarget.value=company.id;void action(()=>choose(id));}}><option value="">Choose another Company</option>{session.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <p>{company.role}</p><p>{session.entitlement}</p><div className="actions">{controls}</div>
  </aside><Workspace key={`${session.uid}/${company.id}/${company.role}`} uid={session.uid} company={company} error={error}/></div>;
}

function Workspace({uid,company,error}:{uid:string;company:CompanyAccess;error:string}){
  const [database,setDatabase]=useState<WorkspaceDatabase|null>(null),[entries,setEntries]=useState<WorkspaceEntry[]>([]),[notice,setNotice]=useState(''),[switching,setSwitching]=useState(false);
  const [publication,setPublication]=useState<ReturnType<typeof createWindowsPublication>|null>(null);
  useEffect(()=>{let stopped=false;if(company.role==='member')return;
    void ensureWorkspace(uid,company.id).then(async result=>{
      const items=await listWorkspaces(uid,company.id);if(stopped)return;
      setDatabase(result.database);setPublication(createWindowsPublication(result.database));setEntries(items);setNotice(result.notice??'');
    }).catch(e=>{if(!stopped)setNotice(message(e));});return()=>{stopped=true;};
  },[uid,company.id,company.role]);
  const open=useCallback(()=>{if(!database)throw Error('Workspace is not open.');return openAuthoring(uid,company.id,database);},[uid,company.id,database]);
  async function select(id:string){
    if(!window.dispatchEvent(new Event('hazcom:before-navigation',{cancelable:true})))return;
    setSwitching(true);setNotice('');try{const next=await selectWorkspace(uid,company.id,id);setDatabase(next);setPublication(createWindowsPublication(next));}catch(e){setNotice(message(e));}finally{setSwitching(false);}
  }
  async function exportBackup(){setSwitching(true);try{const backup=await exportWindowsCompanyBackup(uid,company.id);const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`hazcom-${company.id}-backup.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setNotice(message(e));}finally{setSwitching(false);}}
  async function restore(file:File){setSwitching(true);try{if(file.size>100*1024*1024)throw Error('Choose a backup smaller than 100 MiB for this restore workflow.');await restoreWindowsCompanyBackup(uid,company.id,JSON.parse(await file.text()));setEntries(await listWorkspaces(uid,company.id));setNotice('Backup restored into a separate workspace. Select it to begin authoring.');}catch(e){setNotice(message(e));}finally{setSwitching(false);}}
  if(company.role==='member')return <main><h1>Company member access</h1><p>Your membership is verified. The published safety-data reader is planned for a later update.</p></main>;
  return <><section className="panel" aria-label="Local workspace"><label>Local workspace · {company.name}<select disabled={switching||!database} value={database?.lease.workspaceId??'primary'} onChange={e=>void select(e.target.value)}>{entries.map(entry=><option key={entry.workspaceId} value={entry.workspaceId} disabled={!entry.available}>{entry.kind==='primary'?'Primary workspace':`Restored workspace · ${entry.workspaceId}`}{!entry.available?' · unavailable':''}</option>)}</select></label>
    <button disabled={switching||!database} onClick={()=>void exportBackup()}>Export Company backup</button><label>Restore Company backup<input type="file" accept="application/json,.json" disabled={switching} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void restore(file);}}/></label>
    {notice&&<p role="status">{notice}</p>}{entries.filter(entry=>!entry.available).map(entry=><p key={entry.workspaceId} role="alert">{entry.workspaceId}: {entry.reason}</p>)}
  </section>{database?.lease.readOnly&&<main className="panel"><h2>Read and export workspace</h2><p>Authoring is paused for this Company's current coverage. You can export the selected workspace using the backup button above.</p></main>}{database&&!database.lease.readOnly&&publication&&<AuthoringWorkspace key={database.lease.token} company={company} open={open} publication={publication} administration={{
    update:async(name,email)=>{await call('updateCompany',{companyId:company.id,company:{name,contact_email:email}});await openAuthoring(uid,company.id,database);},
    members:async()=>{const rows=await getDocsFromServer(collection(db,'companies',company.id,'memberships'));return rows.docs.map(d=>d.data());},
    setMember:async(value)=>{await call('setMembership',{companyId:company.id,...value});}
  }}/>} {error&&<p role="alert">{error}</p>}</>;
}
function message(error:unknown){return error instanceof Error?error.message:String(error);}
