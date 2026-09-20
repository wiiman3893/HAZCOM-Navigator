import { useEffect, useState } from 'react';
import { getDashboardCounts, listCompanies, type DashboardCounts } from './data/database';

const nav = ['Management Home','Work Areas','Chemical Library','Workers','Assignments & Training','Reports & Export','Company & Access Administration'];

export default function App() {
  const [active, setActive] = useState('Management Home');
  const [companies, setCompanies] = useState<Array<{id:string;name:string;contact_email:string}>>([]);
  const [companyId, setCompanyId] = useState('');
  const [counts, setCounts] = useState<DashboardCounts>({companies:0,workAreas:0,chemicalProducts:0,workers:0,assignments:0});
  const [error, setError] = useState('');

  useEffect(() => {
    listCompanies().then(setCompanies).catch(e => setError(String(e)));
  }, []);
  useEffect(() => {
    getDashboardCounts(companyId || undefined).then(setCounts).catch(e => setError(String(e)));
  }, [companyId]);

  return <div className="shell">
    <aside>
      <div className="brand"><strong>HazCom Navigator</strong><span>Windows authoring</span></div>
      <label className="company-label">Active Company
        <select value={companyId} onChange={e=>setCompanyId(e.target.value)}>
          <option value="">Select Company</option>
          {companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <nav>{nav.map(item=><button key={item} className={active===item?'active':''} onClick={()=>setActive(item)}>{item}</button>)}</nav>
    </aside>
    <main>
      <header><div><h1>{active}</h1><p>{companyId ? 'Explicit Company context active.' : 'Choose a Company before Organization-scoped authoring.'}</p></div></header>
      {error && <div className="error">{error}</div>}
      {active==='Management Home' ? <section className="grid">
        <Metric label="Companies" value={counts.companies}/><Metric label="Work Areas" value={counts.workAreas}/><Metric label="Chemical Products" value={counts.chemicalProducts}/><Metric label="Workers" value={counts.workers}/><Metric label="Assignments" value={counts.assignments}/>
      </section> : <section className="panel"><h2>{active}</h2><p>The canonical route is wired. CRUD controls are added only as the matching repository/service boundary is implemented; no UI-only authorization shortcuts are used.</p></section>}
    </main>
  </div>;
}
function Metric({label,value}:{label:string;value:number}) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
