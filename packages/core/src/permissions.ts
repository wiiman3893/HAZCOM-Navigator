export type MembershipRole = 'administrator' | 'manager' | 'member';
export type CrudVerb = 'create' | 'read' | 'update' | 'delete';
export type EntityKey =
  | 'company'
  | 'work_area'
  | 'chemical_product'
  | 'worker'
  | 'sds_verification'
  | 'training_event'
  | 'work_area_product'
  | 'work_area_assignment'
  | 'hazcom_review';

export type RecordScope =
  | 'own-organization'
  | 'my-linked-business-record'
  | 'related-to-linked-business-record';

export interface PermissionRule {
  role: MembershipRole;
  verb: CrudVerb;
  entity: EntityKey;
  scope: RecordScope;
  path?: string;
}

const managerDomain: EntityKey[] = [
  'work_area','chemical_product','worker','sds_verification','training_event',
  'work_area_product','work_area_assignment','hazcom_review'
];

const rules: PermissionRule[] = [];
for (const role of ['administrator','manager'] as const) {
  rules.push({ role, verb: 'read', entity: 'company', scope: 'own-organization' });
  for (const entity of managerDomain) {
    rules.push({ role, verb: 'create', entity, scope: 'own-organization' });
    rules.push({ role, verb: 'read', entity, scope: 'own-organization' });
    if (!['sds_verification','training_event','hazcom_review'].includes(entity)) {
      rules.push({ role, verb: 'update', entity, scope: 'own-organization' });
      rules.push({ role, verb: 'delete', entity, scope: 'own-organization' });
    }
  }
}
rules.push({ role:'administrator', verb:'update', entity:'company', scope:'own-organization' });
rules.push({ role:'member', verb:'read', entity:'company', scope:'own-organization' });
rules.push({ role:'member', verb:'read', entity:'chemical_product', scope:'own-organization' });
rules.push({ role:'member', verb:'read', entity:'work_area', scope:'own-organization' });
rules.push({ role:'member', verb:'read', entity:'work_area_product', scope:'own-organization' });
rules.push({ role:'member', verb:'read', entity:'worker', scope:'my-linked-business-record' });
rules.push({ role:'member', verb:'read', entity:'work_area_assignment', scope:'related-to-linked-business-record', path:'Worker ↔ Work Area Assignment' });
rules.push({ role:'member', verb:'read', entity:'training_event', scope:'related-to-linked-business-record', path:'Worker ↔ Work Area Assignment → Training Event' });
rules.push({ role:'member', verb:'create', entity:'training_event', scope:'related-to-linked-business-record', path:'Worker ↔ Work Area Assignment → Training Event' });

export const PERMISSION_RULES = Object.freeze(rules);

export function findPermission(role: MembershipRole, verb: CrudVerb, entity: EntityKey): PermissionRule | undefined {
  return PERMISSION_RULES.find(r => r.role === role && r.verb === verb && r.entity === entity);
}

export function isEventMutationAllowed(verb: CrudVerb, entity: EntityKey): boolean {
  if (!['sds_verification','training_event','hazcom_review'].includes(entity)) return true;
  return verb === 'create' || verb === 'read';
}

export const ADMINISTRATIVE_AUTHORITIES = Object.freeze([
  'invite-manage-accounts',
  'add-remove-memberships',
  'assign-remove-membership-roles',
  'manage-company-settings',
] as const);
