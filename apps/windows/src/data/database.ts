import Database from '@tauri-apps/plugin-sql';

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

export async function getDashboardCounts(activeCompanyId?: string): Promise<DashboardCounts> {
  const db = await openDatabase();
  if (!activeCompanyId) {
    return {
      companies: await count(db, 'SELECT COUNT(*) AS count FROM company WHERE deleted_at IS NULL'),
      workAreas: 0, chemicalProducts: 0, workers: 0, assignments: 0,
    };
  }
  return {
    companies: 1,
    workAreas: await count(db, `SELECT COUNT(*) AS count FROM work_area wa JOIN work_area__ownership o ON o.child_id=wa.id WHERE o.company_id=$1 AND wa.deleted_at IS NULL`, [activeCompanyId]),
    chemicalProducts: await count(db, `SELECT COUNT(*) AS count FROM chemical_product cp JOIN chemical_product__ownership o ON o.child_id=cp.id WHERE o.company_id=$1 AND cp.deleted_at IS NULL`, [activeCompanyId]),
    workers: await count(db, `SELECT COUNT(*) AS count FROM worker w JOIN worker__ownership o ON o.child_id=w.id WHERE o.company_id=$1 AND w.deleted_at IS NULL`, [activeCompanyId]),
    assignments: await count(db, `SELECT COUNT(*) AS count FROM work_area_assignment waa JOIN work_area_assignment__ownership ao ON ao.child_id=waa.id JOIN work_area__ownership wo ON wo.child_id=ao.work_area_id WHERE wo.company_id=$1 AND waa.deleted_at IS NULL`, [activeCompanyId]),
  };
}

export async function listCompanies(): Promise<Array<{id:string;name:string;contact_email:string}>> {
  const db = await openDatabase();
  return db.select('SELECT id,name,contact_email FROM company WHERE deleted_at IS NULL ORDER BY name');
}
