import {INITIAL_SCHEMA_SQL,DERIVED_VIEWS_SQL,RELATIONSHIP_IDS} from '@hazcom/core';
import {schemas,kinds,demand,normalizeDataset,day,stableId} from './contract.js';
export const REPLICA_SCHEMA_SQL=INITIAL_SCHEMA_SQL+'\n'+DERIVED_VIEWS_SQL+`
CREATE TABLE replica_state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
CREATE TABLE replica_guard (ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE replica_training_ledger (id TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE publication_journal (id TEXT PRIMARY KEY, value TEXT NOT NULL);
`;
const insert=(table,row)=>({statement:`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`,values:Object.values(row)});
export function recordStatements(company,dataset,attachments=[]) {
  const statements=[insert('company',company)];
  for(const [kind,s] of Object.entries(schemas)) for(const row of dataset[kind]) {
    const entity=Object.fromEntries(Object.entries(row).filter(([key])=>!Object.keys(s.refs??{}).includes(key) && !(kind==='trainingEvents'&&key==='workerId')));
    statements.push(insert(s.table,entity));
    statements.push(insert(`${s.table}__ownership`,{id:`ownership-${row.id}`,child_id:row.id,relationship_id:RELATIONSHIP_IDS[s.relation],[`${s.parent}_id`]:s.parent==='company'?company.id:row[s.parentField]}));
    if(s.link) statements.push(insert(s.link[1],{id:`link-${row.id}`,[s.link[2]]:row[s.link[0]],[`${s.table}_id`]:row.id}));
  }
  for(const a of attachments) statements.push(insert('dm_attachments',{id:a.attachmentId,owner_type:a.ownerType,owner_id:a.ownerId,slot_key:'sds',relative_path:a.localPath,original_filename:`${a.attachmentId}.pdf`,mime_type:'application/pdf',size_bytes:a.sizeBytes,created_at:'1970-01-01T00:00:00.000Z'}));
  return statements;
}
export const scopeKey=access=>JSON.stringify([access.uid,access.companyId,access.role,access.workerId??null]);
export function sqliteJournal(sql) { return {
  async get(key) {const rows=await sql.select('SELECT value FROM publication_journal WHERE id=?',[key]); return rows.length?JSON.parse(rows[0].value):null;},
  async put(key,value) {await sql.batch([{statement:'INSERT INTO publication_journal VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',values:[key,JSON.stringify(value)]}]);}
}; }
// The supplied batch implementation MUST execute all statements in one SQLite transaction.
export function sqliteReplica(sql) {
  const state=async()=>{const rows=await sql.select('SELECT value FROM replica_state WHERE id=1'); return rows.length?JSON.parse(rows[0].value):null;};
  const guard=previous=>({statement:'INSERT INTO replica_guard SELECT CASE WHEN COALESCE((SELECT value FROM replica_state WHERE id=1),?)=? THEN 1 ELSE 0 END',values:['null',JSON.stringify(previous)]});
  const ledger=async()=> (await sql.select('SELECT value FROM replica_training_ledger ORDER BY id')).map(r=>JSON.parse(r.value));
  function validateEvent(event,access) {
    stableId(event.id); stableId(event.assignmentId); stableId(event.workerId); stableId(event.revisionId); day(event.training_date);
    demand(access.role!=='member'||event.workerId===access.workerId,'Unauthorized Training Event');
  }
  const logical=e=>JSON.stringify([e.id,e.assignmentId,e.workerId,e.training_date]);
  return {
    state,
    async assertReadable(access) {const s=await state(); demand(s && s.scope===scopeKey(access),'Replica access scope changed; synchronize before reading'); return s;},
    async activate({previous,access,metadata,dataset,attachments}) {
      demand(!previous || (previous.uid===access.uid && previous.companyId===access.companyId),'Replica database belongs to another account or Company');
      const rows=normalizeDataset(dataset,{published:true});
      const oldEvents=previous?.scope===scopeKey(access)?await ledger():[];
      for(const event of oldEvents) {
        validateEvent(event,access);
        const assignment=rows.workAreaAssignments.find(a=>a.id===event.assignmentId);
        if(!assignment) continue; // Retain historical ledger; absent assignments cannot enter canonical tables.
        demand(assignment.workerId===event.workerId,'Training assignment changed Worker');
        const existing=rows.trainingEvents.find(e=>e.id===event.id);
        if(existing) demand(logical(existing)===logical(event),'Conflicting Training Event ID');
        else rows.trainingEvents.push({id:event.id,assignmentId:event.assignmentId,workerId:event.workerId,training_date:event.training_date});
      }
      const statements=[guard(previous)];
      if(previous?.scope!==scopeKey(access)) statements.push({statement:'DELETE FROM replica_training_ledger',values:[]});
      statements.push({statement:'DELETE FROM dm_attachments',values:[]});
      for(const s of Object.values(schemas).reverse()) {
        if(s.link) statements.push({statement:`DELETE FROM ${s.link[1]}`,values:[]});
        statements.push({statement:`DELETE FROM ${s.table}__ownership`,values:[]},{statement:`DELETE FROM ${s.table}`,values:[]});
      }
      statements.push({statement:'DELETE FROM company',values:[]},...recordStatements(metadata.company,rows,attachments));
      const next={uid:access.uid,companyId:access.companyId,scope:scopeKey(access),revisionId:metadata.revisionId,revisionNumber:metadata.revisionNumber,generation:(previous?.generation??0)+1};
      statements.push({statement:'INSERT INTO replica_state VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',values:[JSON.stringify(next)]},{statement:'DELETE FROM replica_guard',values:[]});
      await sql.batch(statements);
      return next;
    },
    async reconcile(access,events,previous) {
      demand(previous?.scope===scopeKey(access),'Synchronize revision before training');
      const existing=new Map((await ledger()).map(e=>[e.id,e]));
      const statements=[guard(previous)]; let added=0;
      for(const event of events) {
        validateEvent(event,access);
        if(existing.has(event.id)) { demand(logical(existing.get(event.id))===logical(event),'Conflicting Training Event ID'); continue; }
        const assignment=await sql.select('SELECT r.worker_id FROM work_area_assignment a JOIN rel_worker_work_area_assignment_d30ac2b9 r ON r.work_area_assignment_id=a.id WHERE a.id=?',[event.assignmentId]);
        const published=await sql.select('SELECT e.training_date,o.work_area_assignment_id FROM training_event e JOIN training_event__ownership o ON o.child_id=e.id WHERE e.id=?',[event.id]);
        if(published.length) demand(published[0].training_date===event.training_date && published[0].work_area_assignment_id===event.assignmentId,'Conflicting published Training Event');
        if(assignment.length) {
          demand(assignment[0].worker_id===event.workerId,'Training Worker mismatch');
          if(!published.length) {
            statements.push(insert('training_event',{id:event.id,training_date:event.training_date}),insert('training_event__ownership',{id:`ownership-${event.id}`,child_id:event.id,relationship_id:RELATIONSHIP_IDS.assignmentTrainingEvent,work_area_assignment_id:event.assignmentId}));
          }
        }
        statements.push(insert('replica_training_ledger',{id:event.id,value:JSON.stringify(event)})); existing.set(event.id,event); added++;
      }
      statements.push({statement:'UPDATE replica_state SET value=? WHERE id=1',values:[JSON.stringify({...previous,generation:previous.generation+1})]},{statement:'DELETE FROM replica_guard',values:[]});
      await sql.batch(statements); return {added};
    }
  };
}
