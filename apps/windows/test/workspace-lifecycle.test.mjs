import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceLifecycle} from '../src/data/workspace-lifecycle.ts';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()};};
test('duplicate startup effects share one activation while a new auth generation gets its own',async()=>{
 const lifecycle=new WorkspaceLifecycle(),gate=deferred();let calls=0;
 const work=async()=>{calls++;await gate.promise;return calls;};
 const first=lifecycle.open('account/company',work),second=lifecycle.open('account/company',work);
 assert.equal(first,second);await Promise.resolve();assert.equal(calls,1);
 await lifecycle.close(async()=>{});const fresh=lifecycle.open('account/company',work);assert.notEqual(fresh,first);
 gate.resolve();await Promise.all([first,second,fresh]);assert.equal(calls,2);
});
test('pending native activation excludes backup/publication pins before and during its await',async()=>{
 const lifecycle=new WorkspaceLifecycle(),native=deferred();
 const change=lifecycle.change(()=>native.promise);
 assert.throws(()=>lifecycle.pin(),/changing/);
 await Promise.resolve();assert.throws(()=>lifecycle.pin(),/changing/);
 native.resolve();await change;const release=lifecycle.pin();
 await assert.rejects(lifecycle.change(async()=>{}),/Finish/);release();release();
 await lifecycle.change(async()=>{});
});
test('failed switches drain, concurrent selections serialize and close invalidates delayed work',async()=>{
 const lifecycle=new WorkspaceLifecycle(),gate=deferred(),events=[];
 const first=lifecycle.change(async run=>{events.push('first');await gate.promise;assert.notEqual(run,lifecycle.generation);throw Error('stale');});
 const rejection=assert.rejects(first,/stale/);
 const second=lifecycle.change(async run=>{events.push('second');assert.notEqual(run,lifecycle.generation);});
 const closed=lifecycle.close(async()=>{events.push('closed');});
 gate.resolve();await rejection;await second;await closed;
 assert.deepEqual(events,['first','second','closed']);
 const release=lifecycle.pin();release();await lifecycle.change(async()=>events.push('new'));assert.equal(events.at(-1),'new');
});
test('security close is permitted during a pinned operation without allowing a replacement pin',async()=>{
 const lifecycle=new WorkspaceLifecycle(),release=lifecycle.pin(),gate=deferred();
 const closed=lifecycle.close(()=>gate.promise);assert.equal(lifecycle.generation,1);
 assert.throws(()=>lifecycle.pin(),/changing/);gate.resolve();await closed;release();
 await lifecycle.change(async()=>{});
});
