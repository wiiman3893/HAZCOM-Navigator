import {diagnostics,observe} from './diagnostics/session';
import { useCallback, useEffect, useRef, useState } from 'react';
import { onIdTokenChanged, type User } from 'firebase/auth';
import { collection, getDocsFromServer, doc, onSnapshot } from 'firebase/firestore';
import { auth, db, configurationError, signIn, signOutAccount, loadAccount, verifyActiveCompanyAuthorization, call, refreshOfflineAuthorization, listOfflineAuthorizations, clearOfflineAuthorizations, type AccountSession, type CompanyAccess, type OfflineAuthorization } from './auth/firebase';
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
  const [offlineLease,setOfflineLease]=useState<OfflineAuthorization|null>(null);
  const [phase,setPhase]=useState<'restoring'|'signed-out'|'authorizing'|'authorized'|'offline-authorized'|'authorization-failed'>('restoring');
  const [busy,setBusy]=useState(false),[error,setError]=useState(configurationError);
  const [name,setName]=useState(''),[email,setEmail]=useState('');
  const generation=useRef(0);
  const identity=useRef<string|null|undefined>(undefined);
  const creatingId=useRef<string|null>(null);
  useEffect(()=>{diagnostics.context={...diagnostics.context,company:company?.id,role:company?.role,screen:company?diagnostics.context.screen:'company-selection'};diagnostics.emit('company.access','changed');},[company?.id,company?.role]);
  const beginOffline=useCallback(async(uid:string,reason='The service is unavailable. Using protected offline authorization stored on this Windows account.')=>{
    const run=++generation.current;setBusy(true);setError('');setSession(null);setCompany(null);setOfflineLease(null);setPhase('authorizing');await closeWorkspace();
    try{
      const leases=await listOfflineAuthorizations(uid);if(run!==generation.current||auth.currentUser?.uid!==uid)return;
      if(!leases.length)throw Error('No offline authorization is available. Connect to the internet to verify Company access.');
      const companies=leases.map(lease=>({id:lease.companyId,name:lease.companyId,contact_email:'',role:lease.role}));
      const chosen=leases.find(lease=>lease.state==='writable')??leases[0];
      setSession({uid,email:auth.currentUser?.email??'',companies,activeCompanyId:chosen.companyId,entitlement:'Server-authorized offline access',canCreate:false});
      setCompany(companies.find(value=>value.id===chosen.companyId)??null);setOfflineLease(chosen);setPhase('offline-authorized');
      setError(chosen.state==='read_only'?'Offline authorization has expired. Local data remains available for reading and export.':reason);
    }catch(error){if(run===generation.current){setPhase('authorization-failed');setError(message(error));}}
    finally{if(run===generation.current)setBusy(false);}
  },[]);
  const authorize=useCallback(async(uid:string,options:{closeFirst:boolean;preserveView:boolean})=>{
    const run=++generation.current;
    setError('');setBusy(true);setPhase('authorizing');
    if(!options.preserveView){setSession(null);setCompany(null);}setOfflineLease(null);
    try{
      if(options.closeFirst)await closeWorkspace();
      if(run!==generation.current||auth.currentUser?.uid!==uid)return;
      const next=await observe('company.access.refresh',()=>loadAccount(uid));
      const selected=next.companies.find(c=>c.id===next.activeCompanyId)??null;
      if(selected){
        const coverage=await observe('workspace.authorization',()=>verifyActiveCompanyAuthorization(uid,selected),{company:selected.id});
        if(coverage.capabilities.canAuthor){try{await refreshOfflineAuthorization(uid,selected.id);}catch(cacheError){setError(`Online access is active, but offline authorization could not be refreshed: ${message(cacheError)}`);}}
        else await clearOfflineAuthorizations(uid,selected.id).catch(()=>{});
      }
      try{const cached=await listOfflineAuthorizations(uid);await Promise.all(cached.filter(lease=>!next.companies.some(value=>value.id===lease.companyId&&value.role===lease.role)).map(lease=>clearOfflineAuthorizations(uid,lease.companyId)));}catch{/* Online access remains authoritative if local cache maintenance fails. */}
      if(run!==generation.current||auth.currentUser?.uid!==uid)return;
      setSession(next);setEmail(next.email);setCompany(selected);setPhase('authorized');
    }catch(e){if(run===generation.current){if(isNetworkError(e)){await beginOffline(uid);}else{setSession(null);setCompany(null);setOfflineLease(null);setPhase('authorization-failed');setError(authorizationMessage(e));await clearOfflineAuthorizations(uid).catch(()=>{});await closeWorkspace();}}}
    finally{if(run===generation.current)setBusy(false);}
  },[beginOffline]);
  const beginIdentity=useCallback(async(user:User|null)=>{
    const uid=user?.uid??null;
    identity.current=uid;
    const run=++generation.current;
    setSession(null);setCompany(null);setOfflineLease(null);setError('');setBusy(!!uid);setPhase(uid?'authorizing':'signed-out');
    await closeWorkspace();
    if(run!==generation.current||!uid||auth.currentUser?.uid!==uid)return;
    await authorize(uid,{closeFirst:false,preserveView:false});
  },[authorize]);
  const refresh=useCallback(async()=>{
    const uid=auth.currentUser?.uid;
    if(!uid){await beginIdentity(null);return;}
    await authorize(uid,{closeFirst:false,preserveView:true});
  },[authorize,beginIdentity]);
  useEffect(()=>{
    const stop=onIdTokenChanged(auth,user=>{
      if(identity.current===user?.uid&&identity.current!==undefined){if(user&&navigator.onLine)void refresh();return;}
      void beginIdentity(user);
    },()=>{identity.current=auth.currentUser?.uid??null;++generation.current;setSession(null);setCompany(null);setBusy(false);setPhase(auth.currentUser?'authorization-failed':'signed-out');setError(auth.currentUser?'Your saved sign-in could not be validated. Connect and sign in again.':'Sign in again to continue.');void closeWorkspace();});
    const offline=()=>{const uid=auth.currentUser?.uid;if(uid)void beginOffline(uid);else void beginIdentity(null);};
    const focus=()=>{if(auth.currentUser&&navigator.onLine)void beginIdentity(auth.currentUser);};
    window.addEventListener('offline',offline);window.addEventListener('online',focus);window.addEventListener('focus',focus);
    const timer=window.setInterval(focus,60000);
    return()=>{stop();++generation.current;clearInterval(timer);window.removeEventListener('offline',offline);window.removeEventListener('online',focus);window.removeEventListener('focus',focus);};
  },[beginIdentity,beginOffline,refresh]);
  useEffect(()=>{if(!offlineLease)return;const delay=offlineLease.expiresAt-Date.now();if(delay<=0){void beginOffline(offlineLease.accountId,'Offline authorization has expired. Local data remains available for reading and export.');return;}const timer=window.setTimeout(()=>void beginOffline(offlineLease.accountId,'Offline authorization has expired. Local data remains available for reading and export.'),Math.min(delay,2147483647));return()=>clearTimeout(timer);},[offlineLease?.accountId,offlineLease?.companyId,offlineLease?.expiresAt,beginOffline]);
  useEffect(()=>{
    if(!session || !company||offlineLease)return;
    const revoke=()=>{diagnostics.emit('company.access','revoked');void clearOfflineAuthorizations(session.uid,company.id).catch(()=>{});setCompany(null);setError('Company access changed. Refresh your access to continue.');void closeWorkspace();};
    const stopMember=onSnapshot(doc(db,'companies',company.id,'memberships',session.uid),snapshot=>{
      if(snapshot.metadata.fromCache)return;
      const data=snapshot.data();if(!data?.active || data.role!==company.role)revoke();
    },revoke);
    const stopCompany=onSnapshot(doc(db,'companies',company.id),snapshot=>{if(snapshot.metadata.fromCache)return;const c=snapshot.data();if(c?.active!==true)revoke();else setCompany(previous=>previous&&previous.id===company.id&& (previous.name!==c.name||previous.contact_email!==c.contact_email)?{...previous,name:c.name,contact_email:c.contact_email}:previous);},revoke);
    return()=>{stopMember();stopCompany();};
  },[session,company,offlineLease]);
  async function action(work:()=>Promise<unknown>){setBusy(true);setError('');try{await work();}catch(e){setError(message(e));}finally{setBusy(false);}}
  async function explicitSignOut(){
    const uid=auth.currentUser?.uid;identity.current=null;++generation.current;setSession(null);setCompany(null);setOfflineLease(null);setPhase('signed-out');setError('');
    await closeWorkspace();
    try{let clearFailure:unknown=null;if(uid)try{await clearOfflineAuthorizations(uid);}catch(error){clearFailure=error;}await signOutAccount();if(clearFailure)throw clearFailure;}
    catch(error){identity.current=auth.currentUser?.uid??null;setPhase(auth.currentUser?'authorization-failed':'signed-out');throw error;}
  }
  async function choose(id:string){
    if(!window.dispatchEvent(new Event('hazcom:before-navigation',{cancelable:true})))return;
    setCompany(null);setOfflineLease(null);await closeWorkspace();
    if(!id)return;
    if(phase==='offline-authorized'){
      const lease=await listOfflineAuthorizations(session!.uid).then(values=>values.find(value=>value.companyId===id));if(!lease)throw Error('Offline authorization is unavailable for that Company.');
      setCompany(session!.companies.find(value=>value.id===id)??null);setOfflineLease(lease);return;
    }
    await observe('company.access',()=>call('setActiveCompany',{companyId:id}),{company:id});await refresh();
  }
  async function create(){creatingId.current??=crypto.randomUUID();await call('createCompany',{companyId:creatingId.current,company:{name:name.trim(),contact_email:email.trim()}}).then(async result=>{await call('setActiveCompany',{companyId:(result as {companyId:string}).companyId});});creatingId.current=null;setName('');await refresh();}
  const controls=<><button disabled={busy||!navigator.onLine} onClick={()=>void beginIdentity(auth.currentUser)}>Refresh access</button><button disabled={busy} onClick={()=>{if(window.dispatchEvent(new Event('hazcom:before-navigation',{cancelable:true})))void action(explicitSignOut);}}>Sign out</button></>;
  if(!session || !company)return <main className="entry"><section className="panel">
    <h1>HazCom Navigator</h1><p>{phase==='restoring'?'Restoring your saved sign-in…':phase==='authorizing'?'Your identity is restored. Checking current Account, Company, Membership, and coverage access…':'Sign in, then choose your Company workspace.'}</p>
    {error&&<p className="error" role="alert">{error}</p>}
    {(phase==='restoring'||phase==='authorizing')&&<p role="status">{phase==='restoring'?'Restoring Firebase authentication…':'Checking your account and Company access…'}</p>}
    {phase==='signed-out'?<button disabled={busy||!!configurationError} onClick={()=>void action(signIn)}>Sign in with Google</button>:phase!=='restoring'?<>
      <div className="actions">{controls}</div>
      {session&&<><p>{session.email}</p><p>{session.entitlement}</p>{offlineLease&&<p>Offline Company names are hidden until the server is available. Authorization expires {new Date(offlineLease.expiresAt).toLocaleString()}.</p>}
        <label>Company<select aria-label="Company" disabled={busy} value="" onChange={e=>{const id=e.currentTarget.value;e.currentTarget.value="";void action(()=>choose(id));}}><option value="">Choose a Company</option>{session.companies.map(c=><option key={c.id} value={c.id}>{c.name} · {c.role}</option>)}</select></label>
        {!session.companies.length&&<p>No active Company memberships yet. Ask your Company administrator for access, or create a Company with an eligible subscription.</p>}
        {session.canCreate&&<form onSubmit={e=>{e.preventDefault();void action(create);}}><h2>Create Company</h2><label>Company name<input required maxLength={300} value={name} onChange={e=>setName(e.target.value)}/></label><label>Contact email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><button disabled={busy}>Create Company</button></form>}
      </>}
      </>:null}
  </section></main>;
  return <div className="shell"><aside><div className="brand"><strong>HazCom Navigator</strong><span>Windows workspace</span></div>
    <label className="company-label">Active Company<select value={company.id} disabled={busy} onChange={e=>{const id=e.currentTarget.value;e.currentTarget.value=company.id;void action(()=>choose(id));}}><option value="">Choose another Company</option>{session.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <p>{company.role}</p><p>{session.entitlement}</p><div className="actions">{controls}</div>
  </aside><Workspace key={`${session.uid}/${company.id}/${company.role}/${offlineLease?.state??'online'}`} uid={session.uid} company={company} error={error} offline={offlineLease}/></div>;
}

export function Workspace({uid,company,error,offline=null}:{uid:string;company:CompanyAccess;error:string;offline?:OfflineAuthorization|null}){
  const [database,setDatabase]=useState<WorkspaceDatabase|null>(null),[entries,setEntries]=useState<WorkspaceEntry[]>([]),[notice,setNotice]=useState(''),[switching,setSwitching]=useState(false);
  const [publication,setPublication]=useState<ReturnType<typeof createWindowsPublication>|null>(null);
  useEffect(()=>{let stopped=false;if(company.role==='member')return;
    const access=offline?{offline}:undefined;void ensureWorkspace(uid,company.id,access).then(async result=>{
      const items=await listWorkspaces(uid,company.id,access);if(stopped)return;
      setDatabase(result.database);setPublication(offline?null:createWindowsPublication(result.database));setEntries(items);setNotice(result.notice??'');
    }).catch(e=>{if(!stopped){setDatabase(null);setPublication(null);setNotice(message(e));}});return()=>{stopped=true;};
  },[uid,company,offline]);
  const open=useCallback(()=>{if(!database)throw Error('Workspace is not open.');return openAuthoring(uid,company.id,database,offline??undefined);},[uid,company.id,database,offline]);
  async function select(id:string){
    if(!window.dispatchEvent(new Event('hazcom:before-navigation',{cancelable:true})))return;
    setSwitching(true);setNotice('');try{const next=await selectWorkspace(uid,company.id,id,offline?{offline}:undefined);setDatabase(next);setPublication(offline?null:createWindowsPublication(next));}catch(e){setNotice(message(e));}finally{setSwitching(false);}
  }
  async function exportBackup(){setSwitching(true);try{const backup=await exportWindowsCompanyBackup(uid,company.id,offline??undefined);const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`hazcom-${company.id}-backup.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setNotice(message(e));}finally{setSwitching(false);}}
  async function restore(file:File){setSwitching(true);try{if(file.size>100*1024*1024)throw Error('Choose a backup smaller than 100 MiB for this restore workflow.');await restoreWindowsCompanyBackup(uid,company.id,JSON.parse(await file.text()));setEntries(await listWorkspaces(uid,company.id));setNotice('Backup restored into a separate workspace. Select it to begin authoring.');}catch(e){setNotice(message(e));}finally{setSwitching(false);}}
  if(company.role==='member')return <main><h1>Company member access</h1><p>Your membership is verified. The published safety-data reader is planned for a later update.</p></main>;
  return <><section className="panel" aria-label="Local workspace"><label>Local workspace · {company.name}<select disabled={switching||!database} value={database?.lease.workspaceId??'primary'} onChange={e=>void select(e.target.value)}>{entries.map(entry=><option key={entry.workspaceId} value={entry.workspaceId} disabled={!entry.available}>{entry.kind==='primary'?'Primary workspace':`Restored workspace · ${entry.workspaceId}`}{!entry.available?' · unavailable':''}</option>)}</select></label>
    <button disabled={switching||!database} onClick={()=>void exportBackup()}>Export Company backup</button>{!offline&&<label>Restore Company backup<input type="file" accept="application/json,.json" disabled={switching} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void restore(file);}}/></label>}
    <p>Backups include saved Company records and attached SDS files. Unfinished Bulk SDS review sessions stay in this workspace and are not included.</p>
    {notice&&<p role="status">{notice}</p>}{entries.filter(entry=>!entry.available).map(entry=><p key={entry.workspaceId} role="alert">{entry.workspaceId}: {entry.reason}</p>)}
  </section>{offline&&<section className="panel"><h2>Offline authorization</h2><p>{offline.state==='writable'?`Authoring is available offline until ${new Date(offline.expiresAt).toLocaleString()}.`:'The seven-day authorization has expired. Local data remains available for reading and export.'} Publication, Company access administration, backup restore, and other cloud actions require a connection.</p></section>}{database?.lease.readOnly&&<main className="panel"><h2>Read and export workspace</h2><p>Authoring is paused. You can view records and SDS files, run reports, and export the selected workspace.</p></main>}{database&&<AuthoringWorkspace key={database.lease.token} company={company} open={open} readOnly={database.lease.readOnly} publication={publication??undefined} administration={offline?undefined:{
    update:async(name,email)=>{await call('updateCompany',{companyId:company.id,company:{name,contact_email:email}});await openAuthoring(uid,company.id,database);},
    members:async()=>{const rows=await getDocsFromServer(collection(db,'companies',company.id,'memberships'));return rows.docs.map(d=>d.data());},
    setMember:async(value)=>{await call('setMembership',{companyId:company.id,...value});}
  }}/>} {error&&<p role="alert">{error}</p>}</>;
}
function message(error:unknown){return error instanceof Error?error.message:String(error);}
function authorizationMessage(error:unknown){
 const value=message(error),code=typeof error==='object'&&error!==null&&'code'in error?String((error as {code?:unknown}).code):'';
 if(!navigator.onLine||code.includes('unavailable')||code.includes('network-request-failed')||code.includes('deadline-exceeded'))return 'Connect to the internet to verify your Company access. Your local workspace remains on this device.';
 if(code.includes('unauthenticated')||code.includes('user-disabled')||code.includes('user-token-expired')||code.includes('invalid-user-token'))return 'Your saved sign-in is no longer valid. Sign in again to continue.';
 return value;
}
function isNetworkError(error:unknown){const code=typeof error==='object'&&error!==null&&'code'in error?String((error as {code?:unknown}).code):'';return !navigator.onLine||code.includes('unavailable')||code.includes('network-request-failed')||code.includes('deadline-exceeded');}
