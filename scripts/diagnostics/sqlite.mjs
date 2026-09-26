import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFile, readdir, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {authoringService, summary as authoringSummary} from '@hazcom/authoring';
import {buildPublication, publicationPlan, SNAPSHOT_SQL, normalizeDataset, schemas} from '@hazcom/sync';
import {safeError} from './redact.mjs';

const tables = ['work_area','chemical_product','worker','work_area_product','work_area_assignment','sds_verification','hazcom_review','training_event'];
const currentSdsSql = `SELECT a.id AS attachmentId,a.owner_id AS ownerId,a.relative_path AS relativePath,
 a.size_bytes AS expectedSize,i.sha256 AS expectedSha256
 FROM dm_attachments a JOIN chemical_product__ownership o ON o.child_id=a.owner_id
 JOIN chemical_product p ON p.id=a.owner_id
 LEFT JOIN authoring_sds_integrity i ON i.attachment_id=a.id
 WHERE o.company_id=? AND p.deleted_at IS NULL AND a.owner_type='chemical_product' AND a.slot_key='sds'
 ORDER BY a.id`;

function scopedCount(db,table,companyId,trash) {
  const schema=Object.values(schemas).find(item=>item.table===table);
  if(!schema)throw Error('Unknown entity table');
  const parent=schema.parent,owner=`${table}__ownership`;
  let joins=`JOIN ${owner} o ON o.child_id=e.id`,scope='o.company_id=?';
  if(parent==='work_area'||parent==='chemical_product'){
    joins+=` JOIN ${parent}__ownership p ON p.child_id=o.${parent}_id`;scope='p.company_id=?';
  } else if(parent==='work_area_assignment'){
    joins+=' JOIN work_area_assignment__ownership a ON a.child_id=o.work_area_assignment_id JOIN work_area__ownership p ON p.child_id=a.work_area_id';
    scope='p.company_id=?';
  }
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table} e ${joins} WHERE ${scope} AND e.deleted_at IS ${trash?'NOT ':''}NULL`).get(companyId).count;
}

export function openReadOnlySqlite(filename) {
  const db = new DatabaseSync(filename, {readOnly:true});
  db.exec('PRAGMA query_only=ON');
  return db;
}

function adapter(db) {
  return {select:async(sql, values=[]) => sql.includes('$1')
    ? db.prepare(sql).all({'$1':values[0]})
    : db.prepare(sql).all(...values)};
}

function journalRows(filename) {
  let db;
  try {
    db=openReadOnlySqlite(filename);
    const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publication_journal'").get();
    if(!exists) return {status:'UNAVAILABLE',reason:'Publication journal table is absent',rows:[]};
    return {status:'PASS',rows:db.prepare('SELECT id,value FROM publication_journal ORDER BY id').all()};
  } catch(error) {return {status:'UNAVAILABLE',reason:safeError(error),rows:[]};}
  finally {db?.close();}
}

export function collectPublicationJournal(filename, companyId) {
  const found=journalRows(filename);
  if(found.status!=='PASS') return {status:found.status,reason:found.reason,attempt:null,publishedLocal:null,pendingAttemptIds:[]};
  const items=found.rows.filter(row=>companyId && row.id.endsWith('/'+companyId));
  const identities=[...new Set(items.map(row=>row.id.split('/')[0]).filter(Boolean))];
  const value=(prefix)=>{
    const row=items.find(item=>item.id.includes('/'+prefix+'/'+companyId));
    if(!row)return null;
    try{return JSON.parse(row.value);}catch{return {invalidJson:true};}
  };
  const attempt=value('ui-attempt'),publishedLocal=value('ui-published');
  const pendingAttemptIds=[];
  for(const row of items) {
    try {const parsed=JSON.parse(row.value);if(parsed?.status==='pending'&&parsed.revisionId)pendingAttemptIds.push(parsed.revisionId);}
    catch { /* Report the malformed primary entry above. */ }
  }
  return {
    status:attempt?.invalidJson||publishedLocal?.invalidJson?'WARN':'PASS',
    accountIdHint:identities.length===1?identities[0]:null,
    attempt:attempt?{revisionId:attempt.revisionId??null,parentRevisionId:attempt.parentRevisionId??null,fingerprint:attempt.fingerprint??null,status:attempt.status??null,invalidJson:attempt.invalidJson??false}:null,
    publishedLocal:publishedLocal?{revisionId:publishedLocal.revisionId??null,revisionNumber:publishedLocal.revisionNumber??null,publishedAt:publishedLocal.publishedAt??null,recordCounts:publishedLocal.recordCounts??null,attachmentCount:publishedLocal.attachmentCount??null,fingerprint:publishedLocal.fingerprint??null,contentHash:publishedLocal.contentHash??null,invalidJson:publishedLocal.invalidJson??false}:null,
    pendingAttemptIds:[...new Set(pendingAttemptIds)].sort(),
  };
}

async function inspectSds(rows, attachmentRoot) {
  let resolvedRoot;
  try {resolvedRoot=await realpath(attachmentRoot);} catch {resolvedRoot=null;}
  const files=[];
  for(const row of rows) {
    const item={attachmentId:row.attachmentId,chemicalProductId:row.ownerId,relativePath:row.relativePath,
      expectedSize:row.expectedSize,actualSize:null,expectedSha256:row.expectedSha256,actualSha256:null,status:'UNAVAILABLE'};
    const relative=String(row.relativePath??'');
    if(!relative || path.isAbsolute(relative) || relative.includes(':') || relative.split(/[\\/]/).includes('..')) {
      item.status='FAIL';item.reason='Unsafe managed SDS path';files.push(item);continue;
    }
    if(!resolvedRoot) {item.reason='Managed attachment directory unavailable';files.push(item);continue;}
    try {
      const absolute=await realpath(path.resolve(resolvedRoot,relative));
      if(!absolute.startsWith(resolvedRoot+path.sep)) throw Error('SDS path escapes managed attachment directory');
      const metadata=await stat(absolute);item.actualSize=metadata.size;
      if(metadata.size>5*1024*1024){item.status='FAIL';item.reason='SDS exceeds 5 MiB';files.push(item);continue;}
      const bytes=await readFile(absolute);item.actualSha256=createHash('sha256').update(bytes).digest('hex');
      item.status=metadata.size!==Number(row.expectedSize)||!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||
        (row.expectedSha256 && item.actualSha256!==row.expectedSha256)?'FAIL':row.expectedSha256?'PASS':'WARN';
      if(item.status!=='PASS')item.reason=item.status==='WARN'?'Expected SDS hash unavailable':'SDS size, PDF signature, or SHA-256 mismatch';
    } catch(error) {item.status='FAIL';item.reason=error?.code==='ENOENT'?'SDS file missing':safeError(error);}
    files.push(item);
  }
  return {status:files.some(f=>f.status==='FAIL')?'FAIL':files.some(f=>f.status==='WARN')?'WARN':'PASS',expectedCount:rows.length,
    presentCount:files.filter(f=>f.actualSize!==null).length,missingCount:files.filter(f=>f.reason==='SDS file missing').length,
    mismatchCount:files.filter(f=>f.status==='FAIL'&&f.reason!=='SDS file missing').length,files};
}

function companySelection(db, explicitCompanyId, journalFile) {
  const companies=db.prepare('SELECT id FROM company WHERE deleted_at IS NULL ORDER BY id').all().map(row=>row.id);
  if(explicitCompanyId)return {companyId:companies.includes(explicitCompanyId)?explicitCompanyId:null,source:'explicit',availableCompanyIds:companies};
  if(companies.length===1)return {companyId:companies[0],source:'single-local-company',availableCompanyIds:companies};
  const journal=journalRows(journalFile);
  const candidates=journal.rows?.filter(row=>row.id.includes('/ui-published/')).map(row=>{
    try {const value=JSON.parse(row.value);return {companyId:row.id.split('/').at(-1),revisionNumber:Number(value.revisionNumber)||0};}
    catch{return null;}
  }).filter(row=>row&&companies.includes(row.companyId)).sort((a,b)=>b.revisionNumber-a.revisionNumber)??[];
  if(candidates.length && (candidates.length===1||candidates[0].revisionNumber>candidates[1].revisionNumber))
    return {companyId:candidates[0].companyId,source:'latest-local-publication-receipt-inferred',availableCompanyIds:companies};
  return {companyId:null,source:companies.length?'ambiguous':'none',availableCompanyIds:companies};
}

export async function collectSqlite({databaseFile,journalFile,attachmentRoot,companyId:requestedCompanyId,sourceMigrationDir=null}) {
  let db;
  try {db=openReadOnlySqlite(databaseFile);} catch(error) {
    return {sqlite:{status:'UNAVAILABLE',databaseLocation:'<appdata>/hazcom-navigator.db',reason:safeError(error)},
      sds:{status:'UNAVAILABLE',reason:'SQLite database unavailable'},authoring:{status:'UNAVAILABLE'},publication:{status:'UNAVAILABLE'}};
  }
  try {
    const integrity=db.prepare('PRAGMA integrity_check').all().map(row=>Object.values(row)[0]);
    const foreignKeys=db.prepare('PRAGMA foreign_key_check').all().slice(0,20);
    const knownTables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    const migrations=knownTables.has('_sqlx_migrations')?db.prepare('SELECT version,description,success FROM _sqlx_migrations ORDER BY version').all():[];
    const selected=companySelection(db,requestedCompanyId,journalFile);
    const sourceMigrations=sourceMigrationDir?(await readdir(sourceMigrationDir).catch(()=>[])).map(name=>Number(name.match(/^(\d+)_.*\.sql$/)?.[1])).filter(Number.isInteger):[];
    const expectedSourceSchemaVersion=sourceMigrations.length?Math.max(...sourceMigrations):null;
    const schemaVersion=migrations.at(-1)?.version??(knownTables.has('sds_import_session')?4:knownTables.has('authoring_sds_integrity')?3:knownTables.has('dm_attachments')?1:null);
    const sqlite={status:integrity.length===1&&integrity[0]==='ok'&&foreignKeys.length===0?'PASS':'FAIL',
      databaseLocation:'<appdata>/hazcom-navigator.db',integrityCheck:integrity.slice(0,10),foreignKeyViolations:foreignKeys,
      userVersion:db.prepare('PRAGMA user_version').get().user_version,migrations,
      schemaVersion,expectedSourceSchemaVersion,migrationPending:expectedSourceSchemaVersion!==null&&schemaVersion!==null&&schemaVersion<expectedSourceSchemaVersion,
      schemaVersionSource:migrations.length?'Tauri migration ledger':'table-presence inference',companySelection:selected,
      counts:null,trashCounts:null,sdsImportSessions:null,sdsImportSessionStates:null,duplicateStableIds:[],duplicateStableIdsSource:'SQLite primary keys and existing dataset normalizer',orphanActiveCount:null};
    if(sqlite.status==='PASS'&&sqlite.migrationPending)sqlite.status='WARN';
    if(!selected.companyId)return {sqlite,sds:{status:'UNVERIFIED',reason:'Select a Company with --company <id>'},
      authoring:{status:'UNVERIFIED',reason:'Company context ambiguous'},publication:{status:'UNVERIFIED',reason:'Company context ambiguous'}};
    const companyId=selected.companyId,sql=adapter(db);
    if(knownTables.has('sds_import_session')) {
      sqlite.sdsImportSessions=db.prepare('SELECT COUNT(*) AS count FROM sds_import_session WHERE company_id=?').get(companyId).count;
      try {
        sqlite.sdsImportSessionStates=Object.fromEntries(db.prepare('SELECT status,COUNT(*) AS count FROM sds_import_session WHERE company_id=? GROUP BY status ORDER BY status').all(companyId).map(row=>[row.status,row.count]));
      } catch(error) {
        sqlite.sdsImportSessionStates={status:'UNAVAILABLE',reason:safeError(error)};
      }
    }
    const local=authoringService({sql,companyId,authorize:async()=>({companyId,active:true,role:'manager'}),files:{}});
    let snapshot,authoring;
    try {
      snapshot=await local.snapshot();
      sqlite.counts=Object.fromEntries(tables.map(table=>[table,snapshot[table].filter(row=>!row.deleted_at).length]));
      sqlite.trashCounts=Object.fromEntries(tables.map(table=>[table,snapshot[table].filter(row=>!!row.deleted_at).length]));
      authoring={status:'PASS',source:'local deterministic authoring service; no live role check',summary:authoringSummary(snapshot),
        historyCountSampled:snapshot.activity.length,relationshipValidation:'UNVERIFIED'};
    } catch(error) {
      const pendingTable=sqlite.migrationPending&&/no such table: sds_import_session/i.test(String(error));
      authoring={status:pendingTable?'WARN':'FAIL',source:'local deterministic authoring service',reason:safeError(error),
        relationshipValidation:'UNVERIFIED',summary:null};
      if(pendingTable){
        sqlite.counts=Object.fromEntries(tables.map(table=>[table,scopedCount(db,table,companyId,false)]));
        sqlite.trashCounts=Object.fromEntries(tables.map(table=>[table,scopedCount(db,table,companyId,true)]));
        authoring.reason='Migration 4 has not run locally; authoring summary requiring Bulk SDS Import tables is unavailable.';
      }
    }
    try {
      const scoped=JSON.parse((await sql.select(SNAPSHOT_SQL,[companyId]))[0].snapshot);
      sqlite.orphanActiveCount=scoped.orphans;
      if(scoped.orphans||scoped.foreignKeyErrors)throw Error(`Active unowned records: ${scoped.orphans}; source foreign-key errors: ${scoped.foreignKeyErrors}`);
      normalizeDataset(scoped.dataset);
      if(authoring.status==='PASS'||authoring.status==='WARN')authoring.relationshipValidation='PASS: existing publication dataset normalizer';
    } catch(error) {authoring.status='FAIL';authoring.relationshipValidation=safeError(error);}
    const sdsRows=knownTables.has('authoring_sds_integrity')?db.prepare(currentSdsSql).all(companyId):[];
    const sds=knownTables.has('authoring_sds_integrity')?await inspectSds(sdsRows,attachmentRoot):{status:'UNAVAILABLE',reason:'SDS integrity migration absent'};
    const journal=collectPublicationJournal(journalFile,companyId);
    const publication={status:'UNVERIFIED',journal,localFingerprint:null,localContentHash:null,localChanges:null,
      currentCloudRevisionId:null,readiness:null,metrics:null};
    if(sds.status!=='FAIL') {
      try {
        const projection=await buildPublication(sql,companyId,{read:async relative=>{
          const absolute=await realpath(path.resolve(attachmentRoot,relative));
          const root=await realpath(attachmentRoot);
          if(!absolute.startsWith(root+path.sep))throw Error('Unsafe managed SDS path');
          return new Uint8Array(await readFile(absolute));
        }});
        const plan=await publicationPlan(projection,'diagnostic-revision',null,'diagnostic-creator');
        publication.localFingerprint=projection.fingerprint;publication.localContentHash=plan.manifest.contentHash;
        publication.metrics={records:projection.metrics.records,attachments:projection.metrics.attachments,jsonBytes:projection.metrics.jsonBytes};
        publication.localChanges=journal.publishedLocal?.contentHash?journal.publishedLocal.contentHash!==publication.localContentHash:
          journal.publishedLocal?.fingerprint?journal.publishedLocal.fingerprint!==projection.fingerprint:null;
        publication.readiness={status:'PASS',source:'local publication projection only; cloud role/coverage not checked',issues:[]};
        publication.status=journal.attempt?.status==='pending'?'WARN':'PASS';
        if(authoring.status==='PASS')authoring.relationshipValidation='PASS: publication dataset and SDS projection';
      } catch(error) {
        publication.status='FAIL';publication.readiness={status:'FAIL',source:'local publication projection',issues:[safeError(error)]};
        if(authoring.status==='PASS'){authoring.status='FAIL';authoring.relationshipValidation=safeError(error);}
      }
    } else publication.readiness={status:'FAIL',source:'local SDS verification',issues:['One or more SDS files failed integrity checks']};
    return {sqlite,sds,authoring,publication};
  } catch(error) {
    return {sqlite:{status:'FAIL',databaseLocation:'<appdata>/hazcom-navigator.db',reason:safeError(error)},
      sds:{status:'UNAVAILABLE'},authoring:{status:'UNAVAILABLE'},publication:{status:'UNAVAILABLE'}};
  } finally {db.close();}
}
