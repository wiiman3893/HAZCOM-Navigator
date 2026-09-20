import type { IsoDate, WorkAreaAssignment } from './model.js';

export type RequirementStatus = 'current' | 'required';

function parseDateOnly(value: IsoDate): Date {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.valueOf())) throw new Error(`Invalid ISO date: ${value}`);
  return d;
}

export function addMonths(value: IsoDate, months: number): IsoDate {
  const d = parseDateOnly(value);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

export function latestDate(values: readonly IsoDate[]): IsoDate | null {
  if (!values.length) return null;
  return [...values].sort().at(-1)!;
}

export function nextReviewDue(reviewDates: readonly IsoDate[]): IsoDate | null {
  const latest = latestDate(reviewDates);
  return latest ? addMonths(latest, 12) : null;
}

export function verificationDue(verificationDates: readonly IsoDate[]): IsoDate | null {
  const latest = latestDate(verificationDates);
  return latest ? addMonths(latest, 6) : null;
}

export function timedRequirementStatus(nextDue: IsoDate | null, today: IsoDate): RequirementStatus {
  if (!nextDue) return 'required';
  return today >= nextDue ? 'required' : 'current';
}

export function trainingStatus(trainingRequiredSince: IsoDate, trainingDates: readonly IsoDate[]): RequirementStatus {
  const latest = latestDate(trainingDates);
  return latest && latest >= trainingRequiredSince ? 'current' : 'required';
}

export function newAssignment(id: string, assignedDate: IsoDate): WorkAreaAssignment {
  return { id, assigned_date: assignedDate, ended_date: null, training_required_since: assignedDate };
}

export function applyProductAddedRequirement(
  assignments: readonly WorkAreaAssignment[],
  addedDate: IsoDate,
): WorkAreaAssignment[] {
  return assignments.map(a => a.ended_date ? a : { ...a, training_required_since: addedDate });
}
