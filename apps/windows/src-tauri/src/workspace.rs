//! Explicit native sessions. A switch holds the same lock as SQL/file operations;
//! old leases can never be redirected to the newly selected database.
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sqlx::{Column, Row, TypeInfo, ValueRef, SqlitePool};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::{fs, path::{Path, PathBuf}};
use tauri::Manager;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct WorkspaceState(pub Mutex<Option<Session>>);
pub enum Authority { Online, Offline{expires_at:i64,last_observed:i64,cache_root:PathBuf} }
pub struct Session { pub lease: Lease, pub pool: SqlitePool, pub files: PathBuf, journal:PathBuf, authority:Authority }
#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Lease { pub workspace_id:String, pub company_id:String, pub token:String, pub read_only:bool, pub selection_warning:Option<String> }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Entry { workspace_id:String, company_id:String, kind:String, available:bool, reason:Option<String> }
#[derive(Deserialize)]
pub struct Statement { statement:String, values:Vec<Value> }

pub fn valid_id(id:&str)->bool { !id.is_empty()&&id.len()<=128&&id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_') }
fn inside(root:&Path,path:&Path)->Result<PathBuf,String>{
 let root=root.canonicalize().map_err(|e|e.to_string())?;
 let path=path.canonicalize().map_err(|e|e.to_string())?;
 if !path.starts_with(root){return Err("WORKSPACE_PATH_ESCAPE".into());} Ok(path)
}
pub fn checked<'a>(session:&'a Option<Session>,token:&str)->Result<&'a Session,String>{
 session.as_ref().filter(|s|s.lease.token==token).ok_or_else(||"WORKSPACE_SESSION_STALE".into())
}
fn authority_writable(value:&mut Session)->Result<(),String>{
 if value.lease.read_only{return Err("WORKSPACE_EXPORT_ONLY".into());}
 if let Authority::Offline{expires_at,last_observed,cache_root}=&mut value.authority{let at=crate::offline_lease::now();let observed=crate::offline_lease::record_observed(cache_root,at)?;if at+300<observed||at>=*expires_at{value.lease.read_only=true;return Err("WORKSPACE_OFFLINE_AUTHORIZATION_EXPIRED".into());}*last_observed=observed;}
 Ok(())
}
pub fn checked_writable<'a>(session:&'a mut Option<Session>,token:&str)->Result<&'a mut Session,String>{
 let value=session.as_mut().filter(|s|s.lease.token==token).ok_or_else(||"WORKSPACE_SESSION_STALE".to_string())?;
 authority_writable(value)?;
 Ok(value)
}
pub fn checked_online_writable<'a>(session:&'a mut Option<Session>,token:&str)->Result<&'a mut Session,String>{let value=checked_writable(session,token)?;if !matches!(value.authority,Authority::Online){return Err("WORKSPACE_ONLINE_AUTHORIZATION_REQUIRED".into());}Ok(value)}
fn bind<'q>(sql:&'q str,values:Vec<Value>)->Result<sqlx::query::Query<'q,sqlx::Sqlite,sqlx::sqlite::SqliteArguments<'q>>,String>{
 let mut query=sqlx::query(sql);
 for value in values {query=match value {
  Value::Null=>query.bind(None::<String>),Value::String(v)=>query.bind(v),Value::Bool(v)=>query.bind(v),
  Value::Number(v)=>if let Some(i)=v.as_i64(){query.bind(i)}else{query.bind(v.as_f64().ok_or("Invalid SQL number")?)},
  _=>return Err("Invalid SQL value".into())
 };} Ok(query)
}
async fn registry(root:&Path)->Result<SqlitePool,String>{
 fs::create_dir_all(root).map_err(|e|e.to_string())?;
 let path=root.join("workspace-registry.db");
 if path.exists(){inside(root,&path)?;}
 let pool=SqlitePoolOptions::new().max_connections(1).connect_with(SqliteConnectOptions::new().filename(path).create_if_missing(true)).await.map_err(|e|e.to_string())?;
 if let Err(e)=sqlx::query("CREATE TABLE IF NOT EXISTS selections(account_id TEXT NOT NULL,company_id TEXT NOT NULL,workspace_id TEXT NOT NULL,PRIMARY KEY(account_id,company_id))").execute(&pool).await {pool.close().await;return Err(e.to_string());}
 Ok(pool)
}
async fn prepare(config:&Path,data:&Path,id:&str,company:&str,read_only:bool,authority:Authority)->Result<Session,String>{
 if !valid_id(company){return Err("WORKSPACE_COMPANY_INVALID".into());}
 let (path,files)=if id=="primary" {
  fs::create_dir_all(config).map_err(|e|e.to_string())?;
  let path=config.join("hazcom-navigator.db");if path.exists()&&inside(config,&path)?!=config.canonicalize().map_err(|e|e.to_string())?.join("hazcom-navigator.db"){return Err("WORKSPACE_DATABASE_ALIAS".into());}
  (path,data.join("attachments"))
 }else{
  let directory=id.strip_prefix("restored-").filter(|id|valid_id(id)).ok_or("WORKSPACE_ID_INVALID")?;
  let root=data.join("restored-workspaces");
  super::backup_restore::inspect_workspace(&root,directory,company.to_string()).await?;
  let active=inside(&root,&root.join(directory).join("active"))?;
  (inside(&active,&active.join("workspace.db"))?,inside(&active,&active.join("attachments"))?)
 };
 let journal=if id=="primary"{config.join("hazcom-publication-journal.db")}else{path.parent().unwrap().join("publication-journal.db")};
 if journal.exists(){inside(journal.parent().unwrap(),&journal)?;}
 let pool=SqlitePoolOptions::new().max_connections(1).connect_with(SqliteConnectOptions::new().filename(path).create_if_missing(id=="primary"&&!read_only).read_only(read_only).foreign_keys(true)).await.map_err(|e|e.to_string())?;
 let result=async {
  if !read_only{super::backup_restore::migrator().run(&pool).await.map_err(|e|e.to_string())?;}
  else {let version:i64=sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations WHERE success=1").fetch_one(&pool).await.map_err(|e|e.to_string())?;if !(3..=6).contains(&version){return Err("WORKSPACE_SCHEMA_UNSUPPORTED".into());}}
  let integrity:String=sqlx::query_scalar("PRAGMA integrity_check").fetch_one(&pool).await.map_err(|e|e.to_string())?;
  let broken:i64=sqlx::query_scalar("SELECT count(*) FROM pragma_foreign_key_check").fetch_one(&pool).await.map_err(|e|e.to_string())?;
  if integrity!="ok"||broken!=0{return Err("WORKSPACE_SQLITE_INVALID".to_string());} Ok(())
 }.await;
 if let Err(e)=result {pool.close().await;return Err(e);}
 Ok(Session{lease:Lease{workspace_id:id.into(),company_id:company.into(),token:format!("{:032x}",rand::random::<u128>()),read_only,selection_warning:None},pool,files,journal,authority})
}
#[cfg(test)]
async fn activate(state:&WorkspaceState,config:&Path,data:&Path,account:&str,company:&str,id:&str)->Result<Lease,String>{
 activate_mode(state,config,data,account,company,id,false,Authority::Online).await
}
async fn activate_mode(state:&WorkspaceState,config:&Path,data:&Path,account:&str,company:&str,id:&str,read_only:bool,authority:Authority)->Result<Lease,String>{
 if !valid_id(account){return Err("WORKSPACE_ACCOUNT_INVALID".into());}
 let mut guard=state.0.lock().await;
 let mut next=prepare(config,data,id,company,read_only,authority).await?;
 let saved=async {
  let registry=registry(data).await?;
  let result=sqlx::query("INSERT INTO selections VALUES(?,?,?) ON CONFLICT(account_id,company_id) DO UPDATE SET workspace_id=excluded.workspace_id").bind(account).bind(company).bind(id).execute(&registry).await.map_err(|e|e.to_string());
  registry.close().await;result
 }.await;
 if let Err(e)=saved{
  if guard.is_some()||id!="primary"{next.pool.close().await;return Err(e);}
  // A corrupt preference file must not lock the user out of their authorized
  // primary data. Preserve it for diagnosis; this startup choice is not saved.
  next.lease.selection_warning=Some(format!("WORKSPACE_SELECTION_NOT_SAVED: {e}"));
 }
 let lease=next.lease.clone();
 if let Some(old)=guard.replace(next){old.pool.close().await;}
 Ok(lease)
}
#[tauri::command]
pub async fn activate_workspace(app:tauri::AppHandle,state:tauri::State<'_,WorkspaceState>,account_id:String,company_id:String,workspace_id:String,read_only:bool,offline:Option<bool>,environment:Option<String>)->Result<Lease,String>{
 let data=app.path().app_data_dir().map_err(|e|e.to_string())?;
 let (read_only,authority)=if offline.unwrap_or(false){let grant=crate::offline_lease::grant(&data,&account_id,&company_id,environment.as_deref().ok_or("OFFLINE_AUTHORIZATION_ENVIRONMENT_REQUIRED")?)?;(grant.read_only,Authority::Offline{expires_at:grant.expires_at,last_observed:grant.last_observed,cache_root:data.clone()})}else{(read_only,Authority::Online)};
 activate_mode(&state,&app.path().app_config_dir().map_err(|e|e.to_string())?,&data,&account_id,&company_id,&workspace_id,read_only,authority).await
}
#[tauri::command]
pub async fn remembered_workspace(app:tauri::AppHandle,account_id:String,company_id:String)->Result<Option<String>,String>{
 if !valid_id(&account_id)||!valid_id(&company_id){return Err("WORKSPACE_ID_INVALID".into());}
 let pool=registry(&app.path().app_data_dir().map_err(|e|e.to_string())?).await?;
 let result=sqlx::query_scalar("SELECT workspace_id FROM selections WHERE account_id=? AND company_id=?").bind(account_id).bind(company_id).fetch_optional(&pool).await.map_err(|e|e.to_string());pool.close().await;result
}
#[tauri::command]
pub async fn list_workspaces(app:tauri::AppHandle,company_id:String)->Result<Vec<Entry>,String>{
 if !valid_id(&company_id){return Err("WORKSPACE_COMPANY_INVALID".into());}
 let mut entries=vec![Entry{workspace_id:"primary".into(),company_id:company_id.clone(),kind:"primary".into(),available:true,reason:None}];
 let root=app.path().app_data_dir().map_err(|e|e.to_string())?.join("restored-workspaces");
 if root.exists(){for directory in fs::read_dir(&root).map_err(|e|e.to_string())?{
  let directory=directory.map_err(|e|e.to_string())?;let id=directory.file_name().to_string_lossy().into_owned();
  if !valid_id(&id){continue;}
  match super::backup_restore::workspace_company(&root,&id){
   Ok(company) if company==company_id=>{let result=super::backup_restore::inspect_workspace(&root,&id,company_id.clone()).await;entries.push(Entry{workspace_id:format!("restored-{id}"),company_id:company_id.clone(),kind:"restored".into(),available:result.is_ok(),reason:result.err()});},
   _=>{} // Unidentifiable/incomplete artifacts are never selectable.
  }
 }} entries[1..].sort_by(|a,b|a.workspace_id.cmp(&b.workspace_id));Ok(entries)
}
#[tauri::command]
pub async fn close_workspace(state:tauri::State<'_,WorkspaceState>)->Result<(),String>{
 if let Some(old)=state.0.lock().await.take(){old.pool.close().await;} Ok(())
}
#[tauri::command]
pub async fn workspace_select(state:tauri::State<'_,WorkspaceState>,token:String,statement:String,values:Vec<Value>)->Result<Vec<Value>,String>{
 select(&state,token,statement,values).await
}
async fn select(state:&WorkspaceState,token:String,statement:String,values:Vec<Value>)->Result<Vec<Value>,String>{
 let guard=state.0.lock().await;let session=checked(&guard,&token)?;
 let prefix=statement.trim_start().to_ascii_uppercase();
 if !prefix.starts_with("SELECT ")&&!prefix.starts_with("WITH "){return Err("WORKSPACE_READ_SQL_REQUIRED".into());}
 let query=bind(&statement,values)?;
 let mut connection=session.pool.acquire().await.map_err(|e|e.to_string())?;
 sqlx::query("PRAGMA query_only=ON").execute(&mut *connection).await.map_err(|e|e.to_string())?;
 let result=query.fetch_all(&mut *connection).await.map_err(|e|e.to_string());
 sqlx::query("PRAGMA query_only=OFF").execute(&mut *connection).await.map_err(|e|e.to_string())?;
 let rows=result?;
 rows.iter().map(|row|{
  let mut object=Map::new();for (i,column) in row.columns().iter().enumerate(){
   let raw=row.try_get_raw(i).map_err(|e|e.to_string())?;
   let value=if raw.is_null(){Value::Null}else{match raw.type_info().name(){
    "INTEGER"=>Value::from(row.try_get::<i64,_>(i).map_err(|e|e.to_string())?),
    "REAL"=>Value::from(row.try_get::<f64,_>(i).map_err(|e|e.to_string())?),
    "TEXT"=>Value::from(row.try_get::<String,_>(i).map_err(|e|e.to_string())?),
    _=>return Err("Unsupported SQLite value".into())
   }};object.insert(column.name().into(),value);
  } Ok(Value::Object(object))
 }).collect()
}
#[tauri::command]
pub async fn workspace_batch(state:tauri::State<'_,WorkspaceState>,token:String,statements:Vec<Statement>)->Result<(),String>{
 batch(&state,token,statements).await
}
async fn batch(state:&WorkspaceState,token:String,statements:Vec<Statement>)->Result<(),String>{
 let mut guard=state.0.lock().await;let session=checked_writable(&mut guard,&token)?;
 if statements.len()>10000{return Err("Workspace batch too large".into());}
 let mut tx=session.pool.begin().await.map_err(|e|e.to_string())?;
 for item in statements{
  let prefix=item.statement.trim_start().to_ascii_uppercase();
  if item.statement.contains(';')||!["INSERT ","UPDATE ","DELETE "].iter().any(|p|prefix.starts_with(p)){return Err("WORKSPACE_MUTATION_SQL_INVALID".into());}
  bind(&item.statement,item.values)?.execute(&mut *tx).await.map_err(|e|e.to_string())?;
 }
 authority_writable(session)?;
 tx.commit().await.map_err(|e|e.to_string())
}

#[tauri::command]
pub async fn workspace_journal(state:tauri::State<'_,WorkspaceState>,token:String,key:String,value:Option<String>)->Result<Option<String>,String>{
 journal(&state,token,key,value).await
}
async fn journal(state:&WorkspaceState,token:String,key:String,value:Option<String>)->Result<Option<String>,String>{
 let mut guard=state.0.lock().await;if value.is_some(){checked_writable(&mut guard,&token)?;}else{checked(&guard,&token)?;}let session=checked(&guard,&token)?;
 if key.len()>1024||value.as_ref().is_some_and(|v|v.len()>8*1024*1024){return Err("WORKSPACE_JOURNAL_TOO_LARGE".into());}
 if session.journal.exists(){inside(session.journal.parent().unwrap(),&session.journal)?;}
 let pool=SqlitePoolOptions::new().max_connections(1).connect_with(SqliteConnectOptions::new().filename(&session.journal).create_if_missing(true)).await.map_err(|e|e.to_string())?;
 let result=async {
  sqlx::query("CREATE TABLE IF NOT EXISTS publication_journal(id TEXT PRIMARY KEY,value TEXT NOT NULL)").execute(&pool).await.map_err(|e|e.to_string())?;
  if let Some(value)=value {sqlx::query("INSERT INTO publication_journal VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").bind(&key).bind(value).execute(&pool).await.map_err(|e|e.to_string())?;}
  sqlx::query_scalar("SELECT value FROM publication_journal WHERE id=?").bind(key).fetch_optional(&pool).await.map_err(|e|e.to_string())
 }.await;pool.close().await;result
}

#[tauri::command]
pub async fn workspace_store_pdf(state:tauri::State<'_,WorkspaceState>,token:String,company_id:String,id:String,bytes:Vec<u8>,import_source:bool)->Result<String,String>{
 store_pdf(&state,token,company_id,id,bytes,import_source).await
}
async fn store_pdf(state:&WorkspaceState,token:String,company_id:String,id:String,bytes:Vec<u8>,import_source:bool)->Result<String,String>{
 let mut guard=state.0.lock().await;let session=checked_writable(&mut guard,&token)?;
 if company_id!=session.lease.company_id{return Err("WORKSPACE_COMPANY_MISMATCH".into());}
 super::publication_files::store_pdf_with_limit(&session.files,&company_id,&id,&bytes,if import_source{250*1024*1024}else{5*1024*1024})
}
#[tauri::command]
pub async fn workspace_read_pdf(state:tauri::State<'_,WorkspaceState>,token:String,relative_path:String)->Result<Vec<u8>,String>{
 read_pdf(&state,token,relative_path).await
}
async fn read_pdf(state:&WorkspaceState,token:String,relative_path:String)->Result<Vec<u8>,String>{
 use std::io::Read;
 let guard=state.0.lock().await;let session=checked(&guard,&token)?;
 let relative=Path::new(&relative_path);
 if relative_path.is_empty()||relative_path.contains(':')||relative.components().any(|c|!matches!(c,std::path::Component::Normal(_))){return Err("WORKSPACE_FILE_PATH_INVALID".into());}
 let count:i64=sqlx::query_scalar("SELECT count(*) FROM dm_attachments a JOIN chemical_product__ownership o ON o.child_id=a.owner_id WHERE a.owner_type='chemical_product' AND o.company_id=? AND a.relative_path=?")
  .bind(&session.lease.company_id).bind(&relative_path).fetch_one(&session.pool).await.map_err(|e|e.to_string())?;
 let imports:i64=if count>0{0}else{sqlx::query_scalar("SELECT count(*) FROM sds_import_session WHERE company_id=? AND managed_source_path=?")
  .bind(&session.lease.company_id).bind(&relative_path).fetch_one(&session.pool).await.map_err(|e|e.to_string())?};
 if count==0&&imports==0{return Err("WORKSPACE_FILE_NOT_OWNED".into());}
 let path=inside(&session.files,&session.files.join(relative))?;
 let max=if imports>0{250*1024*1024}else{5*1024*1024};
 let mut bytes=Vec::new();fs::File::open(path).map_err(|e|e.to_string())?.take(max+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
 if bytes.len() as u64>max||!bytes.starts_with(b"%PDF-"){return Err("WORKSPACE_PDF_INVALID".into());} Ok(bytes)
}

#[cfg(test)]
mod tests {
 use super::*;
 #[tokio::test]
 async fn corrupt_inactive_workspaces_and_registry_never_replace_the_active_session(){
  let root=std::env::temp_dir().join(format!("hazcom-adversarial-{:016x}",rand::random::<u64>()));
  let config=root.join("config");let data=root.join("data");let restores=data.join("restored-workspaces");let state=WorkspaceState::default();
  let company="native-restore-proof";
  let primary=activate(&state,&config,&data,"account",company,"primary").await.unwrap();
  for fault in ["missing-db","corrupt-db","missing-files","corrupt-sds","wrong-size","oversized-sds","manifest","future-schema","missing-workspace","foreign-key"]{
   let raw:Value=serde_json::from_str(include_str!("../../test/native-restore-plan.json")).unwrap();
   let first=raw["files"][0]["attachmentId"].as_str().unwrap().to_string();
   let plan:Plan=serde_json::from_value(raw).unwrap();
   crate::backup_restore::restore_to_workspace(&restores,fault.into(),plan.company_id,plan.manifest,plan.statements,plan.files).await.unwrap();
   let active=restores.join(fault).join("active");let db=active.join("workspace.db");
   let pdf=active.join("attachments").join(company).join(format!("{first}.pdf"));
   match fault{
    "missing-db"=>fs::rename(&db,active.join("missing.saved")).unwrap(),
    "corrupt-db"=>fs::write(&db,b"not a SQLite database").unwrap(),
    "missing-files"=>fs::rename(active.join("attachments"),active.join("missing-attachments.saved")).unwrap(),
    "corrupt-sds"=>{let mut bytes=fs::read(&pdf).unwrap();let end=bytes.len()-1;bytes[end]^=1;fs::write(&pdf,bytes).unwrap();},
    "wrong-size"=>{let mut bytes=fs::read(&pdf).unwrap();bytes.push(0);fs::write(&pdf,bytes).unwrap();},
    "oversized-sds"=>{fs::OpenOptions::new().write(true).open(&pdf).unwrap().set_len(5*1024*1024+1).unwrap();},
    "manifest"=>fs::write(active.join("restore-manifest.json"),b"{}").unwrap(),
    "future-schema"=>{let pool=SqlitePoolOptions::new().connect_with(SqliteConnectOptions::new().filename(&db)).await.unwrap();sqlx::query("UPDATE _sqlx_migrations SET version=999 WHERE version=4").execute(&pool).await.unwrap();pool.close().await;},
    "foreign-key"=>{let pool=SqlitePoolOptions::new().connect_with(SqliteConnectOptions::new().filename(&db).foreign_keys(false)).await.unwrap();sqlx::query("UPDATE work_area__ownership SET company_id='missing-company'").execute(&pool).await.unwrap();pool.close().await;},
    "missing-workspace"=>fs::rename(&active,restores.join(fault).join("inactive.saved")).unwrap(),
    _=>unreachable!()
   }
   assert!(activate(&state,&config,&data,"account",company,&format!("restored-{fault}")).await.is_err(),"accepted {fault}");
   assert_eq!(select(&state,primary.token.clone(),"SELECT 1 AS alive".into(),vec![]).await.unwrap()[0]["alive"],1);
   if fault=="missing-db"{assert!(!db.exists());}
  }
  let registry_path=data.join("workspace-registry.db");let saved=fs::read(&registry_path).unwrap();fs::write(&registry_path,b"broken registry").unwrap();
  assert!(activate(&state,&config,&data,"account",company,"primary").await.is_err());
  assert!(select(&state,primary.token.clone(),"SELECT 1".into(),vec![]).await.is_ok());
  if let Some(old)=state.0.lock().await.take(){old.pool.close().await;}
  let fallback=activate(&state,&config,&data,"account",company,"primary").await.unwrap();assert!(fallback.selection_warning.is_some());
  assert!(select(&state,fallback.token,"SELECT 1".into(),vec![]).await.is_ok());assert_eq!(fs::read(&registry_path).unwrap(),b"broken registry");fs::write(registry_path,saved).unwrap();
  if let Some(old)=state.0.lock().await.take(){old.pool.close().await;}
  let resolved=root.canonicalize().unwrap();assert!(resolved.starts_with(std::env::temp_dir().canonicalize().unwrap()));fs::remove_dir_all(resolved).unwrap();
 }
 #[tokio::test]
 async fn javascript_authoring_and_backup_round_trip_through_native_sessions(){
  use std::io::{BufRead,BufReader,Write};
  use std::process::{Command,Stdio};
  let root=std::env::temp_dir().join(format!("hazcom-roundtrip-{:016x}",rand::random::<u64>()));
  let config=root.join("config");let data=root.join("data");let state=WorkspaceState::default();
  let script=Path::new(env!("CARGO_MANIFEST_DIR")).join("../test/native-workspace-scenario.mjs");
  let mut child=Command::new("node").arg(script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
  let mut input=child.stdin.take().unwrap();let output=BufReader::new(child.stdout.take().unwrap());
  for line in output.lines(){
   let request:Value=serde_json::from_str(&line.unwrap()).unwrap();
   let string=|key:&str|request[key].as_str().unwrap().to_string();
   let result:Result<Value,String>=async {match request["op"].as_str().unwrap(){
    "activate"=>Ok(serde_json::to_value(activate(&state,&config,&data,"synthetic-account","roundtrip-company",&string("id")).await?).unwrap()),
    "select"=>Ok(Value::Array(select(&state,string("token"),string("statement"),request["values"].as_array().unwrap().clone()).await?)),
    "batch"=>{batch(&state,string("token"),serde_json::from_value(request["statements"].clone()).unwrap()).await?;Ok(Value::Null)},
    "stage"=>Ok(Value::String(store_pdf(&state,string("token"),string("company"),string("id"),serde_json::from_value(request["bytes"].clone()).unwrap(),request["import"].as_bool().unwrap_or(false)).await?)),
    "read"=>Ok(serde_json::to_value(read_pdf(&state,string("token"),string("path")).await?).unwrap()),
    "journal"=>Ok(serde_json::to_value(journal(&state,string("token"),string("key"),request["value"].as_str().map(str::to_string)).await?).unwrap()),
    "restore"=>{let plan:Plan=serde_json::from_value(request["plan"].clone()).unwrap();crate::backup_restore::restore_to_workspace(&data.join("restored-workspaces"),string("id"),plan.company_id,plan.manifest,plan.statements,plan.files).await?;Ok(Value::Null)},
    "close"=>{if let Some(old)=state.0.lock().await.take(){old.pool.close().await;}Ok(Value::Null)},
    _=>Err("Unknown test bridge operation".into())
   }}.await;
   let response=match result{Ok(value)=>serde_json::json!({"value":value}),Err(error)=>serde_json::json!({"error":error})};
   writeln!(input,"{}",response).unwrap();input.flush().unwrap();
  }
  let status=child.wait().unwrap();
  if let Some(old)=state.0.lock().await.take(){old.pool.close().await;}
  let resolved=root.canonicalize().unwrap();assert!(resolved.starts_with(std::env::temp_dir().canonicalize().unwrap()));fs::remove_dir_all(resolved).unwrap();
  assert!(status.success(),"JavaScript/native authoring scenario failed");
 }
 use crate::backup_restore::{RestoreManifest,RestoreStatement,RestoreFile,restore_to_root};
 #[derive(Deserialize)]
 #[serde(rename_all="camelCase")]
 struct Plan{company_id:String,manifest:RestoreManifest,statements:Vec<RestoreStatement>,files:Vec<RestoreFile>}
 #[tokio::test]
 async fn switch_is_atomic_closes_old_pool_rejects_stale_lease_and_remembers_selection(){
  let root=std::env::temp_dir().join(format!("hazcom-workspace-{:016x}",rand::random::<u64>()));
  let config=root.join("config");let data=root.join("data");
  let plan:Plan=serde_json::from_str(include_str!("../../test/native-restore-plan.json")).unwrap();
  let company=plan.company_id.clone();
  restore_to_root(&data.join("restored-workspaces"),company.clone(),plan.manifest,plan.statements,plan.files).await.unwrap();
  let state=WorkspaceState::default();
  let primary=activate(&state,&config,&data,"account",&company,"primary").await.unwrap();
  let old_pool=state.0.lock().await.as_ref().unwrap().pool.clone();
  sqlx::query("INSERT INTO company(id,name,contact_email) VALUES(?,?,?)").bind(&company).bind("Original").bind("test@example.test").execute(&old_pool).await.unwrap();
  assert!(activate(&state,&config,&data,"account",&company,"../escape").await.is_err());
  assert!(checked(&*state.0.lock().await,&primary.token).is_ok());
  assert!(!old_pool.is_closed());
  let restored=activate(&state,&config,&data,"account",&company,&format!("restored-{company}")).await.unwrap();
  assert!(old_pool.is_closed());
  assert!(checked(&*state.0.lock().await,&primary.token).is_err());
  {
   let guard=state.0.lock().await;let active=checked(&guard,&restored.token).unwrap();
   let count:i64=sqlx::query_scalar("SELECT count(*) FROM work_area").fetch_one(&active.pool).await.unwrap();assert_eq!(count,5);
   sqlx::query("UPDATE work_area SET name='Restored edit' WHERE id=(SELECT id FROM work_area LIMIT 1)").execute(&active.pool).await.unwrap();
  }
  let registry=registry(&data).await.unwrap();
  let remembered:String=sqlx::query_scalar("SELECT workspace_id FROM selections WHERE account_id='account'").fetch_one(&registry).await.unwrap();registry.close().await;
  assert_eq!(remembered,restored.workspace_id);
  if let Some(old)=state.0.lock().await.take(){old.pool.close().await;}
  let reopened=activate(&state,&config,&data,"account",&company,&remembered).await.unwrap();assert_ne!(reopened.token,restored.token);
  activate(&state,&config,&data,"account",&company,"primary").await.unwrap();
  let pool=state.0.lock().await.as_ref().unwrap().pool.clone();
  let count:i64=sqlx::query_scalar("SELECT count(*) FROM work_area").fetch_one(&pool).await.unwrap();assert_eq!(count,0);
  if let Some(old)=state.0.lock().await.take(){old.pool.close().await;}
  let resolved=root.canonicalize().unwrap();assert!(resolved.starts_with(std::env::temp_dir().canonicalize().unwrap()));fs::remove_dir_all(resolved).unwrap();
 }
 #[tokio::test]
 async fn same_company_restores_are_isolated_and_invalid_candidates_preserve_active_session(){
  let root=std::env::temp_dir().join(format!("hazcom-workspace-{:016x}",rand::random::<u64>()));
  let config=root.join("config");let data=root.join("data");let restores=data.join("restored-workspaces");
  for id in ["copy-a","copy-b"]{
   let plan:Plan=serde_json::from_str(include_str!("../../test/native-restore-plan.json")).unwrap();
   crate::backup_restore::restore_to_workspace(&restores,id.into(),plan.company_id,plan.manifest,plan.statements,plan.files).await.unwrap();
  }
  let company="native-restore-proof";let state=WorkspaceState::default();
  let first=activate(&state,&config,&data,"account",company,"restored-copy-a").await.unwrap();
  {let guard=state.0.lock().await;sqlx::query("UPDATE work_area SET name='Only A'").execute(&guard.as_ref().unwrap().pool).await.unwrap();}
  for _ in 0..12{
   activate(&state,&config,&data,"account",company,"restored-copy-b").await.unwrap();
   let count:i64=sqlx::query_scalar("SELECT count(*) FROM work_area WHERE name='Only A'").fetch_one(&state.0.lock().await.as_ref().unwrap().pool).await.unwrap();assert_eq!(count,0);
   activate(&state,&config,&data,"account",company,"restored-copy-a").await.unwrap();
  }
  assert!(checked(&*state.0.lock().await,&first.token).is_err());
  let current=state.0.lock().await.as_ref().unwrap().lease.clone();
  assert!(activate(&state,&config,&data,"account","other-company","restored-copy-a").await.is_err());
  fs::write(restores.join("copy-b/active/restore-files.json"),b"invalid json").unwrap();
  assert!(activate(&state,&config,&data,"account",company,"restored-copy-b").await.is_err());
  assert!(checked(&*state.0.lock().await,&current.token).is_ok());
  assert!(activate(&state,&config,&data,"account",company,"restored-../copy-a").await.is_err());
  if let Some(old)=state.0.lock().await.take(){old.pool.close().await;}
  let resolved=root.canonicalize().unwrap();assert!(resolved.starts_with(std::env::temp_dir().canonicalize().unwrap()));fs::remove_dir_all(resolved).unwrap();
 }
 #[tokio::test]
 async fn routed_sql_files_and_journals_are_scoped_and_batches_roll_back(){
  use sha2::{Digest,Sha256};
  let root=std::env::temp_dir().join(format!("hazcom-workspace-{:016x}",rand::random::<u64>()));let config=root.join("config");let data=root.join("data");
  let plan:Plan=serde_json::from_str(include_str!("../../test/native-restore-plan.json")).unwrap();let company=plan.company_id.clone();
  restore_to_root(&data.join("restored-workspaces"),company.clone(),plan.manifest,plan.statements,plan.files).await.unwrap();
  let state=WorkspaceState::default();let a=activate(&state,&config,&data,"account",&company,&format!("restored-{company}")).await.unwrap();
  let rows=select(&state,a.token.clone(),"SELECT id FROM chemical_product ORDER BY id LIMIT 1".into(),vec![]).await.unwrap();let product=rows[0]["id"].as_str().unwrap();
  let pdf=b"%PDF-1.4\nNew local SDS".to_vec();let hash=format!("{:x}",Sha256::digest(&pdf));
  let path=store_pdf(&state,a.token.clone(),company.clone(),"new-sds".into(),pdf.clone(),false).await.unwrap();
  assert!(read_pdf(&state,a.token.clone(),path.clone()).await.is_err()); // Bytes alone do not establish ownership.
  let insert=||Statement{statement:"INSERT INTO dm_attachments(id,owner_type,owner_id,relative_path,original_filename,size_bytes,created_at) VALUES (?,?,?,?,?,?,?)".into(),values:vec!["new-sds".into(),"chemical_product".into(),product.into(),path.clone().into(),"local.pdf".into(),(pdf.len() as i64).into(),"2026-09-27T00:00:00Z".into()]};
  assert!(batch(&state,a.token.clone(),vec![insert(),insert()]).await.is_err());
  assert!(read_pdf(&state,a.token.clone(),path.clone()).await.is_err());
  batch(&state,a.token.clone(),vec![insert(),Statement{statement:"INSERT INTO authoring_sds_integrity VALUES (?,?)".into(),values:vec!["new-sds".into(),hash.into()]}]).await.unwrap();
  assert_eq!(read_pdf(&state,a.token.clone(),path.clone()).await.unwrap(),pdf);
  assert!(store_pdf(&state,a.token.clone(),"other".into(),"id".into(),pdf.clone(),false).await.is_err());
  assert!(read_pdf(&state,a.token.clone(),"../escape.pdf".into()).await.is_err());
  assert!(batch(&state,a.token.clone(),vec![Statement{statement:"ATTACH DATABASE 'external.db' AS external".into(),values:vec![]}]).await.is_err());
  assert!(select(&state,a.token.clone(),"DELETE FROM work_area RETURNING id".into(),vec![]).await.is_err());
  journal(&state,a.token.clone(),"account/attempt".into(),Some("restored-attempt".into())).await.unwrap();
  let b=activate(&state,&config,&data,"account",&company,"primary").await.unwrap();
  assert!(select(&state,a.token.clone(),"SELECT 1".into(),vec![]).await.is_err());
  assert!(read_pdf(&state,b.token.clone(),path).await.is_err());
  assert_eq!(journal(&state,b.token.clone(),"account/attempt".into(),None).await.unwrap(),None);
  let reopened=activate(&state,&config,&data,"account",&company,&a.workspace_id).await.unwrap();
  assert_eq!(journal(&state,reopened.token.clone(),"account/attempt".into(),None).await.unwrap(),Some("restored-attempt".into()));
  if let Some(old)=state.0.lock().await.take(){old.pool.close().await;}
  let db_path=data.join("restored-workspaces").join(&company).join("active/workspace.db");
  let before=fs::read(&db_path).unwrap();
  let readonly=activate_mode(&state,&config,&data,"account",&company,&a.workspace_id,true,Authority::Online).await.unwrap();
  assert!(readonly.read_only);
  assert_eq!(batch(&state,reopened.token,vec![]).await.unwrap_err(),"WORKSPACE_SESSION_STALE");
  assert!(!select(&state,readonly.token.clone(),"SELECT id FROM work_area".into(),vec![]).await.unwrap().is_empty());
  assert_eq!(batch(&state,readonly.token.clone(),vec![Statement{statement:"UPDATE work_area SET name='Forbidden'".into(),values:vec![]}]).await.unwrap_err(),"WORKSPACE_EXPORT_ONLY");
  assert_eq!(store_pdf(&state,readonly.token.clone(),company.clone(),"forbidden".into(),pdf,false).await.unwrap_err(),"WORKSPACE_EXPORT_ONLY");
  assert_eq!(journal(&state,readonly.token.clone(),"account/attempt".into(),Some("forbidden".into())).await.unwrap_err(),"WORKSPACE_EXPORT_ONLY");
  if let Some(old)=state.0.lock().await.take(){old.pool.close().await;}
  assert_eq!(fs::read(&db_path).unwrap(),before);
  let recovered=activate_mode(&state,&config,&data,"account",&company,&a.workspace_id,false,Authority::Online).await.unwrap();
  assert_eq!(recovered.workspace_id,a.workspace_id);assert!(!recovered.read_only);
  assert_eq!(select(&state,readonly.token,"SELECT 1".into(),vec![]).await.unwrap_err(),"WORKSPACE_SESSION_STALE");
  batch(&state,recovered.token,vec![Statement{statement:"UPDATE work_area SET name='Recovered authoring'".into(),values:vec![]}]).await.unwrap();
  let valid_root=root.join("valid-lease-cache");let valid_at=crate::offline_lease::now();crate::offline_lease::record_observed(&valid_root,valid_at).unwrap();
  let valid_offline=activate_mode(&state,&config,&data,"account",&company,&a.workspace_id,false,Authority::Offline{expires_at:valid_at+600,last_observed:valid_at,cache_root:valid_root}).await.unwrap();
  batch(&state,valid_offline.token.clone(),vec![Statement{statement:"UPDATE work_area SET name='Authorized offline'".into(),values:vec![]}]).await.unwrap();
  {let mut guard=state.0.lock().await;assert_eq!(checked_online_writable(&mut guard,&valid_offline.token).err().unwrap(),"WORKSPACE_ONLINE_AUTHORIZATION_REQUIRED");}
  assert!(!select(&state,valid_offline.token,"SELECT id FROM work_area".into(),vec![]).await.unwrap().is_empty());
  let lease_root=root.join("lease-cache");let at=crate::offline_lease::now();crate::offline_lease::record_observed(&lease_root,at-2).unwrap();
  let expired=activate_mode(&state,&config,&data,"account",&company,&a.workspace_id,false,Authority::Offline{expires_at:at-1,last_observed:at-2,cache_root:lease_root}).await.unwrap();
  assert_eq!(batch(&state,expired.token.clone(),vec![Statement{statement:"UPDATE work_area SET name='Forbidden offline'".into(),values:vec![]}]).await.unwrap_err(),"WORKSPACE_OFFLINE_AUTHORIZATION_EXPIRED");
  assert_eq!(store_pdf(&state,expired.token.clone(),company.clone(),"expired-sds".into(),b"%PDF-expired".to_vec(),false).await.unwrap_err(),"WORKSPACE_EXPORT_ONLY");
  assert_eq!(journal(&state,expired.token.clone(),"attempt".into(),Some("forbidden".into())).await.unwrap_err(),"WORKSPACE_EXPORT_ONLY");
  assert!(!select(&state,expired.token.clone(),"SELECT id FROM work_area".into(),vec![]).await.unwrap().is_empty());
  assert_eq!(journal(&state,expired.token,"attempt".into(),None).await.unwrap(),None);
  if let Some(old)=state.0.lock().await.take(){old.pool.close().await;}
  let resolved=root.canonicalize().unwrap();assert!(resolved.starts_with(std::env::temp_dir().canonicalize().unwrap()));fs::remove_dir_all(resolved).unwrap();
 }
}
