import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {authoringService} from '../../../packages/authoring/src/index.js';
import {nodeSqlite,nodeFiles} from '../../../packages/sync/src/node.js';
import {REPLICA_SCHEMA_SQL} from '../../../packages/sync/src/sqlite.js';
import {buildPublication,publicationPlan} from '../../../packages/sync/src/index.js';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const folder=await mkdtemp(path.join(tmpdir(),'hazcom-ui-'));
const sql=nodeSqlite(path.join(folder,'ui.db'),REPLICA_SCHEMA_SQL+await readFile(path.join(repo,'database/migrations/003_authoring.sql'),'utf8')+await readFile(path.join(repo,'database/migrations/004_bulk_sds_import.sql'),'utf8')),files=await nodeFiles(path.join(folder,'attachments'));
for(const id of ['ui-company','empty-company'])sql.db.prepare('INSERT INTO company(id,name,contact_email) VALUES (?,?,?)').run(id,id,'safety@example.test');
const service=(companyId,role)=>authoringService({sql,files,companyId,authorize:async()=>({companyId,role,active:true})});
const services=new Map();const get=(c,r)=>{const key=c+'/'+r;if(!services.has(key))services.set(key,service(c,r));return services.get(key);};
const published=new Map();
const s=get('ui-company','manager');
await s.create('work_area',{name:'Maintenance Shop',location:'Building A',poc_name:'Safety Lead',poc_email:'safety@example.test',poc_phone_number:'555-0100',description:'Synthetic test area'},'ui-area');
await s.create('chemical_product',{product_name:'Synthetic Cleaner',chemical_names:'Acetone',cas_numbers:'67-64-1',manufacturer:'Example manufacturer',sds_date:'2026-01-01'},'ui-chemical');
await s.create('worker',{name:'Synthetic Worker',email:'worker@example.test',phone:''},'ui-worker');
const server=await createServer({configFile:false,root:path.join(repo,'apps/windows/test/ui'),plugins:[react(),{name:'synthetic-publication-api',configureServer(server){server.middlewares.use('/publication-api',async(req,res)=>{
 try{
  if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:1435'||req.headers['content-type']!=='application/json')throw Error('Local test origin required');
  let body='';for await(const chunk of req){body+=chunk;if(body.length>1024*1024)throw Error('Request too large');}
  const {companyId,role,entitlement,method,revisionId,parentRevisionId,fingerprint}=JSON.parse(body);
  if(!['ui-company','empty-company'].includes(companyId)||!['manager','administrator','member'].includes(role)||!['paid','company-demo','pro-demo','grace','expired'].includes(entitlement))throw Error('Invalid test context');
  const current=published.get(companyId)??null;
  let value;
  if(method==='context')value={uid:'synthetic-user',companyId,companyName:companyId,companyEmail:'safety@example.test',role,canPublish:entitlement==='paid',coverageStatus:entitlement==='grace'?'grace':entitlement==='expired'?'expired':'active',currentRevisionId:current?.revisionId??null,currentRevisionNumber:current?.revisionNumber??null,published:current};
  else if(method==='projection')value=await buildPublication(sql,companyId,files);
  else if(method==='publish'){
   if(role==='member'||entitlement!=='paid')throw Error('Publication denied');
   const projection=await buildPublication(sql,companyId,files);
   if(projection.fingerprint!==fingerprint)throw Error('Local draft changed');
   if(current?.revisionId===revisionId)value={revisionId,revisionNumber:current.revisionNumber};
   else{
    if((current?.revisionId??null)!==parentRevisionId)throw Error('Stale parent revision');
    const plan=await publicationPlan(projection,revisionId,parentRevisionId,'synthetic-user');
    value={revisionId,revisionNumber:(current?.revisionNumber??0)+1};
    published.set(companyId,{...value,publishedAt:'2026-09-25T00:00:00.000Z',recordCounts:Object.fromEntries(Object.entries(projection.dataset).map(([k,v])=>[k,v.length])),attachmentCount:projection.attachments.length,fingerprint:null,manifestHash:plan.manifestHash,contentHash:plan.manifest.contentHash});
   }
  }else throw Error('Invalid publication method');
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
 }catch(e){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}
 });}},{name:'isolated-authoring-test-api',configureServer(server){server.middlewares.use('/authoring-api',async(req,res)=>{
 try{if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:1435'||req.headers['content-type']!=='application/json')throw Error('Local test origin required');let text='';for await(const chunk of req){text+=chunk;if(text.length>24*1024*1024)throw Error('Request too large');}const {companyId,role,method,args}=JSON.parse(text);if(!['ui-company','empty-company'].includes(companyId)||!['manager','administrator','member'].includes(role)||!['snapshot','create','update','trash','importSds','unlinkSds','readSds','importSdsBatch','splitImportDraft','mergeImportDraft','readImportSource','saveImportReview','readImportDraft'].includes(method))throw Error('Invalid test request');if(method==='importSds')args[1]=new Uint8Array(args[1]);if(method==='importSdsBatch')args[0]=new Uint8Array(args[0]);const value=await get(companyId,role)[method](...args);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value instanceof Uint8Array?Array.from(value):value??null));}catch(e){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:e.message}));}
 });}}],server:{host:'127.0.0.1',port:1435,strictPort:true,fs:{allow:[repo]}}});
await server.listen();console.log('Synthetic authoring UI at http://127.0.0.1:1435');
