import {useEffect,useState} from 'react';
import {publicationError,type PublicationProgress,type Readiness} from './data/publication-workflow';

type Service={check:(companyId:string)=>Promise<Readiness>;run:(ready:Readiness,onProgress:(p:PublicationProgress)=>void,signal?:AbortSignal)=>Promise<unknown>};
const phaseLabel:Record<PublicationProgress['phase'],string>={preparing:'Preparing',chunks:'Uploading records and SDS references',sds:'Uploading SDS files',validation:'Validating publication',finalizing:'Finalizing',published:'Published'};
export default function PublicationPanel({company,service,onBusy}:{company:{id:string;name:string};service:Service;onBusy:(busy:boolean)=>void}){
 const [ready,setReady]=useState<Readiness|null>(null),[checking,setChecking]=useState(false),[publishing,setPublishing]=useState(false),[progress,setProgress]=useState<PublicationProgress|null>(null),[error,setError]=useState(''),[success,setSuccess]=useState(false);
 async function check(){setChecking(true);setError('');try{setReady(await service.check(company.id));}catch(e){setReady(null);setError(publicationError(e));}finally{setChecking(false);}}
 useEffect(()=>{void check();},[company.id]);
 useEffect(()=>{const guard=(event:Event)=>{if(publishing)event.preventDefault();};window.addEventListener('hazcom:before-navigation',guard);return()=>window.removeEventListener('hazcom:before-navigation',guard);},[publishing]);
 async function start(){
  if(!ready||publishing)return;
  setPublishing(true);onBusy(true);setSuccess(false);setError('');setProgress({phase:'preparing'});
  try{await service.run(ready,setProgress);setSuccess(true);await check();}
  catch(e){setError(publicationError(e));try{setReady(await service.check(company.id));}catch{/* Keep the failure visible; a later readiness check can refresh state. */}}
  finally{setPublishing(false);onBusy(false);}
 }
 const current=ready?.current;
 const matching=ready?.localChanges===false;
 return <section className="panel" aria-label="Publication">
  <h2>Publication and reports status</h2>
  <p>Company: {company.name}</p>
  {current?<div className="notice"><strong>Current published revision {current.revisionNumber}</strong><p>Published {current.publishedAt?new Date(current.publishedAt).toLocaleString():'at an unconfirmed time'} · {Object.values(current.recordCounts).reduce((a,b)=>a+b,0)} records · {current.attachmentCount} SDS files</p><small>Revision {current.revisionId.slice(0,12)}…</small></div>:<p>No current published revision was found for this Company.</p>}
  {matching&&<p>Local draft matches the current published revision.</p>}
  {ready?.localChanges===true&&<p className="notice">Local changes have not yet been published.</p>}
  {current&&ready?.localChanges===null&&<p>The current cloud revision cannot be compared with this local draft yet.</p>}
  <div className="actions"><button type="button" disabled={checking||publishing} onClick={()=>void check()}>{checking?'Checking readiness…':'Check readiness'}</button></div>
  {checking&&<p role="status">Checking Company access, records, and SDS files…</p>}
  {ready&&<><h3>Readiness: {ready.state}</h3>
   {ready.state==='READY'&&<p>Company data and SDS files passed the publication checks.</p>}
   {ready.issues.length>0&&<ul>{ready.issues.map((issue,index)=><li key={index}><strong>{issue.level}:</strong> {issue.message}</li>)}</ul>}
   {ready.projection&&<p>{ready.projection.metrics.records} records · {ready.projection.metrics.attachments} SDS files ready for publication.</p>}
   {matching&&<p>This draft is already the current published revision.</p>}
   <button type="button" disabled={checking||publishing||ready.state==='BLOCKING'||matching} onClick={()=>void start()}>{ready.attempt?'Retry Publication':'Publish Company'}</button>
  </>}
  {progress&&<p role="status">{phaseLabel[progress.phase]}{progress.total!==undefined?` · ${progress.completed??0} / ${progress.total}`:''}</p>}
  {success&&<p role="status" className="notice">Publication completed. This is now the current published HazCom revision.</p>}
  {error&&<p role="alert" className="error">{error}</p>}
 </section>;
}
