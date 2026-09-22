import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,open,realpath} from 'node:fs/promises';
import path from 'node:path';
import {demand,stableId} from './contract.js';
// Node 24 harness adapter. No dependency on the Windows author's database or filesystem.
export function nodeSqlite(filename,schema) {
  const db=new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  if(schema) db.exec(schema);
  const adapter={
    db,
    select:async(sql,values=[])=>sql.includes('$1')?db.prepare(sql).all({'$1':values[0]}):db.prepare(sql).all(...values),
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try {for(let i=0;i<statements.length;i++) {adapter.beforeStatement?.(i,statements[i]); db.prepare(statements[i].statement).run(...statements[i].values);} demand(db.prepare('PRAGMA foreign_key_check').all().length===0,'SQLite foreign key failure'); db.exec('COMMIT');}
      catch(error) {db.exec('ROLLBACK'); throw error;}
    },
    beforeStatement:null,
    close:()=>db.close()
  };
  return adapter;
}
export async function nodeFiles(directory) {
  await mkdir(directory,{recursive:true}); const root=await realpath(directory);
  const contained=absolute=>{const relative=path.relative(root,absolute); demand(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'Unsafe managed file path'); return absolute;};
  return {
    async read(relative) {demand(typeof relative==='string' && !path.isAbsolute(relative) && !relative.includes(':') && !relative.split(/[\\/]/).includes('..'),'Unsafe managed file path'); return new Uint8Array(await readFile(contained(await realpath(path.resolve(root,relative)))));},
    async stage(attempt,id,bytes) {
      stableId(attempt); stableId(id);
      const folder=contained(path.join(root,attempt)); await mkdir(folder,{recursive:true}); contained(await realpath(folder));
      const relative=`${attempt}/${id}.pdf`, handle=await open(contained(path.join(root,relative)),'wx');
      try {await handle.writeFile(bytes);await handle.sync();} finally {await handle.close();} return relative;
    }
  };
}
