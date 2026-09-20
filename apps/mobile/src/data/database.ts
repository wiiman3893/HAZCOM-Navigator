import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import { INITIAL_SCHEMA_SQL, DERIVED_VIEWS_SQL } from '@hazcom/core';

const connection = new SQLiteConnection(CapacitorSQLite);
let dbPromise: Promise<SQLiteDBConnection> | null = null;

export function openMobileDatabase(): Promise<SQLiteDBConnection> {
  if (!dbPromise) dbPromise = (async () => {
    let db: SQLiteDBConnection;
    const exists = await connection.isConnection('hazcom-navigator', false);
    db = exists.result
      ? await connection.retrieveConnection('hazcom-navigator', false)
      : await connection.createConnection('hazcom-navigator', false, 'no-encryption', 1, false);
    await db.open();
    await db.execute('PRAGMA foreign_keys = ON;');
    const version = await db.query('PRAGMA user_version;');
    const current = Number(version.values?.[0]?.user_version ?? 0);
    if (current < 1) {
      await db.execute(INITIAL_SCHEMA_SQL);
      await db.execute(DERIVED_VIEWS_SQL);
      await db.execute('PRAGMA user_version = 2;');
    }
    return db;
  })();
  return dbPromise;
}

export async function localCompanySummary(): Promise<{companies:number;workAreas:number;chemicals:number}> {
  const db = await openMobileDatabase();
  const scalar = async (sql:string) => Number((await db.query(sql)).values?.[0]?.count ?? 0);
  return {
    companies: await scalar('SELECT COUNT(*) AS count FROM company WHERE deleted_at IS NULL'),
    workAreas: await scalar('SELECT COUNT(*) AS count FROM work_area WHERE deleted_at IS NULL'),
    chemicals: await scalar('SELECT COUNT(*) AS count FROM chemical_product WHERE deleted_at IS NULL'),
  };
}
