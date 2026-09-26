#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {collectGit,collectEnvironment,collectLocalLogs,readHandoffEvidence,command} from './diagnostics/local.mjs';
import {collectSqlite} from './diagnostics/sqlite.mjs';
import {collectCloud,assertDevProject} from './diagnostics/cloud.mjs';
import {writeBundle} from './diagnostics/report.mjs';
import {redactText,safeError} from './diagnostics/redact.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modes=new Set(['quick','normal','full','cloud']);

export function parseArgs(argv) {
  const [first,...rest]=argv,mode=modes.has(first)?first:'normal',args=modes.has(first)?rest:argv;
  const options={mode};
  for(let i=0;i<args.length;i++) {
    const flag=args[i];
    if(!['--project','--company','--db','--journal','--attachments','--output'].includes(flag)||!args[i+1])
      throw Error(`Unknown or incomplete diagnostic option: ${flag}`);
    options[flag.slice(2)]=args[++i];
  }
  return options;
}

async function configuredProject() {
  const config=JSON.parse(await readFile(path.join(root,'firebase','.firebaserc'),'utf8'));
  return config.projects?.default??null;
}

async function runTests(mode) {
  const scripts=mode==='full'
    ?[['diagnostics','npm',['run','test:diagnostics']],['core','npm',['test']],['firebase-emulator','npm',['run','test:firebase']],
      ['windows-publication','npm',['run','test:windows:publication']],['build','npm',['run','build']],
      ['functions-build','npm',['run','build','-w','@hazcom/firebase-functions']]]
    :mode==='normal'?[['diagnostics','npm',['run','test:diagnostics']],['windows-publication','npm',['run','test:windows:publication']]]:[];
  const results=[];
  for(const [name,file,args] of scripts) {
    const started=Date.now(),result=await command(file,args,{cwd:root,timeout:name==='firebase-emulator'?240000:180000,maxBuffer:4*1024*1024,
      env:{...process.env,HAZCOM_DIAGNOSTICS_NO_MEASUREMENTS:'1'}});
    results.push({name,status:result.status==='PASS'?'PASS':'FAIL',durationMs:Date.now()-started,
      outputTail:redactText(((result.stdout??'')+'\n'+(result.stderr??'')).split(/\r?\n/).slice(-30).join('\n'),{repoRoot:root}).slice(-4000),
      error:result.status==='PASS'?null:safeError(result.reason)});
  }
  return {status:results.some(item=>item.status==='FAIL')?'FAIL':results.length?'PASS':'UNVERIFIED',
    scope:mode==='full'?'full non-stress suite':mode==='normal'?'targeted diagnostic/publication suite':'not run',results};
}

export async function collect(options) {
  const configured=await configuredProject(),project=options.project??configured;
  if(options.mode!=='quick')assertDevProject(project);
  const appData=path.join(process.env.APPDATA??path.join(process.env.HOME??'', 'AppData','Roaming'),'com.saturnstraw.hazcomnavigator');
  const paths={databaseFile:options.db??path.join(appData,'hazcom-navigator.db'),journalFile:options.journal??path.join(appData,'hazcom-publication-journal.db'),
    attachmentRoot:options.attachments??path.join(appData,'attachments'),companyId:options.company,sourceMigrationDir:path.join(root,'database','migrations')};
  const [git,environment,local,logs,handoffEvidence]=await Promise.all([
    collectGit(root,{liveRemote:options.mode!=='quick'}),collectEnvironment(root),collectSqlite(paths),
    collectLocalLogs({repoRoot:root,appDataRoot:appData}),readHandoffEvidence(root),
  ]);
  const companyId=local.sqlite.companySelection?.companyId??null;
  let firebase={status:'UNVERIFIED',project,reason:'Quick mode performs no cloud reads',evidence:'none'};
  if(options.mode!=='quick')firebase=await collectCloud({project,companyId,accountId:local.publication.journal?.accountIdHint??null,root});
  if(firebase.revision?.revision){
    local.publication.currentCloudRevisionId=firebase.revision.currentRevisionId;
    if(local.publication.localContentHash)local.publication.localChanges=local.publication.localContentHash!==firebase.revision.revision.contentHash;
  }
  const attempt=local.publication.journal?.attempt;
  local.publication.attemptResumability=attempt?.status==='pending'
    ?firebase.revision?.currentRevisionId!==undefined&&local.publication.localFingerprint
      ?attempt.parentRevisionId===firebase.revision.currentRevisionId&&attempt.fingerprint===local.publication.localFingerprint
      :null
    :false;
  const tests=await runTests(options.mode);
  const knownUnverified=[...handoffEvidence.knownUnverified];
  if(firebase.status==='UNAVAILABLE'||firebase.status==='UNVERIFIED')knownUnverified.push('Fresh cloud deployment and revision state were not read in this run');
  if(!companyId)knownUnverified.push('Active Company context could not be established from local SQLite/journal');
  if(!firebase.commercial?.role)knownUnverified.push('Authenticated client role and effective commercial capability were not checked');
  const report={diagnosticSchemaVersion:1,generatedAt:new Date().toISOString(),mode:options.mode,firebaseProject:project,
    overallStatus:'UNVERIFIED',git,environment,firebase,sqlite:local.sqlite,sds:local.sds,authoring:local.authoring,
    entitlement:firebase.commercial??{status:'UNVERIFIED',source:'No authoritative cloud commercial snapshot available'},
    publication:local.publication,tests,logs,handoffEvidence,knownUnverified:[...new Set(knownUnverified)].sort()};
  return report;
}

async function main() {
  const options=parseArgs(process.argv.slice(2));
  const report=await collect(options);
  const bundle=await writeBundle(report,{root,outputRoot:options.output??path.join(root,'diagnostics','output')});
  console.log(`Diagnostic ${bundle.report.overallStatus}: ${bundle.folder}`);
  console.log(`Upload diagnostic-bundle.zip or diagnostic-summary.md and diagnostic-report.json to ChatGPT.`);
  if(bundle.report.tests.status==='FAIL')process.exitCode=1;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(safeError(error,{repoRoot:root}));process.exitCode=2;});
