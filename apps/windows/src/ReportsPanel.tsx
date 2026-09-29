import {useEffect,useMemo,useState} from 'react';
import {chemicalInventoryReport,reportCsv,summary} from '@hazcom/authoring';
import {diagnostics} from './diagnostics/session';

type Props={company:{id:string;name:string};data:any};
const status=(value:string)=>value?value==='approaching'?'Approaching due':value[0].toUpperCase()+value.slice(1):'—';

export default function ReportsPanel({company,data}:Props){
 const [workAreaId,setWorkAreaId]=useState(''),[query,setQuery]=useState('');
 const totals=useMemo(()=>summary(data),[data]);
 const rows=useMemo(()=>chemicalInventoryReport(data,{workAreaId,query}),[data,workAreaId,query]);
 useEffect(()=>{diagnostics.emit('report.open','opened',{entity:'chemical_inventory',count:rows.length});},[]);
 function exportCsv(){
  try{
   const csv=reportCsv('chemicalInventory',rows),blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download='hazcom-chemical-inventory.csv';document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
   diagnostics.emit('report.export','succeeded',{entity:'chemical_inventory',count:rows.length,bytes:blob.size});
  }catch(error){diagnostics.emit('report.export','failed',{entity:'chemical_inventory',reason:'OPERATION_FAILED'});throw error;}
 }
 return <>
  <section className="panel" aria-label="Company HazCom Summary"><h2>Company HazCom Summary</h2><p>{company.name} · current local workspace</p><div className="grid report-summary">
   <div className="metric"><span>Active Work Areas</span><strong>{totals.areas}</strong></div><div className="metric"><span>Active Chemical Products</span><strong>{totals.chemicals}</strong></div><div className="metric"><span>Active Workers</span><strong>{totals.workers}</strong></div><div className="metric"><span>Active assignments</span><strong>{totals.assignments}</strong></div><div className="metric"><span>SDS attention items</span><strong>{totals.sdsOverdue+totals.sdsApproaching+totals.sdsRequired+totals.missingSds}</strong></div><div className="metric"><span>Review attention items</span><strong>{totals.reviewsOverdue+totals.reviewsApproaching+totals.reviewsRequired}</strong></div><div className="metric"><span>Training attention items</span><strong>{totals.training}</strong></div>
  </div></section>
  <section className="panel" aria-label="Chemical Inventory report"><div className="toolbar"><div><h2>Chemical Inventory by Work Area</h2><p>Active placements from this local Company workspace.</p></div><label>Work Area<select value={workAreaId} onChange={event=>setWorkAreaId(event.target.value)}><option value="">All active Work Areas</option>{data.work_area.filter((row:any)=>!row.deleted_at).sort((a:any,b:any)=>a.name.localeCompare(b.name)).map((row:any)=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label>Search<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Product, manufacturer or CAS"/></label><button onClick={exportCsv}>Export CSV</button></div>
   <div className="table-wrap"><table><thead><tr><th>Work Area</th><th>Chemical Product</th><th>Manufacturer / CAS</th><th>Quantity / Storage</th><th>SDS</th><th>Verification</th></tr></thead><tbody>{rows.map((row:any,index:number)=><tr key={`${row.workAreaId}:${row.productName}:${row.storageLocation}:${index}`}><td>{row.workArea}<br/><small>{row.workAreaLocation||'No location recorded'}</small></td>{row.empty?<td colSpan={5}>No active Chemical Products</td>:<><td>{row.productName}</td><td>{row.manufacturer}<br/><small>{row.casNumbers||'No CAS recorded'}</small></td><td>{row.quantity}<br/><small>{row.storageLocation}</small></td><td>{row.sdsPresent}<br/><small>{row.sdsDate||'No date recorded'}</small></td><td>{status(row.sdsVerificationStatus)}</td></>}</tr>)}</tbody></table>{!rows.length&&<p>No active inventory matches these filters.</p>}</div>
  </section>
 </>;
}
