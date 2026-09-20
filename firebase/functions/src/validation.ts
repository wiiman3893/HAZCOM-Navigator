// CODEX HANDOFF (2026-09-20): These validators define the tested wire projection for published revisions.
// Keep the Constellation SQLite/domain source artifacts unchanged; evolve this projection deliberately and update emulator tests with any schema change.

import { HttpsError } from 'firebase-functions/v2/https';

export function fail(message: string): never { throw new HttpsError('invalid-argument', message); }
export function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Expected an object.');
  return value as Record<string, any>;
}
export function keys(value: Record<string, any>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('Unexpected field.');
}
export function text(value: unknown, field: string, max = 200, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail(`Invalid ${field}.`);
  return value;
}
export function id(value: unknown): string {
  const result = text(value, 'stable ID', 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(result)) fail('Unsafe stable ID.');
  return result;
}
export function date(value: unknown): string {
  const result = text(value, 'date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0,10) !== result) fail('Invalid calendar date.');
  return result;
}
export const roles = ['administrator', 'manager', 'member'] as const;
export type Role = typeof roles[number];
export function role(value: unknown): Role {
  if (!roles.includes(value as Role)) fail('Invalid membership role.');
  return value as Role;
}
export function companyFields(value: unknown) {
  const data = object(value); keys(data, ['name', 'contact_email']);
  const name = text(data.name, 'Company name');
  const contact_email = text(data.contact_email, 'contact email', 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email)) fail('Invalid email.');
  return { name, contact_email };
}

// Wire projections preserve core entity fields; ownership/link tables become explicit foreign IDs.
const schemas: Record<string, { required: string[]; optional?: string[]; dates?: string[]; refs?: Record<string,string> }> = {
  workAreas: { required: ['name','location','poc_name','poc_email','poc_phone_number','description'] },
  chemicalProducts: { required: ['product_name','manufacturer','sds_date'], optional: ['chemical_names','cas_numbers'], dates: ['sds_date'] },
  workers: { required: ['name'], optional: ['email','phone'] },
  workAreaProducts: { required: ['quantity','storage_location','added_date','workAreaId','chemicalProductId'], dates: ['added_date'], refs: {workAreaId:'workAreas',chemicalProductId:'chemicalProducts'} },
  workAreaAssignments: { required: ['assigned_date','training_required_since','workAreaId','workerId'], optional: ['ended_date'], dates: ['assigned_date','training_required_since','ended_date'], refs: {workAreaId:'workAreas',workerId:'workers'} },
  sdsVerifications: { required: ['verified_at','chemicalProductId'], dates: ['verified_at'], refs: {chemicalProductId:'chemicalProducts'} },
  hazcomReviews: { required: ['review_date','workAreaId'], dates: ['review_date'], refs: {workAreaId:'workAreas'} },
  trainingEvents: { required: ['training_date','assignmentId'], dates: ['training_date'], refs: {assignmentId:'workAreaAssignments'} },
};
export const datasetKinds = Object.keys(schemas);
export function dataset(value: unknown): Record<string, Record<string, any>[]> {
  const input = object(value); keys(input, datasetKinds);
  if (Buffer.byteLength(JSON.stringify(input)) > 3_000_000) fail('Dataset exceeds 3 MB foundation limit.');
  const output: Record<string, Record<string, any>[]> = {};
  let total = 0;
  for (const [kind, schema] of Object.entries(schemas)) {
    const rows = input[kind] ?? [];
    if (!Array.isArray(rows) || (total += rows.length) > 350) fail('Dataset exceeds 350 record foundation limit.');
    const seen = new Set<string>();
    output[kind] = rows.map((raw: unknown) => {
      const row = object(raw); keys(row, ['id', ...schema.required, ...(schema.optional ?? [])]);
      const stableId = id(row.id);
      if (seen.has(stableId)) fail(`Duplicate ${kind} ID.`);
      seen.add(stableId);
      const result: Record<string, any> = { id: stableId };
      for (const field of [...schema.required, ...(schema.optional ?? [])]) {
        const v = row[field];
        if (v == null && schema.optional?.includes(field)) { result[field] = null; continue; }
        result[field] = schema.refs?.[field] ? id(v) : schema.dates?.includes(field) ? date(v) : text(v, field, field === 'description' ? 8000 : 1000, true);
      }
      return result;
    });
  }
  for (const [kind, schema] of Object.entries(schemas)) {
    for (const row of output[kind]) {
      for (const [field, target] of Object.entries(schema.refs ?? {})) {
        if (!output[target].some(r => r.id === row[field])) fail(`Broken ${kind}.${field} reference.`);
      }
      if (kind === 'workAreaAssignments' && row.ended_date && row.ended_date < row.assigned_date) fail('Assignment ends before it starts.');
      if (kind === 'trainingEvents') row.workerId = output.workAreaAssignments.find(a => a.id === row.assignmentId)!.workerId;
    }
  }
  return output;
}
