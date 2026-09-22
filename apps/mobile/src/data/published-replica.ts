import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { digest, REPLICA_SCHEMA_SQL, receiver, sqliteReplica, stableId } from '@hazcom/sync';
import { firebaseTransport } from '@hazcom/sync/firebase';

const connections=new SQLiteConnection(CapacitorSQLite);
// A new database per authenticated account and Company; never opens the author or demo DB.
export async function openPublishedReplica(firebase:Parameters<typeof firebaseTransport>[0],companyId:string) {
  const transport=firebaseTransport(firebase), access=await transport.access(companyId);
  if(!access.active)throw Error('Active Company membership required.');
  const name=`hazcom-replica-${(await digest([access.uid,companyId])).slice(0,32)}`;
  const exists=await connections.isConnection(name,false);
  const db=exists.result?await connections.retrieveConnection(name,false):await connections.createConnection(name,false,'no-encryption',1,false);
  await db.open();await db.execute('PRAGMA foreign_keys=ON;');
  const fk=await db.query('PRAGMA foreign_keys');if(fk.values?.[0]?.foreign_keys!==1)throw Error('SQLite foreign keys must be enabled.');
  const schema=await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='replica_state'");
  if(!schema.values?.length)await db.execute(REPLICA_SCHEMA_SQL,true);
  // Native SQLite is also a private, durable SDS store. This avoids an additional mobile
  // filesystem plugin and keeps staged files separate from the active canonical records.
  await db.execute('CREATE TABLE IF NOT EXISTS replica_files(path TEXT PRIMARY KEY,base64 TEXT NOT NULL)');
  const sql={select:async(statement:string,values:unknown[]=[])=> (await db.query(statement,values)).values??[],batch:async(statements:Array<{statement:string;values:unknown[]}>)=>{await db.executeSet(statements,true);}};
  const files={
    async read(path:string){const rows=await sql.select('SELECT base64 FROM replica_files WHERE path=?',[path]);if(rows.length!==1)throw Error('Missing local SDS');return Uint8Array.from(atob(rows[0].base64),c=>c.charCodeAt(0));},
    async stage(attempt:string,id:string,bytes:Uint8Array){stableId(attempt);stableId(id);const path=`${attempt}/${id}.pdf`;let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));await sql.batch([{statement:'INSERT INTO replica_files VALUES (?,?)',values:[path,btoa(text)]}]);return path;}
  };
  const replica=sqliteReplica(sql), service=receiver({transport,replica,files});
  return {
    sync:()=>service.sync(companyId),
    syncTraining:()=>service.syncTraining(companyId),
    // Consumers obtain data only after refreshing live membership and matching stored scope.
    async readActive(){const current=await transport.access(companyId);if(!current.active)throw Error('Company access revoked');await replica.assertReadable(current);return {sql,files};},
    close:()=>connections.closeConnection(name,false)
  };
}
