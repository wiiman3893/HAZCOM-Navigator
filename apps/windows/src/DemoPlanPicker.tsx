import {useEffect,useState} from 'react';
type Demo={type:'company'|'pro';coveredCompanyIds:string[];selectedCompanyId:string|null};
type Company={id:string;name:string};
export default function DemoPlanPicker({demo,companies,busy,onApply}:{demo:Demo;companies:Company[];busy:boolean;onApply:(type:'company'|'pro',selectedCompanyId:string|null)=>void}){
 const [type,setType]=useState(demo.type);
 const [selected,setSelected]=useState(demo.selectedCompanyId??demo.coveredCompanyIds[0]??'');
 const coveredKey=demo.coveredCompanyIds.join('|');
 useEffect(()=>{setType(demo.type);setSelected(demo.selectedCompanyId??demo.coveredCompanyIds[0]??'');},[demo.type,demo.selectedCompanyId,coveredKey]);
 const changed=type!==demo.type||(type==='company'&&selected!==(demo.selectedCompanyId??demo.coveredCompanyIds[0]??''));
 return <section aria-label="Demo plan"><h2>Choose your Demo</h2><label>Demo plan<select disabled={busy} value={type} onChange={e=>setType(e.target.value as 'company'|'pro')}><option value="company">Company Demo</option><option value="pro">Pro Demo</option></select></label>
 <p>{type==='pro'?'For consultants managing several client Companies. Pro Demo supports up to three Companies. New Companies give you the Manager role.':'For an organization managing its own HazCom program. Company Demo supports one active Company. New Companies give you the Administrator role.'}</p>
 {type==='company'&&demo.coveredCompanyIds.length>0&&<label>Company to keep active<select disabled={busy} value={selected} onChange={e=>setSelected(e.target.value)}>{demo.coveredCompanyIds.map(id=><option key={id} value={id}>{companies.find(company=>company.id===id)?.name??id}</option>)}</select></label>}
 {type==='company'&&demo.coveredCompanyIds.length>1&&<p>Other Demo Companies will be parked. Switching back to Pro Demo restores their access.</p>}
 <button disabled={busy||!changed||(type==='company'&&demo.coveredCompanyIds.length>0&&!selected)} onClick={()=>onApply(type,type==='company'&&demo.coveredCompanyIds.length>0?selected:null)}>Apply Demo choice</button>
 <p>Demo is free and does not publish data. Paid Company and Pro subscriptions will use a separate checkout.</p></section>;
}
