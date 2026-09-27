import {readdir,readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {openReadOnlySqlite,collectSqlite} from './sqlite.mjs';
import {safeError} from './redact.mjs';
const valid=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Inventory only. Registry rows are remembered preferences, not live authorization
 * or proof of the in-memory active session. Never repair/migrate/open writable. */
export async function collectWorkspaces({appDataRoot,sourceMigrationDir}){
 const result={status:'PASS',activeWorkspaceId:null,activeWorkspaceSource:'UNVERIFIED: in-memory native session is not read by diagnostics',rememberedSelections:[],restoredCount:0,availableRestoredCount:0,workspaces:[]};
 let registry;
 try{
  registry=openReadOnlySqlite(path.join(appDataRoot,'workspace-registry.db'));
  result.rememberedSelections=registry.prepare('SELECT account_id,company_id,workspace_id FROM selections ORDER BY account_id,company_id').all().map(row=>({accountId:row.account_id,companyId:row.company_id,workspaceId:row.workspace_id,identityValid:valid(row.account_id)&&valid(row.company_id)&&(row.workspace_id==='primary'||valid(row.workspace_id)&&row.workspace_id.startsWith('restored-'))}));
 }catch(error){result.registry={status:'UNAVAILABLE',reason:safeError(error)};}
 finally{registry?.close();}
 const root=path.join(appDataRoot,'restored-workspaces');
 let directories;
 try{directories=await readdir(root,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return result;return {...result,status:'WARN',reason:safeError(error)};}
 const canonicalRoot=await realpath(root);
 for(const directory of directories){
  if(!directory.isDirectory()||!valid(directory.name))continue;
  const id=directory.name,entry={workspaceId:`restored-${id}`,kind:'restored',status:'FAIL',companyId:null,authoringEligibility:'UNVERIFIED: requires live Membership and coverage',publication:{enabled:false,reason:'RESTORED_PUBLICATION_ACCEPTANCE_PENDING'}};
  result.restoredCount++;
  try{
   const expected=path.join(canonicalRoot,id,'active'),active=await realpath(path.join(root,id,'active'));
   if(active!==expected)throw Error('WORKSPACE_PATH_ALIAS');
   for(const name of ['workspace.db','restore-manifest.json','restore-files.json','attachments'])if(await realpath(path.join(active,name))!==path.join(active,name))throw Error('WORKSPACE_PATH_ALIAS');
   const manifest=JSON.parse(await readFile(path.join(active,'restore-manifest.json'),'utf8'));
   const descriptors=JSON.parse(await readFile(path.join(active,'restore-files.json'),'utf8'));
   if(manifest.format!=='hazcom-company-backup'||![1,2].includes(manifest.version)||!valid(manifest.companyId)||manifest.schemaVersion!==3||!Array.isArray(descriptors)||descriptors.length!==manifest.attachmentCount)throw Error('RESTORE_MANIFEST_INVALID');
   const sorted=descriptors.map(({attachmentId,ownerId,sizeBytes,sha256})=>({attachmentId,ownerId,sizeBytes,sha256})).sort((a,b)=>a.attachmentId.localeCompare(b.attachmentId));
   if(manifest.version===2&&hash(JSON.stringify(sorted))!==manifest.attachmentHash)throw Error('RESTORE_MANIFEST_HASH_MISMATCH');
   entry.companyId=manifest.companyId;
   const local=await collectSqlite({databaseFile:path.join(active,'workspace.db'),journalFile:path.join(active,'publication-journal.db'),attachmentRoot:path.join(active,'attachments'),companyId:manifest.companyId,sourceMigrationDir});
   // Validate historical SDS too: current-SDS readiness alone is insufficient for activation.
   let database;
   try{
    database=openReadOnlySqlite(path.join(active,'workspace.db'));
    const companies=database.prepare('SELECT id FROM company').all();
    if(companies.length!==1||companies[0].id!==manifest.companyId)throw Error('WORKSPACE_COMPANY_MISMATCH');
    const rows=database.prepare('SELECT a.*,i.sha256,o.company_id FROM dm_attachments a LEFT JOIN authoring_sds_integrity i ON i.attachment_id=a.id LEFT JOIN chemical_product__ownership o ON o.child_id=a.owner_id').all();
    if(sorted.some(d=>!rows.some(row=>row.id===d.attachmentId&&row.owner_id===d.ownerId&&row.size_bytes===d.sizeBytes)))throw Error('RESTORE_BASELINE_SDS_MISSING');
    for(const row of rows){
     if(row.owner_type!=='chemical_product'||row.company_id!==manifest.companyId||row.relative_path!==`${manifest.companyId}/${row.id}.pdf`)throw Error('WORKSPACE_SDS_OWNERSHIP_INVALID');
     const expectedPath=path.join(active,'attachments',manifest.companyId,`${row.id}.pdf`),actualPath=await realpath(expectedPath);
     if(actualPath!==expectedPath)throw Error('WORKSPACE_SDS_PATH_ALIAS');
     const bytes=await readFile(actualPath),baseline=sorted.find(d=>d.attachmentId===row.id);
     if(bytes.length!==row.size_bytes||!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||hash(bytes)!==(row.sha256??baseline?.sha256)||baseline&&hash(bytes)!==baseline.sha256)throw Error('WORKSPACE_SDS_INTEGRITY_INVALID');
    }
    entry.verifiedSds=rows.length;
   }finally{database?.close();}
   entry.schemaVersion=local.sqlite.schemaVersion;entry.databaseIntegrity=local.sqlite.status;entry.restoreManifestIntegrity='PASS';entry.sdsIntegrity='PASS';entry.counts=local.sqlite.counts;
   entry.status=local.sqlite.status==='PASS'?'PASS':'WARN';if(entry.status==='PASS')result.availableRestoredCount++;
  }catch(error){entry.reason=safeError(error);}
  result.workspaces.push(entry);
 }
 result.workspaces.sort((a,b)=>a.workspaceId.localeCompare(b.workspaceId));
 for(const selection of result.rememberedSelections)selection.available=selection.workspaceId==='primary'?null:result.workspaces.some(item=>item.workspaceId===selection.workspaceId&&item.companyId===selection.companyId&&item.status==='PASS');
 if(result.workspaces.some(entry=>entry.status!=='PASS')||result.rememberedSelections.some(row=>row.available===false))result.status='WARN';
 return result;
}
