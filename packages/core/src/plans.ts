export interface BillingOption { cadence: 'monthly' | 'annual'; usd: number; }
export interface PlanDefinition {
  id: 'customer' | 'professional';
  name: string;
  billing: readonly BillingOption[];
  maxOrganizations: number;
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
    id:'customer', name:'Company',
    billing:[{cadence:'monthly',usd:DEVELOPMENT_CATALOG.company.monthlyUsdCents!/100},{cadence:'annual',usd:DEVELOPMENT_CATALOG.company.annualUsdCents!/100}],
    maxOrganizations:DEVELOPMENT_CATALOG.company.limits.maxCoveredCompanies, mayCreateOrganization:true, autoCoverCreated:true,
    transferAllowed:true, preserveMembershipsOnTransfer:true,
    initialRole:'administrator', graceDays:14, expiration:'export-only',
    backupRetentionDaysAfterNonpayment:14,
  },
  {
    id:'professional', name:'Pro',
    billing:[{cadence:'monthly',usd:DEVELOPMENT_CATALOG.pro.monthlyUsdCents!/100},{cadence:'annual',usd:DEVELOPMENT_CATALOG.pro.annualUsdCents!/100}],
    maxOrganizations:DEVELOPMENT_CATALOG.pro.limits.maxCoveredCompanies, mayCreateOrganization:true, autoCoverCreated:true,
    transferAllowed:true, preserveMembershipsOnTransfer:true,
    initialRole:'manager', graceDays:14, expiration:'export-only',
    backupRetentionDaysAfterNonpayment:14,
  },
]);
import { DEVELOPMENT_CATALOG } from './commercial.js';
/** @deprecated Compatibility display data for old development plan IDs. Resolve capabilities through commercial.ts. */
