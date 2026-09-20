import { useEffect, useState } from 'react';
import { localCompanySummary } from './data/database';

export default function App() {
  const [summary,setSummary]=useState({companies:0,workAreas:0,chemicals:0});
  const [error,setError]=useState('');
  useEffect(()=>{ localCompanySummary().then(setSummary).catch(e=>setError(String(e))); },[]);
  return <main className="mobile-shell">
    <header><span className="eyebrow">HazCom Navigator</span><h1>Worker Home</h1><p>Offline published replica</p></header>
    {error && <div className="error">{error}</div>}
    <section className="cards">
      <button><strong>My Assignments & Training</strong><span>View required/current training</span></button>
      <button><strong>Browse Work Areas</strong><span>{summary.workAreas} available locally</span></button>
      <button><strong>Chemical Library</strong><span>{summary.chemicals} products available locally</span></button>
    </section>
    <footer>{summary.companies ? 'Published Company data is available offline.' : 'No published Company revision has been synchronized yet.'}</footer>
  </main>;
}
