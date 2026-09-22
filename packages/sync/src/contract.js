// Mirrors the deployed foundation wire contract. Compatibility is executable in tests.
export const schemas = {
  workAreas: { table:'work_area', fields:['name','location','poc_name','poc_email','poc_phone_number','description'], parent:'company', relation:'companyWorkArea' },
  chemicalProducts: { table:'chemical_product', fields:['product_name','manufacturer','sds_date'], optional:['chemical_names','cas_numbers'], dates:['sds_date'], parent:'company', relation:'companyChemicalProduct' },
  workers: { table:'worker', fields:['name'], optional:['email','phone'], parent:'company', relation:'companyWorker' },
  workAreaProducts: { table:'work_area_product', fields:['quantity','storage_location','added_date','workAreaId','chemicalProductId'], dates:['added_date'], refs:{workAreaId:'workAreas',chemicalProductId:'chemicalProducts'}, parent:'work_area', parentField:'workAreaId', relation:'workAreaWorkAreaProduct', link:['chemicalProductId','rel_chemical_product_work_area_product_9d42d6cd','chemical_product_id'] },
  workAreaAssignments: { table:'work_area_assignment', fields:['assigned_date','training_required_since','workAreaId','workerId'], optional:['ended_date'], dates:['assigned_date','training_required_since','ended_date'], refs:{workAreaId:'workAreas',workerId:'workers'}, parent:'work_area', parentField:'workAreaId', relation:'workAreaAssignment', link:['workerId','rel_worker_work_area_assignment_d30ac2b9','worker_id'] },
  sdsVerifications: { table:'sds_verification', fields:['verified_at','chemicalProductId'], dates:['verified_at'], refs:{chemicalProductId:'chemicalProducts'}, parent:'chemical_product', parentField:'chemicalProductId', relation:'chemicalProductSdsVerification' },
  hazcomReviews: { table:'hazcom_review', fields:['review_date','workAreaId'], dates:['review_date'], refs:{workAreaId:'workAreas'}, parent:'work_area', parentField:'workAreaId', relation:'workAreaHazcomReview' },
  trainingEvents: { table:'training_event', fields:['training_date','assignmentId'], dates:['training_date'], refs:{assignmentId:'workAreaAssignments'}, parent:'work_area_assignment', parentField:'assignmentId', relation:'assignmentTrainingEvent' },
};
export const kinds = Object.keys(schemas);
export const limits = Object.freeze({records:350,jsonBytes:3_000_000,attachments:100,pdfBytes:5*1024*1024});
export function demand(condition,message) { if (!condition) throw new Error(message); }
export function stableId(value) { demand(typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value),'Unsafe stable ID'); return value; }
export function day(value) {
  demand(typeof value==='string','Invalid date');
  // Date-only values remain dates; timestamps require an explicit zone, normalized to UTC.
  demand(/^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value),'Ambiguous date');
  const prefix=value.slice(0,10);
  demand(Number.isFinite(Date.parse(value)) && new Date(prefix).toISOString().slice(0,10)===prefix,'Invalid calendar date');
  return new Date(value).toISOString().slice(0,10);
}
export const compareId=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
export const jsonBytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
export async function sha256(bytes) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
export const digest=value=>sha256(new TextEncoder().encode(JSON.stringify(value)));
export function normalizeDataset(input, {published=false}={}) {
  demand(input && typeof input==='object' && !Array.isArray(input),'Invalid dataset');
  demand(Object.keys(input).every(k=>kinds.includes(k)),'Unknown dataset kind');
  const output={};
  for (const [kind,s] of Object.entries(schemas)) {
    demand(Array.isArray(input[kind]??[]),`Invalid ${kind}`);
    const seen=new Set();
    output[kind]=(input[kind]??[]).map(raw=>{
      demand(raw && Object.keys(raw).every(k=>['id',...s.fields,...s.optional??[],...(published&&kind==='trainingEvents'?['workerId']:[])].includes(k)),`Unexpected ${kind} field`);
      const id=stableId(raw.id); demand(!seen.has(id),`Duplicate ${kind} ID`); seen.add(id);
      const row={id};
      for (const field of [...s.fields,...s.optional??[]]) {
        const value=raw[field];
        if(value==null && s.optional?.includes(field)) row[field]=null;
        else if(s.refs?.[field]) row[field]=stableId(value);
        else if(s.dates?.includes(field)) row[field]=day(value);
        else { demand(typeof value==='string' && value.length<=(field==='description'?8000:1000),`Invalid ${kind}.${field}`); row[field]=value; }
      }
      if(kind==='workAreaAssignments') demand(!row.ended_date || row.ended_date>=row.assigned_date,'Assignment ends before start');
      return row;
    }).sort(compareId);
  }
  const maps=Object.fromEntries(kinds.map(k=>[k,new Map(output[k].map(r=>[r.id,r]))]));
  for (const [kind,s] of Object.entries(schemas)) for (const row of output[kind]) {
    for(const [field,target] of Object.entries(s.refs??{})) demand(maps[target].has(row[field]),`Broken ${kind}.${field} reference: ${row.id}`);
    if(published && kind==='trainingEvents') {
      row.workerId=maps.workAreaAssignments.get(row.assignmentId).workerId;
      demand(input.trainingEvents.find(r=>r.id===row.id).workerId===row.workerId,'Training Worker mismatch');
    }
  }
  return output;
}
export function serverRows(dataset) {
  const rows=normalizeDataset(dataset);
  const assignments=new Map(rows.workAreaAssignments.map(r=>[r.id,r]));
  for(const event of rows.trainingEvents) event.workerId=assignments.get(event.assignmentId).workerId;
  return rows;
}
export function capacity(dataset,attachments) {
  const counts=Object.fromEntries(kinds.map(k=>[k,dataset[k].length]));
  const records=Object.values(counts).reduce((a,b)=>a+b,0), bytes=jsonBytes(dataset);
  let running=0, firstRecordLimitKind=null;
  for(const kind of kinds) { running+=counts[kind]; if(running>limits.records && !firstRecordLimitKind) firstRecordLimitKind=kind; }
  const violations=[];
  if(bytes>limits.jsonBytes) violations.push(`JSON ${bytes} > ${limits.jsonBytes}`);
  if(records>limits.records) violations.push(`Records ${records} > ${limits.records}; first at ${firstRecordLimitKind}`);
  if(attachments.length>limits.attachments) violations.push(`Attachments ${attachments.length} > ${limits.attachments}`);
  for(const a of attachments) if(a.sizeBytes>limits.pdfBytes) violations.push(`PDF ${a.attachmentId}: ${a.sizeBytes} > ${limits.pdfBytes}`);
  return {counts,records,jsonBytes:bytes,attachments:attachments.length,firstRecordLimitKind,violations};
}
export function pdf(bytes) { demand(bytes.length>0 && bytes.length<=limits.pdfBytes,'SDS size exceeds 5 MiB or empty'); demand(new TextDecoder().decode(bytes.slice(0,5))==='%PDF-','Invalid PDF signature'); }
export function attachmentPath(companyId,revisionId,a) { return `companies/${stableId(companyId)}/revisions/${stableId(revisionId)}/sds/${stableId(a.attachmentId)}/${a.sha256}.pdf`; }
