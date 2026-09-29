import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {makeZip} from './report.mjs';
import {validateSessionPackage} from './session-package.mjs';
import {createHash} from 'node:crypto';
const contract=JSON.parse(await readFile(new URL('../../apps/windows/src/diagnostics/contract.json',import.meta.url)));
let source=await readFile(new URL('../../apps/windows/src/diagnostics/session.ts',import.meta.url),'utf8');
// Only replace platform transport/imports; exercise the production session logic.
source=source.replace("import {invoke,isTauri} from '@tauri-apps/api/core';","const invoke=(...args)=>globalThis.diagnosticTransport(...args);const isTauri=()=>true;").replace("import contract from './contract.json';",`const contract=${JSON.stringify(contract)};`);
const module=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
const {DiagnosticClient,safeEvent,reasonCode,diagnosticHotkey,instrumentAuthoring,diagnostics}=module;
function harness(){let active=null,events=[],marks=0;const sessions=[];const transport=async(command,args)=>{if(command==='diagnostic_start'){assert.equal(active?.state==='active',false);active={sessionId:'diag_'+'a'.repeat(32),state:'active',startedMs:Date.now(),eventCount:0,droppedEvents:0};}if(command==='diagnostic_status')return {current:active,sessions,failure:null};if(command==='diagnostic_events')events.push(...args.events);if(command==='diagnostic_mark')marks++;if(command==='diagnostic_stop'){active.state='stopped';sessions.push(active);}};return {transport,get events(){return events;},get marks(){return marks;}};}
test('manual lifecycle, exact hotkeys, marker and bounded client queue',async()=>{
 const h=harness(),client=new DiagnosticClient(h.transport);await client.refresh();assert.equal(client.active,false);
 const key={ctrlKey:true,shiftKey:true,altKey:true,metaKey:false,repeat:false,isComposing:false,code:'KeyD'};assert.equal(diagnosticHotkey(key,false),'open');assert.equal(client.active,false);
 for(const change of [{ctrlKey:false},{shiftKey:false},{altKey:false},{metaKey:true},{repeat:true},{isComposing:true}])assert.equal(diagnosticHotkey({...key,...change},false),null);
 assert.equal(diagnosticHotkey({...key,altKey:false,code:'KeyM'},false),null);await client.start();assert.equal(client.active,true);assert.equal(diagnosticHotkey({...key,altKey:false,code:'KeyM'},true),'mark');
 for(let i=0;i<400;i++)client.emit('worker.create','succeeded',{entity:'id'});await client.mark();assert.equal(h.marks,1);assert(h.events.length<=257);await client.stop();assert.equal(client.active,false);
});
test('privacy allowlist, raw errors omitted, failure isolation preserves result and original error',async()=>{
 const secrets=JSON.parse(await readFile(new URL('./privacy-sentinels.json',import.meta.url)));
 for(const secret of secrets){const e=safeEvent('worker.update','failed',{screen:secret,phase:secret,reason:secret,fields:[secret,'email'],role:secret,message:secret,token:secret});assert(!JSON.stringify(e).includes(secret));assert.equal(reasonCode(Error(secret)),'OPERATION_FAILED');}
 const client=new DiagnosticClient(async()=>{throw Error(secrets[0]);});client.status.current={state:'active'};const expected={saved:true};assert.equal(await client.observe('worker.create',async()=>expected),expected);await client.flush();assert(client.failure);const error=Error('original');await assert.rejects(client.observe('publication',async()=>{throw error;}),e=>e===error);await client.flush();
});
test('representative domain service outcomes are instrumented without record contents',async()=>{
 const h=harness();globalThis.diagnosticTransport=h.transport;await diagnostics.start();
 const methods=['snapshot','create','update','trash','importSds','readSds','unlinkSds','importSdsBatch','ocrSdsImportPage','processSdsImportOcr','splitSdsImportDraft','mergeSdsImportDraft','saveSdsImportDrafts','reviewSdsImportCandidate','approveSdsImportCandidate'];const s=instrumentAuthoring(Object.fromEntries(methods.map(m=>[m,async()=>42])));
 for(const kind of ['work_area','chemical_product','worker','work_area_product','work_area_assignment','sds_verification','hazcom_review','training_event'])await s.create(kind,{name:'PRIVATE RECORD'},'stable-id');
 await s.update('worker','stable-id',{email:'private@example.test'});await s.trash('worker','stable-id');await s.trash('worker','stable-id',true);await s.importSds('product',new Uint8Array([37,80,68,70]),'PRIVATE.pdf');for(const method of methods.filter(m=>!['create','update','trash','importSds'].includes(m)))await s[method]('id');await s.approveSdsImportCandidate('id',{action:'update',productId:'private-product'});
 await diagnostics.stop();assert(h.events.some(e=>e.operation==='training_event.create'&&e.outcome==='succeeded'));assert(h.events.some(e=>e.operation==='worker.restore'));assert(h.events.some(e=>e.operation==='sds_batch.product_created'));assert(h.events.some(e=>e.operation==='sds_batch.product_updated'));assert(!JSON.stringify(h.events).includes('PRIVATE'));assert(!JSON.stringify(h.events).includes('private@example.test'));assert(!JSON.stringify(h.events).includes('private-product'));
});
test('session package validator rejects corruption, traversal and wrong identity',()=>{
 const id='diag_'+'a'.repeat(32),events=JSON.stringify({schemaVersion:1,sessionId:id,sequence:1,timestampMs:1,event:{operation:'diagnostics',outcome:'stopped'}})+'\n';const manifest={packageType:'hazcom-diagnostic-session',schemaVersion:1,sessionId:id,state:'stopped',screenshots:false,screenshotCount:0,eventCount:1};const summary={sessionId:id,eventCount:1,eventsSha256:createHash('sha256').update(events).digest('hex'),eventsBytes:Buffer.byteLength(events)};const zip=makeZip({'manifest.json':JSON.stringify(manifest),'app-events.jsonl':events,'summary.json':JSON.stringify(summary)});assert.equal(validateSessionPackage(zip).eventCount,1);const corrupt=Buffer.from(zip);corrupt[55]^=1;assert.throws(()=>validateSessionPackage(corrupt));assert.throws(()=>makeZip({'../secret':'x'}));manifest.sessionId='wrong';assert.throws(()=>validateSessionPackage(makeZip({'manifest.json':JSON.stringify(manifest),'app-events.jsonl':events,'summary.json':JSON.stringify(summary)})));
});
