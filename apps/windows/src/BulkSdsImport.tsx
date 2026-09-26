import {useEffect,useMemo,useState} from 'react';
import {MAX_SDS_BATCH_BYTES} from '@hazcom/authoring';

type Props={
 service:any;
 data:any;
 busy:boolean;
 run:(fn:()=>Promise<any>,message?:string)=>Promise<void>;
 onBack:()=>void;
};

const boundaryLabel=(confidence:string)=>confidence==='likely'?'Likely boundary':confidence==='manual'?'Manual boundary':'Boundary uncertain';
const snippet=(value:string)=>{const text=String(value??'').replace(/\s+/g,' ').trim();return text?text.slice(0,220):'No embedded text extracted.';};

export default function BulkSdsImport({service,data,busy,run,onBack}:Props){
 const [selectedId,setSelectedId]=useState<string|null>(null);
 const [splitPages,setSplitPages]=useState<Record<string,string>>({});
 const [preview,setPreview]=useState<string|null>(null);
 const sessions=data.sds_import_session??[];
 const selected=useMemo(()=>sessions.find((s:any)=>s.id===selectedId)??sessions[0]??null,[sessions,selectedId]);
 const drafts=selected?(data.sds_import_draft??[]).filter((d:any)=>d.session_id===selected.id).sort((a:any,b:any)=>a.ordinal-b.ordinal):[];
 const pages=selected?(data.sds_import_page??[]).filter((p:any)=>p.session_id===selected.id).sort((a:any,b:any)=>a.page_number-b.page_number):[];
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
 useEffect(()=>{if(!selectedId&&sessions[0])setSelectedId(sessions[0].id);},[selectedId,sessions]);
 const showPdf=async(read:()=>Promise<Uint8Array>)=>{
  const bytes=await read();
  if(preview)URL.revokeObjectURL(preview);
  setPreview(URL.createObjectURL(new Blob([bytes],{type:'application/pdf'})));
 };
 const runSplit=(draft:any)=>run(async()=>{
  const value=Number(splitPages[draft.id]??draft.start_page+1);
  await service.splitImportDraft(selected.id,draft.id,value);
  setSplitPages(current=>({...current,[draft.id]:''}));
 },'SDS draft split saved.');
 const importFile=(file:File)=>run(async()=>{
  if(file.size>MAX_SDS_BATCH_BYTES)throw Error('Choose a PDF no larger than 250 MiB');
  const id=await service.importSdsBatch(new Uint8Array(await file.arrayBuffer()),file.name);
  setSelectedId(id);setPreview(null);
 },'SDS batch imported. Review the proposed boundaries before saving drafts.');
 return <section className="panel bulk-sds">
  <div className="bulk-sds-heading">
   <div><h2>Import SDS Batch</h2><p>Import one multi-page PDF, review proposed document boundaries, then save separate review drafts. Chemical Products are not created at this stage.</p></div>
   <button disabled={busy} onClick={onBack}>Back to Chemical Library</button>
  </div>
  <label className="batch-file">Select batch PDF
   <input type="file" accept="application/pdf,.pdf" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value='';if(file)void importFile(file);}}/>
  </label>
  <p><small>The original PDF is copied into managed local storage unchanged. Maximum batch size: 250 MiB.</small></p>
  {sessions.length>0&&<div className="batch-session-list"><h3>Import sessions</h3>{sessions.map((session:any)=><button key={session.id} className={selected?.id===session.id?'active':''} onClick={()=>{setSelectedId(session.id);setPreview(null);}}>{session.source_filename} · {session.page_count} pages · {session.status==='reviewed'?'Review saved':'Needs review'}</button>)}</div>}
  {!selected&&<p>No SDS batches have been imported for this Company.</p>}
  {selected&&<>
   <div className="batch-summary">
    <h3>SDS Batch — {selected.page_count} pages</h3>
    <p>{selected.source_filename} · {selected.source_size_bytes} bytes · SHA-256 <code>{selected.source_sha256}</code></p>
    <p>Imported {selected.imported_at.replace('T',' ').slice(0,19)} · {selected.status==='reviewed'?'Review drafts saved':'Review in progress'}</p>
    <p>{pages.filter((p:any)=>p.text_status==='ocr_required').length} page(s) marked <strong>OCR REQUIRED</strong>.</p>
    <button disabled={busy} onClick={()=>void showPdf(()=>service.readImportSource(selected.id))}>View source PDF</button>
   </div>
   <div className="candidate-list">
    {drafts.map((draft:any,index:number)=>{
     const candidatePages=pages.filter((p:any)=>p.page_number>=draft.start_page&&p.page_number<=draft.end_page);
     const startPage=candidatePages[0];
     const ocrCount=candidatePages.filter((p:any)=>p.text_status==='ocr_required').length;
     const canEdit=selected.status==='review'&&!busy;
     return <article className="candidate-card" key={draft.id}>
      <div className="candidate-title"><div><h4>Candidate {draft.ordinal}</h4><strong>Pages {draft.start_page}–{draft.end_page}</strong></div><span className={`badge ${draft.confidence==='likely'?'current':'required'}`}>{boundaryLabel(draft.confidence)}</span></div>
      <p className="candidate-product">{draft.detected_title||'Unknown product'}</p>
      <p>{draft.reason}</p>
      {ocrCount>0&&<p><strong>OCR REQUIRED</strong> on {ocrCount} page(s); manual splitting remains available.</p>}
      <p className="page-snippet"><small>Start-page text: {snippet(startPage?.extracted_text)}</small></p>
      {selected.status==='review'&&<div className="candidate-actions">
       <label>Split before page
        <input aria-label={`Split page candidate ${draft.ordinal}`} type="number" min={draft.start_page+1} max={draft.end_page} value={splitPages[draft.id]??String(Math.min(draft.end_page,draft.start_page+1))} disabled={!canEdit||draft.start_page===draft.end_page} onChange={e=>setSplitPages({...splitPages,[draft.id]:e.target.value})}/>
       </label>
       <button disabled={!canEdit||draft.start_page===draft.end_page} onClick={()=>void runSplit(draft)}>Split Here</button>
       <button disabled={!canEdit||index===0} onClick={()=>void run(()=>service.mergeImportDraft(selected.id,draft.id,'previous'),'SDS drafts merged.')}>Merge With Previous</button>
       <button disabled={!canEdit||index===drafts.length-1} onClick={()=>void run(()=>service.mergeImportDraft(selected.id,draft.id,'next'),'SDS drafts merged.')}>Merge With Next</button>
      </div>}
      {selected.status==='reviewed'&&<><p><small>Materialized draft: {draft.child_size_bytes} bytes · SHA-256 {draft.child_sha256}</small></p><button disabled={busy} onClick={()=>void showPdf(()=>service.readImportDraft(selected.id,draft.id))}>View draft PDF</button></>}
     </article>;
    })}
   </div>
   {selected.status==='review'&&<div className="actions"><button disabled={busy||drafts.length===0} onClick={()=>void run(()=>service.saveImportReview(selected.id),'Review drafts saved and materialized as separate managed PDFs.')}>Save review drafts</button></div>}
  </>}
  {preview&&<iframe title="SDS batch PDF preview" src={preview} className="pdf-preview"/>}
 </section>;
}
