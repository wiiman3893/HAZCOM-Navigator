import assert from 'node:assert/strict';
import {
  addMonths, applyProductAddedRequirement, findPermission, isEventMutationAllowed,
  newAssignment, nextReviewDue, timedRequirementStatus, trainingStatus, verificationDue, PLANS
} from '../dist/index.js';

assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
assert.equal(nextReviewDue(['2025-09-20']), '2026-09-20');
assert.equal(timedRequirementStatus('2026-09-20','2026-09-19'), 'current');
assert.equal(timedRequirementStatus('2026-09-20','2026-09-20'), 'required');
assert.equal(verificationDue(['2026-03-20']), '2026-09-20');
assert.equal(trainingStatus('2026-09-01',['2026-08-30']), 'required');
assert.equal(trainingStatus('2026-09-01',['2026-09-01']), 'current');
const a = newAssignment('a1','2026-09-01');
assert.equal(a.training_required_since,'2026-09-01');
const updated = applyProductAddedRequirement([a,{...a,id:'a2',ended_date:'2026-09-10'}],'2026-09-20');
assert.equal(updated[0].training_required_since,'2026-09-20');
assert.equal(updated[1].training_required_since,'2026-09-01');
assert.equal(findPermission('member','read','chemical_product')?.scope,'own-organization');
assert.equal(findPermission('member','create','training_event')?.scope,'related-to-linked-business-record');
assert.equal(isEventMutationAllowed('update','training_event'), false);
assert.equal(PLANS.find(p=>p.id==='professional')?.maxOrganizations,25);
assert.equal(PLANS.find(p=>p.id==='professional')?.name,'Pro');
console.log('HazCom core tests passed.');
