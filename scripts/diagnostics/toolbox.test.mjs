import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,unlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {authoringService} from '@hazcom/authoring';
import {REPLICA_SCHEMA_SQL} from '@hazcom/sync';
import {nodeSqlite,nodeFiles} from '@hazcom/sync/node';
import {collectSqlite,collectPublicationJournal,openReadOnlySqlite} from './sqlite.mjs';
import {collectGit,command} from './local.mjs';
import {assertDevProject,collectCloud} from './cloud.mjs';
import {redactText,sanitize} from './redact.mjs';
import {DIAGNOSTIC_SCHEMA_VERSION,assertReportSchema,makeZip,writeBundle} from './report.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture({includeMigration4=true}={}) {
  const folder=await mkdtemp(path.join(tmpdir(),'hazcom-diagnostic-test-'));
  const databaseFile=path.join(folder,'author.db'),journalFile=path.join(folder,'journal.db'),attachmentRoot=path.join(folder,'attachments');
  const migration3=await readFile(path.resolve('database/migrations/003_authoring.sql'),'utf8');
  const migration4Sql=await readFile(path.resolve('database/migrations/004_bulk_sds_import.sql'),'utf8');
  const sql=nodeSqlite(databaseFile,REPLICA_SCHEMA_SQL+migration3+(includeMigration4?migration4Sql:''));
  sql.db.prepare('INSERT INTO company(id,name,contact_email) VALUES (?,?,?)').run('company-a','Test Company','test@example.test');
  const files=await nodeFiles(attachmentRoot);
  const author=authoringService({sql,files,companyId:'company-a',authorize:async()=>({companyId:'company-a',role:'manager',active:true}),today:()=> '2026-09-26'});
  await author.create('work_area',{name:'Mixing',location:'Building 1',poc_name:'',poc_email:'',poc_phone_number:'',description:''},'area-a');
  await author.create('chemical_product',{product_name:'Test cleaner',chemical_names:null,cas_numbers:null,manufacturer:'Example',sds_date:'2026-01-01'},'product-a');
  const pdf=Buffer.from('%PDF-diagnostic dummy only\n');
  await author.importSds('product-a',new Uint8Array(pdf),'synthetic.pdf','sds-a');
  const relative='company-a/sds-a.pdf';
  sql.close();
  const journal=new DatabaseSync(journalFile);
  journal.exec('CREATE TABLE publication_journal (id TEXT PRIMARY KEY,value TEXT NOT NULL)');
  journal.prepare('INSERT INTO publication_journal VALUES (?,?)').run('test-uid/ui-attempt/company-a',JSON.stringify({revisionId:'revision-a',parentRevisionId:null,fingerprint:'fingerprint-a',status:'pending'}));
  journal.close();
  return {folder,databaseFile,journalFile,attachmentRoot,pdf,relative,sourceMigrationDir:path.resolve('database/migrations')};
}

test('redacts tokens, credentials, keys, signed URLs, and sensitive object keys',()=>{
  const jwt='eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123456';
  const text=`Authorization: Bearer abc.def Cookie: session=xyz\n${jwt}\nrefresh_token=refresh-secret\n"refreshToken":"json-secret"\nya29.abcdef123456\n-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\nhttps://x.test/?X-Goog-Signature=abc123`;
  const redacted=redactText(text);
  for(const secret of ['abc.def','session=xyz',jwt,'refresh-secret','json-secret','ya29.abcdef123456','BEGIN PRIVATE KEY','X-Goog-Signature=abc123'])assert.ok(!redacted.includes(secret),secret);
  assert.equal(sanitize({password:'hello',nested:{api_key:'123'}}).password,'[REDACTED]');
  assert.equal(sanitize({password:'hello',nested:{api_key:'123'}}).nested.api_key,'[REDACTED]');
});

test('git collector identifies tracked and untracked changes without full diffs',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hazcom-diag-git-'));
  const git=(...args)=>execFileSync('git',['-c','safe.directory=*',...args],{cwd:root,encoding:'utf8'});
  git('init','-b','main');git('config','user.email','test@example.test');git('config','user.name','Test');
  await writeFile(path.join(root,'tracked.txt'),'a');git('add','tracked.txt');git('commit','-m','Initial');
  git('update-ref','refs/remotes/origin/main','HEAD');
  await writeFile(path.join(root,'tracked.txt'),'b');await writeFile(path.join(root,'new.txt'),'new');
  await writeFile(path.join(root,'staged.txt'),'staged');git('add','staged.txt');
  const report=await collectGit(root);
  assert.equal(report.localMainMatchesRemote,true);
  assert.deepEqual(report.trackedModified,['tracked.txt']);
  assert.deepEqual(report.untrackedFiles,['new.txt']);
  assert.deepEqual(report.stagedFiles,['staged.txt']);
});

test('failed validation command retains bounded diagnostic stderr',async()=>{
  const result=await command(process.execPath,['-e',"console.error('failure sentinel');process.exit(1)"],{cwd:path.resolve('.')});
  assert.equal(result.status,'UNAVAILABLE');assert.match(result.stderr,/failure sentinel/);
});

test('read-only SQLite collector checks schema, relationships, SDS, and leaves DB unchanged',async()=>{
  const f=await fixture(),before=hash(await readFile(f.databaseFile));
  const result=await collectSqlite(f);
  assert.equal(result.sqlite.status,'PASS');assert.equal(result.sqlite.schemaVersion,4);
  assert.equal(result.sqlite.expectedSourceSchemaVersion,4);assert.equal(result.sqlite.sdsImportSessions,0);
  assert.equal(result.sqlite.counts.chemical_product,1);assert.equal(result.sds.status,'PASS');
  assert.equal(result.authoring.relationshipValidation.startsWith('PASS'),true);
  assert.equal(result.publication.journal.attempt.revisionId,'revision-a');
  assert.deepEqual(result.publication.journal.pendingAttemptIds,['revision-a']);
  assert.equal(hash(await readFile(f.databaseFile)),before);
  const db=openReadOnlySqlite(f.databaseFile);
  assert.throws(()=>db.exec("INSERT INTO company(id,name,contact_email) VALUES ('bad','Bad','bad@example.test')"));db.close();
});

test('migration-3 database under migration-4 source remains readable without changing schema',async()=>{
  const f=await fixture({includeMigration4:false}),before=hash(await readFile(f.databaseFile));
  const result=await collectSqlite(f);
  assert.equal(result.sqlite.status,'WARN');assert.equal(result.sqlite.schemaVersion,3);
  assert.equal(result.sqlite.expectedSourceSchemaVersion,4);assert.equal(result.sqlite.migrationPending,true);
  assert.equal(result.authoring.status,'WARN');assert.equal(result.authoring.relationshipValidation.startsWith('PASS'),true);
  assert.equal(result.sqlite.counts.chemical_product,1);assert.equal(result.sqlite.trashCounts.chemical_product,0);
  assert.equal(result.sds.status,'PASS');assert.equal(result.publication.status,'WARN'); // Synthetic journal is intentionally pending.
  assert.equal(hash(await readFile(f.databaseFile)),before);
});

test('missing SDS and same-size hash corruption are reported without repair',async()=>{
  const f=await fixture(),filename=path.join(f.attachmentRoot,f.relative);
  await unlink(filename);
  let result=await collectSqlite(f);
  assert.equal(result.sds.status,'FAIL');assert.equal(result.sds.missingCount,1);
  assert.equal(result.authoring.relationshipValidation.startsWith('PASS'),true);
  const damaged=Buffer.from(f.pdf);damaged[damaged.length-1]^=1;
  await writeFile(filename,damaged);
  result=await collectSqlite(f);
  assert.equal(result.sds.status,'FAIL');assert.equal(result.sds.mismatchCount,1);
  assert.equal(result.sds.files[0].expectedSize,result.sds.files[0].actualSize);
  assert.notEqual(result.sds.files[0].expectedSha256,result.sds.files[0].actualSha256);
});

test('publication journal is read-only and malformed values degrade cleanly',async()=>{
  const f=await fixture(),before=hash(await readFile(f.journalFile));
  const result=collectPublicationJournal(f.journalFile,'company-a');
  assert.equal(result.status,'PASS');assert.equal(result.accountIdHint,'test-uid');
  assert.equal(hash(await readFile(f.journalFile)),before);
  const unavailable=collectPublicationJournal(path.join(f.folder,'absent.db'),'company-a');
  assert.equal(unavailable.status,'UNAVAILABLE');
});

test('Firebase project guard refuses unexpected project before token or network access',async()=>{
  assert.throws(()=>assertDevProject('command-rhythm'),/refused project/);
  let tokenCalls=0,networkCalls=0;
  await assert.rejects(collectCloud({project:'command-rhythm',getToken:async()=>{tokenCalls++;return 'secret';},
    fetchImpl:async()=>{networkCalls++;}}),/refused project/);
  assert.equal(tokenCalls,0);assert.equal(networkCalls,0);
  const noAuth=await collectCloud({project:'hazcom-navigator-dev',getToken:async()=>null,fetchImpl:async()=>{networkCalls++;}});
  assert.equal(noAuth.status,'UNAVAILABLE');assert.equal(networkCalls,0);
});

test('CLI cloud mode refuses unexpected project',()=>{
  assert.throws(()=>execFileSync(process.execPath,['scripts/diagnostics.mjs','cloud','--project','command-rhythm'],
    {cwd:path.resolve('.'),encoding:'utf8',stdio:'pipe'}),/status 2|Command failed/);
});

test('versioned report and ZIP are generated when cloud and SQLite are unavailable',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'hazcom-diag-bundle-'));
  const report={diagnosticSchemaVersion:DIAGNOSTIC_SCHEMA_VERSION,generatedAt:'2026-09-26T12:00:00.000Z',mode:'quick',firebaseProject:'hazcom-navigator-dev',
    git:{status:'PASS',head:'a'.repeat(40),remoteMain:'a'.repeat(40),remoteSource:'tracking',trackedModified:[],stagedFiles:[],untrackedFiles:[]},
    environment:{status:'WARN'},firebase:{status:'UNAVAILABLE',project:'hazcom-navigator-dev'},sqlite:{status:'UNAVAILABLE'},sds:{status:'UNAVAILABLE'},
    authoring:{status:'UNAVAILABLE'},entitlement:{status:'UNVERIFIED'},publication:{status:'UNAVAILABLE',journal:null,readiness:null},
    tests:{status:'UNVERIFIED'},logs:{status:'PASS',files:[{message:'Authorization: Bearer abc123'}]},
    handoffEvidence:{deployedBackendSource:null},knownUnverified:['Cloud state']};
  const bundle=await writeBundle(report,{root});
  const json=JSON.parse(await readFile(path.join(bundle.folder,'diagnostic-report.json'),'utf8'));
  const summary=await readFile(path.join(bundle.folder,'diagnostic-summary.md'),'utf8');
  const zip=await readFile(path.join(bundle.folder,'diagnostic-bundle.zip'));
  assert.equal(json.diagnosticSchemaVersion,1);assert.equal(json.overallStatus,'WARN');
  assert.equal(assertReportSchema(json),json);
  assert.throws(()=>assertReportSchema({...json,diagnosticSchemaVersion:2}),/schema/);
  assert.ok(summary.includes('CHAT HANDOFF'));assert.ok(summary.includes('WHAT IS UNVERIFIED?'));
  assert.ok(!JSON.stringify(json).includes('abc123'));assert.equal(zip.readUInt32LE(0),0x04034b50);
  assert.ok((await stat(path.join(bundle.folder,'diagnostic-bundle.zip'))).size>summary.length);
  assert.throws(()=>makeZip({'../secret':'no'}),/Unsafe ZIP/);
});
