import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sanitize} from './redact.mjs';

export const DIAGNOSTIC_SCHEMA_VERSION=1;
const state=value=>value?.status??'UNVERIFIED';
const line=(label,value)=>`- **${label}:** ${value??'UNVERIFIED'}`;
const json=value=>'`'+JSON.stringify(value)+'`';

export function assertReportSchema(report) {
  if(report?.diagnosticSchemaVersion!==DIAGNOSTIC_SCHEMA_VERSION ||
    !['quick','normal','full','cloud'].includes(report.mode) ||
    !/^\d{4}-\d\d-\d\dT/.test(report.generatedAt??'') ||
    !['git','environment','firebase','sqlite','sds','authoring','entitlement','publication','tests','logs','handoffEvidence']
      .every(key=>report[key]&&typeof report[key]==='object') || !Array.isArray(report.knownUnverified))
    throw Error('Invalid diagnostic report schema');
  return report;
}

export function overallStatus(report) {
  const checks=[report.git,report.environment,report.sqlite,report.sds,report.authoring,report.publication,
    report.firebase,report.tests];
  if(checks.some(item=>state(item)==='FAIL'))return 'FAIL';
  if(checks.some(item=>['WARN','UNAVAILABLE','UNVERIFIED','REFUSED'].includes(state(item))))return 'WARN';
  return 'PASS';
}

export function likelyNextAction(report) {
  if(report.sqlite.status==='FAIL')return 'Inspect SQLite integrity/foreign-key findings before authoring or publication.';
  if(report.sqlite.migrationPending)return 'The local SQLite migration level trails this source checkout; verify the native app upgrades it before relying on new local features.';
  if(report.sds.status==='FAIL')return 'Reattach or restore the SDS files listed as missing or mismatched, then rerun diagnostics:quick.';
  if(report.publication.status==='FAIL')return 'Review the local publication readiness issue before attempting publication.';
  if(!report.sqlite.companySelection?.companyId)return 'Rerun with --company <Company ID> to select the intended local Company.';
  if(report.git.localMainMatchesRemote===false)return 'Review the local and remote main SHAs before changing or pushing source.';
  if(report.firebase.status==='UNAVAILABLE')return 'If cloud evidence is needed, sign in to Firebase CLI for hazcom-navigator-dev and rerun diagnostics:cloud.';
  if(report.publication.journal?.attempt?.status==='pending')return 'Review the pending publication ID and current cloud parent before resuming in the app.';
  if(report.sqlite.status==='PASS'&&report.sds.status==='PASS'&&report.firebase.status==='PASS'&&report.tests.status==='PASS')
    return 'Upload diagnostic-bundle.zip to the next ChatGPT conversation for focused development work.';
  return 'Use the failing or unverified section below to choose the next focused check.';
}

export function renderSummary(report) {
  const problems=[],warnings=[];
  for(const section of ['git','sqlite','sds','authoring','publication','firebase','tests']) {
    const value=report[section];if(['FAIL','REFUSED'].includes(state(value)))problems.push(`${section}: ${state(value)}`);
    else if(state(value)==='WARN')warnings.push(`${section}: WARN`);
  }
  const revision=report.firebase.revision?.revision;
  const local=report.publication.journal?.publishedLocal;
  const commercial=report.firebase.commercial;
  const working=[];
  if(report.sqlite.status==='PASS')working.push('Local SQLite integrity and foreign keys passed.');
  if(report.sds.status==='PASS')working.push(`${report.sds.expectedCount} current local SDS file(s) matched recorded integrity metadata.`);
  if(report.publication.readiness?.status==='PASS')working.push('The local authoring projection passed relationship and publication checks.');
  if(revision?.complete)working.push(`Cloud revision ${revision.revisionNumber} is published and marked complete (privileged metadata read).`);
  if(!working.length)working.push('No complete local or cloud health proof was available in this run.');
  const changed=report.git.trackedModified?.length||report.git.stagedFiles?.length||report.git.untrackedFiles?.length?
    `${report.git.trackedModified?.length??0} tracked, ${report.git.stagedFiles?.length??0} staged, ${report.git.untrackedFiles?.length??0} untracked filename(s).`:'No local Git changes.';
  const lines=[
    '# HazCom Navigator diagnostic summary',
    '',
    `Generated ${report.generatedAt} · mode ${report.mode} · overall ${report.overallStatus}`,
    '',
    '## CHAT HANDOFF',
    '',
    line('Current branch',report.git.branch),
    line('Current source SHA',report.git.head),
    line('Remote main SHA',`${report.git.remoteMain??'UNAVAILABLE'} (${report.git.remoteSource??'unknown source'})`),
    line('Deployed backend source SHA',`${report.handoffEvidence.deployedBackendSource??'UNVERIFIED'} (repository handoff, not deployment fingerprint)`),
    line('Firebase project',report.firebase.project??report.firebaseProject),
    line('Company',report.sqlite.companySelection?.companyId?`${report.sqlite.companySelection.companyId} (${report.sqlite.companySelection.source})`:'UNVERIFIED'),
    line('Role and coverage',commercial?.status==='PASS'?`${commercial.role??'role unknown'}; ${commercial.plan??'plan unknown'} / ${commercial.commercialStatus}; coverage ${commercial.coverage?.state??'unknown'} (privileged cloud documents)`:'UNVERIFIED'),
    line('Failing checks',problems.length?problems.join('; '):'none reported'),
    line('Warnings',warnings.length?warnings.join('; '):'none reported'),
    line('Current publication',revision?`cloud revision ${revision.revisionNumber} ${revision.status}; ${Object.values(revision.recordCounts??{}).reduce((a,b)=>a+Number(b),0)} records / ${revision.attachmentCount} SDS; local receipt ${local?.revisionId??'none'}`:`local receipt ${local?.revisionId??'none'}; cloud current UNVERIFIED`),
    line('Likely next action',report.nextAction),
    line('Known unverified',report.knownUnverified.length?report.knownUnverified.join('; '):'none documented'),
    '',
    '## WHAT IS WORKING?',
    '',
    ...working.map(item=>`- ${item}`),
    '',
    '## WHAT IS FAILING?',
    '',
    `- ${problems.length?problems.join('; '):'No failure recorded.'}`,
    ...(report.publication.readiness?.issues??[]).map(issue=>`- Publication: ${issue}`),
    ...((report.sds.files??[]).filter(file=>file.status==='FAIL').map(file=>`- SDS ${file.attachmentId}: ${file.reason}`)),
    '',
    '## WHAT CHANGED?',
    '',
    `- ${changed}`,
    ...((report.git.trackedModified??[]).map(file=>`- Modified: ${file}`)),
    ...((report.git.untrackedFiles??[]).map(file=>`- Untracked: ${file}`)),
    '',
    '## WHAT IS DEPLOYED?',
    '',
    `- Backend source in handoff: ${report.handoffEvidence.deployedBackendSource??'UNVERIFIED'}.`,
    `- Cloud inspection: ${report.firebase.status}; ${report.firebase.functions?.length??0} Function(s), ${report.firebase.cloudRun?.length??0} Cloud Run service(s) returned when available.`,
    '',
    '## WHAT IS LOCAL ONLY?',
    '',
    `- SQLite: ${report.sqlite.status}; migration ${report.sqlite.schemaVersion??'unknown'} of source ${report.sqlite.expectedSourceSchemaVersion??'unknown'}; current local records ${json(report.sqlite.counts??{})}; Trash ${json(report.sqlite.trashCounts??{})}; bulk SDS import sessions ${report.sqlite.sdsImportSessions??'not available'}.`,
    `- Publication projection: ${report.publication.status}; fingerprint ${report.publication.localFingerprint??'UNVERIFIED'}; local changes ${report.publication.localChanges??'UNVERIFIED'}.`,
    `- Publication journal: ${report.publication.journal?.status??'UNVERIFIED'}; pending IDs ${json(report.publication.journal?.pendingAttemptIds??[])}.`,
    '',
    '## WHAT IS UNVERIFIED?',
    '',
    ...report.knownUnverified.map(item=>`- ${item}`),
    '',
    '## WHAT SHOULD BE CHECKED NEXT?',
    '',
    `- ${report.nextAction}`,
    '',
    'Evidence labels matter: local SQLite checks do not prove cloud access. Privileged Firebase CLI reads do not prove client Firestore or Storage Rules. This bundle contains no SDS bytes or database copy.',
  ];
  return lines.join('\n')+'\n';
}

function crc32(buffer) {
  let crc=0xffffffff;
  for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}

// Small store-only ZIP, so the bundle has no external archiver dependency.
export function makeZip(files) {
  const locals=[],central=[];let offset=0;
  for(const [name,text] of Object.entries(files)) {
    if(!/^[a-z0-9][a-z0-9._-]*$/i.test(name))throw Error('Unsafe ZIP member name');
    const filename=Buffer.from(name),data=Buffer.from(text),crc=crc32(data);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);
    local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);
    locals.push(local,filename,data);
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);
    entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);
    entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);central.push(entry,filename);
    offset+=local.length+filename.length+data.length;
  }
  const centralBytes=central.reduce((n,buffer)=>n+buffer.length,0),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10);
  end.writeUInt32LE(centralBytes,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,...central,end]);
}

export async function writeBundle(rawReport,{root,outputRoot=path.join(root,'diagnostics','output')}={}) {
  const report=assertReportSchema(sanitize(rawReport,{repoRoot:root}));
  report.overallStatus=overallStatus(report);report.nextAction=likelyNextAction(report);
  const summary=renderSummary(report),json=JSON.stringify(report,null,2)+'\n';
  const stamp=report.generatedAt.replace(/[-:]/g,'').replace(/\..*$/,'').replace('Z','Z');
  await mkdir(outputRoot,{recursive:true});
  let folder=path.join(outputRoot,stamp),suffix=0;
  for(;;){try{await mkdir(folder,{recursive:false});break;}catch(error){if(error.code!=='EEXIST')throw error;folder=path.join(outputRoot,`${stamp}-${++suffix}`);}}
  await writeFile(path.join(folder,'diagnostic-summary.md'),summary,{flag:'wx'});
  await writeFile(path.join(folder,'diagnostic-report.json'),json,{flag:'wx'});
  await writeFile(path.join(folder,'diagnostic-bundle.zip'),makeZip({'diagnostic-summary.md':summary,'diagnostic-report.json':json}),{flag:'wx'});
  return {folder,report,summary};
}
