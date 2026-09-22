import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {buildPublication,publicationPlan,stagedLimits,parallel,receiver,verifyPublishedPlan,serverRows} from '../src/index.js';
test('Deterministic manifest/chunk assignment, byte bounds and schema mismatch',async()=>{
  const f=await fixture();
  try {
    const p=await buildPublication(f.sql,f.company.id,f.files),a=await publicationPlan(p,'revision',null,'creator');
    const reordered=structuredClone(p);for(const rows of Object.values(reordered.dataset))rows.reverse();reordered.attachments.reverse();
    assert.deepEqual(await publicationPlan(reordered,'revision',null,'creator'),a);
    for(let i=0;i<60;i++)p.dataset.workAreas.push({...p.dataset.workAreas[0],id:`wide-${String(i).padStart(3,'0')}`,description:'x'.repeat(8000)});
    const wide=await publicationPlan(p,'wide',null,'creator');assert(wide.chunks.filter(c=>c.descriptor.kind==='workAreas').length>1);assert(wide.chunks.every(c=>c.descriptor.bytes<=stagedLimits.chunkBytes&&c.descriptor.count<=100));
    const metadata={schemaVersion:2,companyId:a.manifest.companyId,revisionId:'revision',parentRevisionId:null,createdByAccountId:'creator',company:a.manifest.company,manifestHash:a.manifestHash,contentHash:a.manifest.contentHash};
    const original=await buildPublication(f.sql,f.company.id,f.files);
    // Reverse Firestore map key order to prove hashes do not depend on protobuf/map order.
    const reverse=value=>Array.isArray(value)?value.map(reverse):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reverse(v)])):value;
    await verifyPublishedPlan(reverse(a.manifest),metadata,serverRows(original.dataset),original.attachments);
    await assert.rejects(verifyPublishedPlan(a.manifest,{...metadata,manifestHash:'0'.repeat(64)},serverRows(original.dataset),original.attachments),/hash/);
    const client=receiver({replica:{state:async()=>null},files:{},transport:{access:async()=>({uid:'u',companyId:'c',active:true,role:'manager',workerId:null,currentRevisionId:'r',currentRevisionNumber:1}),metadata:async()=>({schemaVersion:99,status:'published'})}});
    await assert.rejects(client.sync('c'),/identity/);
  }finally{f.sql.close();}
});
test('Bounded concurrent workers drain in-flight requests after failure',async()=>{
  let active=0,peak=0,finished=0;
  await assert.rejects(parallel([0,1,2,3,4],2,async n=>{active++;peak=Math.max(peak,active);try{await new Promise(r=>setTimeout(r,n?10:1));if(n===0)throw Error('stop');finished++;}finally{active--;}}),/stop/);
  assert.equal(active,0);assert.equal(peak,2);assert.equal(finished,1);
});
