import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db, configurationError, signIn, signOutAccount, loadAccount, call, type AccountSession, type CompanyAccess } from './auth/firebase';
import { closeWorkspace, getDashboardCounts, type DashboardCounts } from './data/database';

const nav=['Management Home','Work Areas','Chemical Library','Workers','Assignments & Training','Reports & Export','Company & Access Administration'];

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
    setSession(null);setCompany(null);setError('');
    if(!uid){setBusy(false);return;}
    setBusy(true);
    try{
      const next=await loadAccount(uid);
      if(run!==generation.current)return;
      setSession(next);setEmail(next.email);setCompany(next.companies.find(c=>c.id===next.activeCompanyId)??null);
    }catch(e){if(run===generation.current)setError(message(e));}
    finally{if(run===generation.current)setBusy(false);}
  },[]);
  useEffect(()=>{
    const stop=onAuthStateChanged(auth,user=>{setSignedIn(!!user);void closeWorkspace();void refresh();});
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
    const stopCompany=onSnapshot(doc(db,'companies',company.id),snapshot=>{if(!snapshot.metadata.fromCache && snapshot.data()?.active!==true)revoke();},revoke);
    return()=>{stopMember();stopCompany();};
  },[session,company]);
  async function action(work:()=>Promise<unknown>){setBusy(true);setError('');try{await work();}catch(e){setError(message(e));}finally{setBusy(false);}}
  async function choose(id:string){
    setCompany(null);await closeWorkspace();
    if(!id)return;
    await call('setActiveCompany',{companyId:id});await refresh();
  }
  async function create(){creatingId.current??=crypto.randomUUID();await call('createCompany',{companyId:creatingId.current,company:{name:name.trim(),contact_email:email.trim()}}).then(async result=>{await call('setActiveCompany',{companyId:(result as {companyId:string}).companyId});});creatingId.current=null;setName('');await refresh();}
  const controls=<><button disabled={busy} onClick={()=>void refresh()}>Refresh access</button><button disabled={busy} onClick={()=>void action(signOutAccount)}>Sign out</button></>;
  if(!session || !company)return <main className="entry"><section className="panel">
    <h1>HazCom Navigator</h1><p>Sign in, then choose your Company workspace.</p>
    {error&&<p className="error" role="alert">{error}</p>}
    {busy&&<p role="status">Checking your account and Company access…</p>}
    {!signedIn?<button disabled={busy||!!configurationError} onClick={()=>void action(signIn)}>Sign in with Google</button>:<>
      <div className="actions">{controls}</div>
      {session&&<><p>{session.email}</p><p>{session.entitlement}</p>
        <label>Company<select aria-label="Company" disabled={busy} value="" onChange={e=>void action(()=>choose(e.target.value))}><option value="">Choose a Company</option>{session.companies.map(c=><option key={c.id} value={c.id}>{c.name} · {c.role}</option>)}</select></label>
        {!session.companies.length&&<p>No active Company memberships yet. Ask your Company administrator for access, or create a Company with an eligible subscription.</p>}
        {session.canCreate&&<form onSubmit={e=>{e.preventDefault();void action(create);}}><h2>Create Company</h2><label>Company name<input required maxLength={300} value={name} onChange={e=>setName(e.target.value)}/></label><label>Contact email<input required type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><button disabled={busy}>Create Company</button></form>}
      </>}
    </>}
  </section></main>;
  return <div className="shell"><aside><div className="brand"><strong>HazCom Navigator</strong><span>Windows workspace</span></div>
    <label className="company-label">Active Company<select value={company.id} disabled={busy} onChange={e=>void action(()=>choose(e.target.value))}><option value="">Choose another Company</option>{session.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <p>{company.role}</p><p>{session.entitlement}</p><div className="actions">{controls}</div>
  </aside><Workspace key={`${session.uid}/${company.id}/${company.role}`} uid={session.uid} company={company} error={error}/></div>;
}

function Workspace({uid,company,error}:{uid:string;company:CompanyAccess;error:string}){
  const [active,setActive]=useState('Management Home');
  const [counts,setCounts]=useState<DashboardCounts|null>(null),[failure,setFailure]=useState('');
  useEffect(()=>{let current=true;if(company.role!=='member')getDashboardCounts(uid,company).then(c=>{if(current)setCounts(c);}).catch(e=>{if(current)setFailure(message(e));});return()=>{current=false;};},[uid,company]);
  return <main><header><h1>{active}</h1><p>{company.name}</p></header>{(error||failure)&&<div className="error" role="alert">{error||failure}</div>}
    {company.role==='member'?<section className="panel"><h2>Company member access</h2><p>Your membership is verified. The published safety-data reader is planned for a later update.</p></section>:<>
      <nav className="workspace-nav">{nav.map(item=><button key={item} className={active===item?'active':''} onClick={()=>setActive(item)}>{item}</button>)}</nav>
      {active==='Management Home'?<section className="grid">{counts?Object.entries(counts).map(([label,value])=><div key={label} className="metric"><span>{{companies:'Companies',workAreas:'Work Areas',chemicalProducts:'Chemical Products',workers:'Workers',assignments:'Assignments'}[label]}</span><strong>{value}</strong></div>):<p>Opening Company workspace…</p>}</section>:<section className="panel"><h2>{active}</h2><p>This part of the workspace is coming in a later update.</p></section>}
    </>}
  </main>;
}
function message(error:unknown){return error instanceof Error?error.message:String(error);}
