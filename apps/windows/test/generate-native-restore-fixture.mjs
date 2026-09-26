import {readFile,writeFile} from 'node:fs/promises';
import {fixture} from '../../../packages/sync/test/fixtures.mjs';
import {exportCompanyBackup,prepareNativeCompanyRestore} from '../../../packages/sync/src/backup.js';

const migration=await readFile(new URL('../../../database/migrations/003_authoring.sql',import.meta.url),'utf8');
const source=await fixture('small','native-restore-proof');
try{
 source.sql.db.exec(migration);
 const backup=await exportCompanyBackup(source.sql,source.files,source.company.id);
 backup.manifest.createdAt='2026-09-26T00:00:00.000Z';
 const plan=await prepareNativeCompanyRestore(backup);
 await writeFile(new URL('./native-restore-plan.json',import.meta.url),JSON.stringify(plan)+'\n');
}finally{source.sql.close();}
