import test from 'node:test';
import assert from 'node:assert/strict';
import {DEVELOPMENT_CATALOG,resolveCommercial,mayAuthorCompany,mayCreateWithinLimit,enforcePublicationLimits,nextAnniversary,proratedCents,applyBillingEvent,cleanupEligible,backupDeliveryMode,issueBackupToken,redeemBackupToken,InMemoryBackupDelivery} from '../dist/index.js';

test('Company and Pro Demo are permanent, bounded, and cannot publish or invite',()=>{
  const company=resolveCommercial({plan:'demo',demoType:'company',selectedDemoCompanyId:'a'},Date.UTC(2100,0,1));
  assert.equal(company.status,'active');
  assert.deepEqual([company.capabilities.maxCoveredCompanies,company.capabilities.maxWorkersPerCompany,company.capabilities.maxChemicalProductsPerCompany,company.capabilities.maxWorkAreasPerCompany],[1,1,3,2]);
  assert.equal(company.capabilities.canPublish,false);
  assert.equal(company.capabilities.canInviteCompanyMembers,false);
  assert.equal(mayAuthorCompany(company,'a','a'),true);
  assert.equal(mayAuthorCompany(company,'b','a'),false);
  assert.equal(mayCreateWithinLimit(3,2),true);
  assert.equal(mayCreateWithinLimit(3,3),false);
  const pro=resolveCommercial({plan:'demo',demoType:'pro'},Date.UTC(2100,0,1));
  assert.deepEqual([pro.capabilities.maxCoveredCompanies,pro.capabilities.maxProSeats],[3,1]);
  assert.equal(mayAuthorCompany(pro,'b',null),true);
  assert.equal(pro.capabilities.canPublish,false);
  const demoState={subscriptionId:'demo-owner',plan:'demo',demoType:'pro',tierId:'demo_pro',catalogVersion:'v1',seatIds:['demo-owner'],coveredCompanyIds:[],lastVersion:0,appliedEventIds:[],audit:[]};
  assert.throws(()=>applyBillingEvent(demoState,{id:'fake-seat',type:'seat_added',subscriptionId:'demo-owner',version:1,effectiveAt:'2026-09-25T00:00:00Z',source:'mock',payload:{uid:'extra'}}),/seat limit/);
});

test('legacy plan names map without role or coverage mutation; paid grace is read/export only',()=>{
  const now=Date.UTC(2026,9,15),paidThrough=now+86400000;
  const legacy=resolveCommercial({plan:'customer',validUntil:paidThrough,graceUntil:paidThrough+14*86400000},now);
  assert.equal(legacy.plan,'company');
  assert.equal(legacy.capabilities.canPublish,true);
  const grace=resolveCommercial({plan:'professional',validUntil:paidThrough,graceUntil:paidThrough+14*86400000},paidThrough+1);
  assert.equal(grace.plan,'pro');
  assert.equal(grace.status,'grace');
  assert.equal(grace.capabilities.canAuthor,false);
  assert.equal(grace.capabilities.canPublish,false);
  assert.equal(grace.capabilities.canExportBackup,true);
  assert.equal(grace.capabilities.canReadPublished,true);
  assert.equal(resolveCommercial({plan:'company',paidThrough},paidThrough+15*86400000).status,'expired');
});

test('catalog limits and prices are versioned configuration',()=>{
  const custom={...DEVELOPMENT_CATALOG,company_small:{...DEVELOPMENT_CATALOG.company,id:'company_small',limits:{...DEVELOPMENT_CATALOG.company.limits,maxWorkersPerCompany:5}}};
  const resolved=resolveCommercial({plan:'company',tierId:'company_small',catalogVersion:'v1',paidThrough:'2027-01-01'},Date.UTC(2026,0,1),custom);
  assert.equal(resolved.capabilities.maxWorkersPerCompany,5);
  assert.equal(resolveCommercial({plan:'company',tierId:'company_small',catalogVersion:'v2',paidThrough:'2027-01-01'},Date.UTC(2026,0,1),custom).capabilities.canAuthor,false);
  enforcePublicationLimits(resolved.capabilities,{workers:5,chemicalProducts:100,workAreas:1});
  assert.throws(()=>enforcePublicationLimits(resolved.capabilities,{workers:6}),/workers/);
  assert.equal(DEVELOPMENT_CATALOG.company.monthlyUsdCents,1000);
});

test('anniversary dates and idempotent ordered billing events',()=>{
  assert.equal(nextAnniversary(new Date('2026-10-15T00:00:00Z'),'monthly').toISOString(),'2026-11-15T00:00:00.000Z');
  assert.equal(nextAnniversary(new Date('2026-10-15T00:00:00Z'),'annual').toISOString(),'2027-10-15T00:00:00.000Z');
  assert.equal(nextAnniversary(new Date('2026-01-31T00:00:00Z'),'monthly').toISOString(),'2026-02-28T00:00:00.000Z');
  const initial={subscriptionId:'s',plan:'demo',demoType:'company',catalogVersion:'v1',seatIds:['owner'],coveredCompanyIds:['a'],lastVersion:0,appliedEventIds:[],audit:[]};
  const event={id:'e1',type:'subscription_started',subscriptionId:'s',version:1,effectiveAt:'2026-10-15T00:00:00Z',source:'mock',payload:{tierId:'company',cadence:'monthly',priceVersion:'v1'}};
  const paid=applyBillingEvent(initial,event);
  assert.equal(paid.paidThrough,'2026-11-15T00:00:00.000Z');
  assert.equal(applyBillingEvent(paid,event),paid);
  assert.throws(()=>applyBillingEvent(paid,{...event,id:'e3',version:3}));
  const canceled=applyBillingEvent(paid,{...event,id:'e2',version:2,type:'subscription_cancel_at_period_end'});
  assert.equal(canceled.cancelAtPeriodEnd,true);
  assert.equal(resolveCommercial(canceled,Date.parse('2026-11-14T00:00:00Z')).capabilities.canAuthor,true);
  assert.equal(resolveCommercial(canceled,Date.parse('2026-11-16T00:00:00Z')).capabilities.canAuthor,false);
});

test('cleanup follows current coverage ownership',()=>{
  const old={subscriptionId:'pro-a',graceEndsAt:'2026-10-29T00:00:00Z'};
  const now=Date.parse('2026-10-30T00:00:00Z');
  assert.equal(cleanupEligible(old,{subscriptionId:'company-b'},now),false);
  assert.equal(cleanupEligible(old,{subscriptionId:'pro-a'},now),true);
  assert.equal(cleanupEligible(old,{subscriptionId:'pro-a'},Date.parse('2026-10-28T00:00:00Z')),false);
});

test('scheduled Pro downgrade applies only at renewal and retains the chosen Company',()=>{
 const initial={subscriptionId:'owner',plan:'pro',tierId:'pro',catalogVersion:'v1',cadence:'monthly',priceVersion:'v1',paidThrough:'2026-11-15T00:00:00Z',graceEndsAt:'2026-11-29T00:00:00Z',seatIds:['owner'],coveredCompanyIds:['a','b'],lastVersion:0,appliedEventIds:[],audit:[]};
 const scheduled=applyBillingEvent(initial,{id:'schedule',type:'subscription_downgrade_scheduled',subscriptionId:'owner',version:1,effectiveAt:'2026-10-20T00:00:00Z',source:'mock',payload:{tierId:'company',retainedCompanyId:'b'}});
 assert.equal(scheduled.plan,'pro');assert.deepEqual(scheduled.coveredCompanyIds,['a','b']);
 const renewed=applyBillingEvent(scheduled,{id:'renew',type:'subscription_renewed',subscriptionId:'owner',version:2,effectiveAt:'2026-11-15T00:00:00Z',source:'mock',payload:{priceVersion:'company-v1'}});
 assert.equal(renewed.plan,'company');assert.deepEqual(renewed.coveredCompanyIds,['b']);
 assert.equal(renewed.paidThrough,'2026-12-15T00:00:00.000Z');
 assert.equal(renewed.pendingDowngrade,undefined);
 assert.equal(proratedCents(1000,0,100,25),750);
});

test('upgrade and Pro seat events record provider-neutral proration quotes',()=>{
 const initial={subscriptionId:'owner',plan:'company',tierId:'company',catalogVersion:'v1',cadence:'monthly',priceVersion:'v1',termStartedAt:'2026-10-15T00:00:00Z',basePriceCents:1000,paidThrough:'2026-11-15T00:00:00Z',graceEndsAt:'2026-11-29T00:00:00Z',seatIds:[],coveredCompanyIds:['a'],lastVersion:0,appliedEventIds:[],audit:[]};
 const changedAt='2026-10-30T00:00:00Z',start=Date.parse(initial.termStartedAt),end=Date.parse(initial.paidThrough),change=Date.parse(changedAt);
 const pro=applyBillingEvent(initial,{id:'up',type:'subscription_upgrade',subscriptionId:'owner',version:1,effectiveAt:changedAt,source:'mock',payload:{tierId:'pro',cadence:'monthly'}});
 assert.equal(pro.paidThrough,initial.paidThrough);
 assert.equal(pro.billingAdjustments[0].creditCents,proratedCents(1000,start,end,change));
 assert.equal(pro.billingAdjustments[0].chargeCents,proratedCents(2500,start,end,change));
 const seat=applyBillingEvent(pro,{id:'seat',type:'seat_added',subscriptionId:'owner',version:2,effectiveAt:changedAt,source:'mock',payload:{uid:'colleague'}});
 assert.equal(seat.billingAdjustments[1].chargeCents,proratedCents(500,start,end,change));
 const annual=applyBillingEvent(initial,{id:'annual',type:'subscription_upgrade',subscriptionId:'owner',version:1,effectiveAt:changedAt,source:'mock',payload:{tierId:'pro',cadence:'annual'}});
 assert.equal(annual.billingAdjustments[0].creditCents,proratedCents(1000,start,end,change));
 assert.equal(annual.billingAdjustments[0].chargeCents,25000);
 assert.equal(annual.paidThrough,'2027-10-30T00:00:00.000Z');
});

test('backup delivery threshold and scoped, expiring single-purpose tokens',async()=>{
 assert.equal(backupDeliveryMode(15*1024*1024),'attachment');
 assert.equal(backupDeliveryMode(15*1024*1024+1),'link');
 const now=Date.UTC(2026,8,25),issued=await issueBackupToken('download_backup','company-a','BACKUP@example.test',now,60000);
 assert.equal(issued.record.email,'backup@example.test');
 await assert.rejects(redeemBackupToken(issued.record,issued.token,'download_backup','company-b',now));
 await assert.rejects(redeemBackupToken(issued.record,issued.token,'verify_backup_email','company-a',now));
 await assert.rejects(redeemBackupToken(issued.record,issued.token,'download_backup','company-a',now+60000));
 const consumed=await redeemBackupToken(issued.record,issued.token,'download_backup','company-a',now+1);
 await assert.rejects(redeemBackupToken(consumed,issued.token,'download_backup','company-a',now+2));
});

test('mock backup delivery attaches small packages and issues scoped one-use links for large packages',async()=>{
 const sent=[],delivery=new InMemoryBackupDelivery({send:async message=>sent.push(message)},4),now=Date.UTC(2026,8,25);
 const company={id:'company-a',backupEmail:'holder@example.test',backupEmailVerified:true,coverageStatus:'active'};
 await assert.rejects(delivery.deliverForVerifiedCompany(company,'other@example.test',new Uint8Array([1]),now));
 await assert.rejects(delivery.deliverForVerifiedCompany({...company,coverageStatus:'expired'},company.backupEmail,new Uint8Array([1]),now));
 await assert.rejects(delivery.deliverForVerifiedCompany({...company,backupEmailVerified:false},company.backupEmail,new Uint8Array([1]),now));
 assert.equal((await delivery.deliverForVerifiedCompany(company,company.backupEmail,new Uint8Array([1,2]),now)).mode,'attachment');
 assert.deepEqual(Array.from(sent[0].attachment),[1,2]);
 assert.equal(sent[0].token,undefined);
 assert.equal((await delivery.deliverForVerifiedCompany({...company,coverageStatus:'ending'},company.backupEmail,new Uint8Array([1,2,3,4,5]),now)).mode,'link');
 assert.equal(sent[1].attachment,undefined);
 await assert.rejects(delivery.download('company-b',sent[1].token,now));
 assert.deepEqual(Array.from(await delivery.download('company-a',sent[1].token,now)),[1,2,3,4,5]);
 await assert.rejects(delivery.download('company-a',sent[1].token,now));
 await delivery.deliver('company-a','holder@example.test',new Uint8Array([1,2,3,4,5]),now);
 await assert.rejects(delivery.download('company-a',sent[2].token,sent[2].expiresAt));
 assert.equal('role' in sent[2],false);
});
