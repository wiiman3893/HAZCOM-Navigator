import {createRequire} from 'node:module';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {safeError, redactText} from './redact.mjs';
import {resolveCommercial} from '@hazcom/core';

export const DEV_PROJECT='hazcom-navigator-dev';
export function assertDevProject(project) {
  if(project!==DEV_PROJECT)throw Error(`Cloud diagnostics refused project ${String(project)}; only ${DEV_PROJECT} is allowed.`);
  return project;
}

const require=createRequire(import.meta.url);
async function firebaseToolsRoots() {
  const roots=[process.env.HAZCOM_FIREBASE_TOOLS_ROOT];
  try {roots.push(path.dirname(require.resolve('firebase-tools/package.json')));} catch { /* Optional CLI. */ }
  for(const cache of [process.env.npm_config_cache,path.join(process.env.LOCALAPPDATA??'', 'npm-cache'),path.join(process.env.APPDATA??'', 'npm-cache')]) {
    if(!cache)continue;
    try {for(const entry of await readdir(path.join(cache,'_npx')))roots.push(path.join(cache,'_npx',entry,'node_modules','firebase-tools'));}
    catch { /* A missing cache is normal. */ }
  }
  return [...new Set(roots.filter(Boolean))];
}

export async function firebaseToolsInstallation() {
  for(const root of await firebaseToolsRoots()){
    try {const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));if(pkg.name==='firebase-tools')return {root,version:pkg.version};}
    catch { /* Try the next installed copy. */ }
  }
  return null;
}

async function accessToken() {
  for(const root of await firebaseToolsRoots()) {
    try {
      const auth=require(path.join(root,'lib','auth.js'));
      const account=auth.getGlobalDefaultAccount();
      if(!account?.tokens?.refresh_token)continue;
      const result=await auth.getAccessToken(account.tokens.refresh_token,[]);
      if(result?.access_token)return result.access_token;
    } catch { /* Try another installed firebase-tools location. */ }
  }
  return null;
}

function field(value) {
  if(!value)return null;
  for(const key of ['stringValue','integerValue','doubleValue','booleanValue','timestampValue'])if(key in value)
    return key==='integerValue'?Number(value[key]):value[key];
  if('nullValue'in value)return null;
  if('mapValue'in value)return Object.fromEntries(Object.entries(value.mapValue.fields??{}).map(([key,val])=>[key,field(val)]));
  if('arrayValue'in value)return (value.arrayValue.values??[]).map(field);
  return null;
}
const document=body=>Object.fromEntries(Object.entries(body.fields??{}).map(([key,value])=>[key,field(value)]));

export async function collectCloud({project,companyId=null,accountId=null,root=null,fetchImpl=fetch,getToken=accessToken}) {
  assertDevProject(project); // Guard precedes credential discovery and every network call.
  let token;
  try {token=await getToken();} catch(error) {return {status:'UNAVAILABLE',project,reason:safeError(error),evidence:'none'};}
  if(!token)return {status:'UNAVAILABLE',project,reason:'Firebase CLI credentials are unavailable; no cloud calls made',evidence:'none'};
  const base=`projects/${project}`;
  async function request(url,{method='GET',body}={}) {
    if(!url.includes(`/projects/${project}/`) && !url.includes(`/${project}.firebasestorage.app`) &&
      !(url==='https://logging.googleapis.com/v2/entries:list' && body?.resourceNames?.length===1 && body.resourceNames[0]===base))
      throw Error('Cloud URL failed project guard');
    const response=await fetchImpl(url,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
    if(response.status===404)return null;
    if(!response.ok){const problem=await response.json().catch(()=>null);
      throw Error(`Cloud read returned HTTP ${response.status}: ${String(problem?.error?.message??'no details').slice(0,180)}`);}
    return response.json();
  }
  const inspection={status:'PASS',project,evidence:'privileged Firebase CLI OAuth metadata read; not client Rules proof',
    functions:null,cloudRun:null,indexes:null,rules:null,storage:null,revision:null,commercial:null,recentErrors:[],unavailable:[],findings:[]};
  const guarded=async(name,fn)=>{try{inspection[name]=await fn();}catch(error){inspection.unavailable.push({source:name,reason:safeError(error)});}};
  await guarded('functions',async()=>{
    const data=await request(`https://cloudfunctions.googleapis.com/v2/${base}/locations/us-central1/functions?pageSize=100`);
    return (data?.functions??[]).map(item=>({name:item.name?.split('/').at(-1),state:item.state??null,runtime:item.buildConfig?.runtime??null,
      updateTime:item.updateTime??null,uri:item.serviceConfig?.uri?'<deployed HTTPS endpoint>':null})).sort((a,b)=>a.name.localeCompare(b.name));
  });
  await guarded('cloudRun',async()=>{
    const list=await request(`https://run.googleapis.com/v2/${base}/locations/us-central1/services?pageSize=100`);
    const services=(list?.services??[]).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,40);
    const audited=[];
    for(const service of services) {
      const name=service.name;
      if(!name?.startsWith(`${base}/locations/us-central1/services/`))continue;
      let iam=null;
      try {const policy=await request(`https://run.googleapis.com/v2/${name}:getIamPolicy?options.requestedPolicyVersion=3`);
        iam={bindingCount:policy?.bindings?.length??0,allUsersRunInvoker:(policy?.bindings??[]).some(b=>b.role==='roles/run.invoker'&&b.members?.includes('allUsers'))};}
      catch(error) {inspection.unavailable.push({source:`cloudRunIam/${name.split('/').at(-1)}`,reason:safeError(error)});}
      audited.push({name:name.split('/').at(-1),invokerIamDisabled:service.invokerIamDisabled===true,reconciling:service.reconciling===true,
        latestReadyRevision:service.latestReadyRevision??null,iam});
    }
    return audited;
  });
  await guarded('indexes',async()=>{
    const config=root?JSON.parse(await readFile(path.join(root,'firebase','firestore.indexes.json'),'utf8')):{indexes:[]};
    const groups=[...new Set((config.indexes??[]).map(index=>index.collectionGroup).filter(group=>/^[A-Za-z0-9_-]{1,128}$/.test(group)))].sort();
    const indexes=[];
    for(const group of groups){const data=await request(`https://firestore.googleapis.com/v1/${base}/databases/(default)/collectionGroups/${group}/indexes`);
      indexes.push(...(data?.indexes??[]).map(index=>({name:index.name?.split('/').slice(-3).join('/'),state:index.state??null})));
    }
    return {count:indexes.length,indexes:indexes.slice(0,100),configuredCollectionGroups:groups};
  });
  await guarded('rules',async()=>{
    const releases={};
    for(const target of ['cloud.firestore',`firebase.storage/${project}.firebasestorage.app`]) {
      const release=await request(`https://firebaserules.googleapis.com/v1/${base}/releases/${target}`);
      releases[target]=release?{rulesetName:release.rulesetName?.split('/').at(-1)??null,updateTime:release.updateTime??null}:null;
    }
    return releases;
  });
  await guarded('storage',async()=>{
    const bucket=await request(`https://storage.googleapis.com/storage/v1/b/${project}.firebasestorage.app`);
    return bucket?{name:bucket.name,location:bucket.location??null,storageClass:bucket.storageClass??null,versioningEnabled:bucket.versioning?.enabled??false}:null;
  });
  if(companyId && /^[A-Za-z0-9_-]{1,128}$/.test(companyId)) await guarded('revision',async()=>{
    const prefix=`https://firestore.googleapis.com/v1/${base}/databases/(default)/documents/companies/${companyId}`;
    const companyRaw=await request(prefix);
    if(!companyRaw)return {companyId,status:'UNAVAILABLE',reason:'Company document not found'};
    const company=document(companyRaw),revisionId=company.currentRevisionId??null;
    if(!revisionId)return {companyId,status:'PASS',currentRevisionId:null,currentRevisionNumber:company.currentRevisionNumber??null};
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(revisionId))throw Error('Unsafe current revision ID');
    const raw=await request(`${prefix}/publishedRevisions/${revisionId}`),revision=raw?document(raw):null;
    if(!revision)return {companyId,status:'FAIL',currentRevisionId:revisionId,reason:'Current revision metadata missing'};
    const complete=revision.status==='published'&&revision.validationCursor===revision.chunkCount&&revision.validatedManifestHash===revision.manifestHash;
    return {companyId,status:complete?'PASS':'FAIL',currentRevisionId:revisionId,currentRevisionNumber:company.currentRevisionNumber??null,
      revision:{revisionId:revision.revisionId??revisionId,revisionNumber:revision.revisionNumber??null,schemaVersion:revision.schemaVersion??null,
        status:revision.status??null,publishedAt:revision.publishedAt??null,parentRevisionId:revision.parentRevisionId??null,
        recordCounts:revision.recordCounts??null,attachmentCount:revision.attachmentCount??null,manifestHash:revision.manifestHash??null,
        contentHash:revision.contentHash??null,validationCursor:revision.validationCursor??null,chunkCount:revision.chunkCount??null,
        manifestValidated:revision.validatedManifestHash===revision.manifestHash,complete}};
  });
  if(companyId && /^[A-Za-z0-9_-]{1,128}$/.test(companyId)) await guarded('commercial',async()=>{
    const prefix=`https://firestore.googleapis.com/v1/${base}/databases/(default)/documents`;
    const rawCoverage=await request(`${prefix}/companies/${companyId}/coverage/current`);
    if(!rawCoverage)return {status:'UNAVAILABLE',reason:'Coverage document unavailable'};
    const coverage=document(rawCoverage),ownerId=coverage.accountId;
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(ownerId??''))return {status:'WARN',reason:'Coverage owner ID invalid'};
    const rawSubscription=await request(`${prefix}/subscriptions/${ownerId}`);
    const resolved=resolveCommercial(rawSubscription?document(rawSubscription):undefined);
    let member=null;
    if(accountId && /^[A-Za-z0-9_-]{1,128}$/.test(accountId)) {
      const rawMember=await request(`${prefix}/companies/${companyId}/memberships/${accountId}`);
      if(rawMember){const value=document(rawMember);member={role:value.role??null,active:value.active===true,
        linkedWorkerId:value.workerId??null,proTeamInherited:!!value.proTeamSubscriptionId};}
    }
    return {status:'PASS',source:'privileged cloud documents + local commercial resolver; not client-callable authorization proof',
      coverage:{state:coverage.state??'active',sourceAccountId:ownerId,exportEndsAt:coverage.exportEndsAt??null},
      plan:resolved.plan,demoType:resolved.demoType,tierId:resolved.tierId,commercialStatus:resolved.status,
      capabilities:resolved.capabilities,role:member?.role??null,membershipActive:member?.active??null,
      linkedWorkerId:member?.linkedWorkerId??null,proTeamInherited:member?.proTeamInherited??null};
  });
  await guarded('recentErrors',async()=>{
    const data=await request(`https://logging.googleapis.com/v2/entries:list`,{method:'POST',body:{resourceNames:[base],
      filter:'resource.type="cloud_run_revision" AND severity>=WARNING',orderBy:'timestamp desc',pageSize:20}});
    return (data?.entries??[]).map(entry=>({timestamp:entry.timestamp??null,severity:entry.severity??null,
      service:entry.resource?.labels?.service_name??null,message:redactText(entry.textPayload??entry.jsonPayload?.message??'').slice(0,500)}));
  });
  if(inspection.functions?.some(item=>item.state!=='ACTIVE'))inspection.findings.push('One or more Functions are not ACTIVE');
  for(const service of inspection.cloudRun??[])if(!service.invokerIamDisabled||service.reconciling||service.iam?.allUsersRunInvoker)
    inspection.findings.push(`Cloud Run invocation configuration needs review: ${service.name}`);
  if(inspection.indexes?.indexes?.some(item=>item.state!=='READY'))inspection.findings.push('One or more configured Firestore indexes are not READY');
  if(inspection.revision?.status==='FAIL')inspection.findings.push('Current published revision metadata is incomplete');
  if(inspection.unavailable.length)inspection.status='WARN';
  if(inspection.findings.length)inspection.status='FAIL';
  return inspection;
}
