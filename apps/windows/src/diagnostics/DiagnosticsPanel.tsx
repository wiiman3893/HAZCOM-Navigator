import {useEffect,useState} from 'react';
import {diagnostics,diagnosticHotkey,type DiagnosticClient} from './session';
export default function DiagnosticsPanel({client=diagnostics}:{client?:DiagnosticClient}){
 const [open,setOpen]=useState(false),[tick,setTick]=useState(Date.now()),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[selected,setSelected]=useState('');
 const refresh=async()=>{await client.refresh();setTick(Date.now());};
 const action=async(work:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setMessage('');try{await work();}catch{setMessage('Diagnostics could not complete this action. Your HazCom work can continue.');}finally{await refresh();setBusy(false);}};
 useEffect(()=>{let alive=true;const update=async()=>{await client.refresh();if(alive)setTick(Date.now());};void update();const timer=setInterval(()=>void update(),1000);
  const key=(event:KeyboardEvent)=>{const command=diagnosticHotkey(event,client.active);if(!command)return;event.preventDefault();if(command==='open')setOpen(true);else void client.mark().then(()=>{if(alive)setMessage('Moment marked.');}).catch(()=>{if(alive)setMessage('The moment could not be recorded.');});};
  const error=()=>client.emit('operation','exception',{reason:'OPERATION_FAILED'});
  const invalid=()=>client.emit('validation','failed',{reason:'OPERATION_FAILED'});
  window.addEventListener('keydown',key);window.addEventListener('error',error);window.addEventListener('unhandledrejection',error);
  window.addEventListener('invalid',invalid,true);
  return()=>{alive=false;clearInterval(timer);window.removeEventListener('keydown',key);window.removeEventListener('error',error);window.removeEventListener('unhandledrejection',error);window.removeEventListener('invalid',invalid,true);};
 },[client]);
 const current=client.status.current,active=client.active;const seconds=Math.max(0,Math.floor((tick-(current?.startedMs??tick))/1000));const elapsed=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
 const completed=client.status.sessions;const exportId=selected||completed[0]?.sessionId;
 return <>{active&&<button className="diagnostics-indicator" onClick={()=>setOpen(true)}>DIAGNOSTICS ACTIVE · {elapsed}</button>}{open&&<aside className="panel diagnostics-panel" aria-label="Diagnostics">
  <div className="toolbar"><h2>Diagnostics</h2><button onClick={()=>setOpen(false)}>Close diagnostics</button></div>
  <p>Record a support timeline while reproducing a problem. Records contain actions, results and timings, not customer records, credentials or SDS documents. Nothing is uploaded.</p>
  <p><strong>{active?'Recording':current?.state??'Inactive'}</strong>{active?` · ${elapsed}`:''}</p>{current&&<p><small>{current.sessionId}</small><br/>{current.eventCount} events · {current.droppedEvents} dropped</p>}
  <p>Screenshots: unavailable in this version. Sessions record metadata only.</p>
  <div className="actions"><button disabled={busy||active} onClick={()=>void action(()=>client.start())}>Start Diagnostic Session</button><button disabled={busy||!active} onClick={()=>void action(()=>client.mark())}>Mark Moment</button><button disabled={busy||!active} onClick={()=>void action(()=>client.stop())}>Stop Diagnostic Session</button></div>
  {completed.length>0&&<label>Completed session<select value={exportId} onChange={e=>setSelected(e.target.value)}>{completed.map(s=><option key={s.sessionId} value={s.sessionId}>{new Date(s.startedMs).toLocaleString()} · {s.state} · {s.sessionId.slice(-8)}</option>)}</select></label>}
  <div className="actions"><button disabled={busy||!exportId} onClick={()=>void action(async()=>{const result=await client.export(exportId);setMessage(`Saved ${result.filename}. Open the diagnostic folder to share it with support.`);})}>Export Diagnostic Package</button><button disabled={busy} onClick={()=>void action(()=>client.openExports())}>Open diagnostic folder</button></div>
  {(message||client.failure||client.status.failure||current?.failure)&&<p role="status">{message||client.failure||`Diagnostics degraded: ${client.status.failure||current?.failure}. Your work can continue.`}</p>}
 </aside>}</>;
}
