import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile, readdir, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {safeError, redactText} from './redact.mjs';
import {firebaseToolsInstallation} from './cloud.mjs';

const execFileAsync=promisify(execFile);
export async function command(file,args=[],{cwd,timeout=12000,maxBuffer=1024*1024,env=process.env}={}) {
  if(process.platform==='win32'&&['npm','npx'].includes(file)){
    args=[path.join(path.dirname(process.execPath),'node_modules','npm','bin',`${file}-cli.js`),...args];file=process.execPath;
  }
  try {const {stdout,stderr}=await execFileAsync(file,args,{cwd,timeout,maxBuffer,windowsHide:true,env});
    return {status:'PASS',stdout:String(stdout).trimEnd(),stderr:String(stderr).trimEnd()};}
  catch(error){return {status:'UNAVAILABLE',reason:safeError(error),stdout:String(error.stdout??'').trim().slice(-50_000),
    stderr:String(error.stderr??'').trim().slice(-50_000)};}
}

export async function collectGit(root,{liveRemote=false,run=command}={}) {
  const git=async(args,timeout)=>{const result=await run('git',['-c','safe.directory=*',...args],{cwd:root,timeout});
    if(args[0]!=='status'&&result.stdout)result.stdout=result.stdout.trim();return result;};
  const [branch,head,tracking,status,staged,unstaged,log,branches,counts]=await Promise.all([
    git(['branch','--show-current']),git(['rev-parse','HEAD']),git(['rev-parse','refs/remotes/origin/main']),
    git(['status','--porcelain=v1','--untracked-files=all']),git(['diff','--cached','--stat']),git(['diff','--stat']),
    git(['log','-6','--format=%h %s']),git(['for-each-ref','--format=%(refname:short) %(objectname)','refs/heads/frozen','refs/remotes/origin/frozen']),
    git(['rev-list','--left-right','--count','HEAD...refs/remotes/origin/main']),
  ]);
  if(head.status!=='PASS')return {status:'UNAVAILABLE',reason:head.reason};
  let remote=tracking.stdout||null,remoteSource='local origin/main tracking ref';
  if(liveRemote){const result=await git(['ls-remote','origin','refs/heads/main'],10000);
    if(result.status==='PASS'&&result.stdout){remote=result.stdout.split(/\s+/)[0];remoteSource='live remote';}
    else remoteSource='local origin/main tracking ref; live remote unavailable';}
  const changes=(status.stdout??'').split(/\r?\n/).filter(Boolean);
  const trackedModified=[],stagedFiles=[],untrackedFiles=[];
  for(const line of changes){const code=line.slice(0,2),filename=line.slice(3);
    if(code==='??')untrackedFiles.push(filename);
    else {if(code[1]!==' ')trackedModified.push(filename);if(code[0]!==' ')stagedFiles.push(filename);}
  }
  const [ahead,behind]=(counts.stdout??'').split(/\s+/).map(Number);
  const frozen=(branches.stdout??'').split(/\r?\n/).filter(Boolean).map(line=>{
    const match=line.match(/^(.*?) ([a-f0-9]{40})$/);return match?{name:match[1],sha:match[2]}:null;
  }).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name));
  return {status:trackedModified.length||stagedFiles.length||untrackedFiles.length||remote&&remote!==head.stdout?'WARN':'PASS',
    branch:branch.stdout||'(detached)',head:head.stdout,remoteMain:remote,remoteSource,
    localMainMatchesRemote:branch.stdout==='main'&&remote?remote===head.stdout:null,
    ahead:Number.isFinite(ahead)?ahead:null,behind:Number.isFinite(behind)?behind:null,aheadBehindSource:'local origin/main tracking ref',
    trackedModified:[...new Set(trackedModified)].sort(),stagedFiles:[...new Set(stagedFiles)].sort(),untrackedFiles:untrackedFiles.sort(),
    stagedDiffStat:staged.stdout?.slice(0,3000)??'',unstagedDiffStat:unstaged.stdout?.slice(0,3000)??'',
    recentCommits:(log.stdout??'').split(/\r?\n/).filter(Boolean),frozenBranches:frozen};
}

export async function collectEnvironment(root,{run=command}={}) {
  const probes=[['node','node',['--version']],['npm','npm',['--version']],['java','java',['-version']],
    ['rust','rustc',['--version']],['cargo','cargo',['--version']],['git','git',['--version']],
    ['tauri','cargo',['tauri','--version']],['firebaseCli','npx',['--no-install','firebase-tools','--version']]];
  const results=await Promise.all(probes.map(async([name,bin,args])=>[name,await run(bin,args,{cwd:root,timeout:6000})]));
  const versions=Object.fromEntries(results.map(([name,result])=>[name,result.status==='PASS'?(result.stdout||result.stderr).split(/\r?\n/)[0]:null]));
  if(!versions.firebaseCli){const installed=await firebaseToolsInstallation();if(installed)versions.firebaseCli=installed.version+' (cached package)';}
  return {status:versions.node&&versions.npm&&versions.java&&versions.git?'PASS':'WARN',platform:os.platform(),windowsRelease:os.platform()==='win32'?os.release():null,
    versions,expectedFunctionsRuntime:'nodejs22',emulatorsAvailable:!!versions.firebaseCli&&!!versions.java,
    missingPrerequisites:results.filter(([name,result])=>result.status!=='PASS'&&!versions[name]).map(([name])=>name)};
}

export async function collectLocalLogs({repoRoot,appDataRoot,maxFiles=4}) {
  const candidates=[path.join(repoRoot,'firestore-debug.log'),path.join(appDataRoot,'logs','hazcom-navigator.log'),
    path.join(appDataRoot,'hazcom-navigator.log')];
  try {for(const entry of await readdir(path.join(appDataRoot,'logs')))if(/\.log$/i.test(entry))candidates.push(path.join(appDataRoot,'logs',entry));}catch{}
  const logs=[];
  for(const filename of [...new Set(candidates)].slice(0,maxFiles)) {
    try {const info=await stat(filename);if(!info.isFile())continue;
      const data=await readFile(filename,'utf8');
      const lines=data.slice(-64_000).split(/\r?\n/).filter(line=>
        /\b(error|warn|fail|exception|denied)\b/i.test(line)&&!/^[\s\t]+at /i.test(line)&&
        !/DatastoreException\$Builder|^\s*com\.google\.cloud\.datastore\.core\.exception\./.test(line)).slice(-25);
      logs.push({source:path.basename(filename),lastModified:info.mtime.toISOString(),totalBytes:info.size,
        recentRelevantLines:lines.map(line=>redactText(line,{repoRoot}).slice(0,500))});
    } catch { /* Optional logs may be absent or locked. */ }
  }
  return {status:'PASS',files:logs};
}

export async function readHandoffEvidence(root) {
  try {
    const [deployment,current]=await Promise.all([
      readFile(path.join(root,'docs','FIREBASE_SCHEMA2_DEPLOYMENT_HANDOFF.md'),'utf8'),
      readFile(path.join(root,'docs','WORK_MODE_CURRENT_STATE.md'),'utf8')]);
    const deployedBackendSource=deployment.match(/deployed Functions source[^\n]*?([a-f0-9]{40})/i)?.[1]??
      current.match(/Deployed backend source:\s*`([a-f0-9]{40})`/)?.[1]??null;
    const pending=[];
    if(/live authenticated[^\n]*nonmember|authenticated nonmember SDS denial/i.test(deployment))
      pending.push('Live authenticated nonmember SDS denial');
    if(/live Member publication denial/i.test(deployment))pending.push('Live Member publication denial');
    if(/live Demo publication denial/i.test(deployment))pending.push('Live Demo publication denial');
    if(/live direct privileged-field write denial/i.test(deployment))pending.push('Live direct privileged-field write denial');
    return {status:'PASS',source:'repository handoff documentation, not a fresh cloud check',deployedBackendSource,
      nativeSchema2PublicationDocumented:/native schema-2 publication/i.test(current),
      independentReplicaDocumented:/fresh separate SQLite replica/i.test(current),knownUnverified:pending};
  } catch(error) {return {status:'UNAVAILABLE',reason:safeError(error),knownUnverified:[]};}
}
