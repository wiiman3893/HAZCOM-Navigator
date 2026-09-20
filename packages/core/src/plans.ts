export interface BillingOption { cadence: 'monthly' | 'annual'; usd: number; }
export interface PlanDefinition {
  id: 'customer' | 'professional';
  name: string;
  billing: readonly BillingOption[];
  maxOrganizations: number | 'unlimited';
  mayCreateOrganization: true;
  autoCoverCreated: true;
  transferAllowed: true;
  preserveMembershipsOnTransfer: true;
  initialRole: 'administrator' | 'manager';
  graceDays: 14;
  expiration: 'export-only';
  backupRetentionDaysAfterNonpayment: 14;
}

export const PLANS: readonly PlanDefinition[] = Object.freeze([
  {
    id:'customer', name:'Customer Plan',
    billing:[{cadence:'monthly',usd:10},{cadence:'annual',usd:100}],
    maxOrganizations:1, mayCreateOrganization:true, autoCoverCreated:true,
    transferAllowed:true, preserveMembershipsOnTransfer:true,
    initialRole:'administrator', graceDays:14, expiration:'export-only',
    backupRetentionDaysAfterNonpayment:14,
  },
  {
    id:'professional', name:'Professional Plan',
    billing:[{cadence:'monthly',usd:25},{cadence:'annual',usd:250}],
    maxOrganizations:'unlimited', mayCreateOrganization:true, autoCoverCreated:true,
    transferAllowed:true, preserveMembershipsOnTransfer:true,
    initialRole:'manager', graceDays:14, expiration:'export-only',
    backupRetentionDaysAfterNonpayment:14,
  },
]);
