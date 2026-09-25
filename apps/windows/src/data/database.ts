import Database from '@tauri-apps/plugin-sql';
import { verifyCompany, type CompanyAccess } from '../auth/firebase';
import {verifyWindowsSdsIntegrity} from './publication-integrity';
import {buildPublication} from '@hazcom/sync';

const DATABASE_URL = 'sqlite:hazcom-navigator.db';
let dbPromise: Promise<Database> | null = null;

export function openDatabase(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DATABASE_URL).then(async db => {
      await db.execute('PRAGMA foreign_keys = ON');
      const rows = await db.select<Array<{ foreign_keys: number }>>('PRAGMA foreign_keys');
      if (rows[0]?.foreign_keys !== 1) throw new Error('SQLite foreign-key enforcement is disabled.');
      return db;
    });
  }
  return dbPromise;
}

export interface DashboardCounts {
  companies: number;
  workAreas: number;
  chemicalProducts: number;
  workers: number;
  assignments: number;
}

async function count(db: Database, sql: string, binds: unknown[] = []): Promise<number> {
  const rows = await db.select<Array<{ count: number }>>(sql, binds);
  return Number(rows[0]?.count ?? 0);
}

// CODEX HANDOFF: No SQLite load before live Google/Company authorization.
export async function getDashboardCounts(uid: string, company: CompanyAccess): Promise<DashboardCounts> {
  const verified = await verifyCompany(uid, company.id);
  if (verified.role === 'member') throw new Error('Company authoring access is required for local drafts.');
  const activeCompanyId = verified.id;
  const db = await openDatabase();
  await db.execute('INSERT INTO company (id,name,contact_email) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,contact_email=excluded.contact_email', [verified.id,verified.name,verified.contact_email]);
  return {
    companies: 1,
    workAreas: await count(db, `SELECT COUNT(*) AS count FROM work_area wa JOIN work_area__ownership o ON o.child_id=wa.id WHERE o.company_id=$1 AND wa.deleted_at IS NULL`, [activeCompanyId]),
    chemicalProducts: await count(db, `SELECT COUNT(*) AS count FROM chemical_product cp JOIN chemical_product__ownership o ON o.child_id=cp.id WHERE o.company_id=$1 AND cp.deleted_at IS NULL`, [activeCompanyId]),
    workers: await count(db, `SELECT COUNT(*) AS count FROM worker w JOIN worker__ownership o ON o.child_id=w.id WHERE o.company_id=$1 AND w.deleted_at IS NULL`, [activeCompanyId]),
    assignments: await count(db, `SELECT COUNT(*) AS count FROM work_area_assignment waa JOIN work_area_assignment__ownership ao ON ao.child_id=waa.id JOIN work_area__ownership wo ON wo.child_id=ao.work_area_id WHERE wo.company_id=$1 AND waa.deleted_at IS NULL`, [activeCompanyId]),
  };
}

export async function closeWorkspace(): Promise<void> {
  const pending = dbPromise; dbPromise = null;
  if (pending) { try { await (await pending).close(); } catch { /* Already closed or initialization failed. */ } }
}

// One Company-scoped SELECT; managed file reader is bounded to app attachments.
export async function buildWindowsPublication(uid:string,companyId:string,files:{read(path:string):Promise<Uint8Array>}) {
  const access=await verifyCompany(uid,companyId);
  if(access.role==='member')throw Error('Company authoring access required.');
  const db=await openDatabase();
  const projection=await buildPublication({select:(sql:string,values:unknown[])=>db.select(sql,values)},companyId,files);
  await verifyWindowsSdsIntegrity(projection.attachments,(sql,values)=>db.select(sql,values));
  return projection;
}
