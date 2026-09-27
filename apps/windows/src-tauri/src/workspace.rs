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
pub struct Session { pub lease: Lease, pub pool: SqlitePool, pub files: PathBuf }
#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
pub struct Lease { pub workspace_id:String, pub company_id:String, pub token:String }
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
async fn prepare(config:&Path,data:&Path,id:&str,company:&str)->Result<Session,String>{
 if !valid_id(company){return Err("WORKSPACE_COMPANY_INVALID".into());}
 let (path,files)=if id=="primary" {
  fs::create_dir_all(config).map_err(|e|e.to_string())?;
  let path=config.join("hazcom-navigator.db");if path.exists(){inside(config,&path)?;}
  (path,data.join("attachments"))
 }else{
  if id!=format!("restored-{company}"){return Err("WORKSPACE_ID_INVALID".into());}
  let root=data.join("restored-workspaces");
  super::backup_restore::inspect_root(&root,company.to_string()).await?;
  let active=inside(&root,&root.join(company).join("active"))?;
  (inside(&active,&active.join("workspace.db"))?,inside(&active,&active.join("attachments"))?)
 };
 let pool=SqlitePoolOptions::new().max_connections(1).connect_with(SqliteConnectOptions::new().filename(path).create_if_missing(id=="primary").foreign_keys(true)).await.map_err(|e|e.to_string())?;
 let result=async {
  super::backup_restore::migrator().run(&pool).await.map_err(|e|e.to_string())?;
  let integrity:String=sqlx::query_scalar("PRAGMA integrity_check").fetch_one(&pool).await.map_err(|e|e.to_string())?;
  let broken:i64=sqlx::query_scalar("SELECT count(*) FROM pragma_foreign_key_check").fetch_one(&pool).await.map_err(|e|e.to_string())?;
  if integrity!="ok"||broken!=0{return Err("WORKSPACE_SQLITE_INVALID".to_string());} Ok(())
 }.await;
 if let Err(e)=result {pool.close().await;return Err(e);}
 Ok(Session{lease:Lease{workspace_id:id.into(),company_id:company.into(),token:format!("{:032x}",rand::random::<u128>())},pool,files})
}
async fn activate(state:&WorkspaceState,config:&Path,data:&Path,account:&str,company:&str,id:&str)->Result<Lease,String>{
 if !valid_id(account){return Err("WORKSPACE_ACCOUNT_INVALID".into());}
 let mut guard=state.0.lock().await;
 let next=prepare(config,data,id,company).await?;
 let saved=async {
  let registry=registry(data).await?;
  let result=sqlx::query("INSERT INTO selections VALUES(?,?,?) ON CONFLICT(account_id,company_id) DO UPDATE SET workspace_id=excluded.workspace_id").bind(account).bind(company).bind(id).execute(&registry).await.map_err(|e|e.to_string());
  registry.close().await;result
 }.await;
 if let Err(e)=saved{next.pool.close().await;return Err(e);}
 let lease=next.lease.clone();
 if let Some(old)=guard.replace(next){old.pool.close().await;}
 Ok(lease)
}
#[tauri::command]
pub async fn activate_workspace(app:tauri::AppHandle,state:tauri::State<'_,WorkspaceState>,account_id:String,company_id:String,workspace_id:String)->Result<Lease,String>{
 activate(&state,&app.path().app_config_dir().map_err(|e|e.to_string())?,&app.path().app_data_dir().map_err(|e|e.to_string())?,&account_id,&company_id,&workspace_id).await
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
 if root.join(&company_id).exists(){
  let result=super::backup_restore::inspect_root(&root,company_id.clone()).await;
  entries.push(Entry{workspace_id:format!("restored-{company_id}"),company_id,kind:"restored".into(),available:result.is_ok(),reason:result.err()});
 } Ok(entries)
}
#[tauri::command]
pub async fn close_workspace(state:tauri::State<'_,WorkspaceState>)->Result<(),String>{
 if let Some(old)=state.0.lock().await.take(){old.pool.close().await;} Ok(())
}
#[tauri::command]
pub async fn workspace_select(state:tauri::State<'_,WorkspaceState>,token:String,statement:String,values:Vec<Value>)->Result<Vec<Value>,String>{
 let guard=state.0.lock().await;let session=checked(&guard,&token)?;
 let rows=bind(&statement,values)?.fetch_all(&session.pool).await.map_err(|e|e.to_string())?;
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
 let guard=state.0.lock().await;let session=checked(&guard,&token)?;
 if statements.len()>10000{return Err("Workspace batch too large".into());}
 let mut tx=session.pool.begin().await.map_err(|e|e.to_string())?;
 for item in statements{bind(&item.statement,item.values)?.execute(&mut *tx).await.map_err(|e|e.to_string())?;}
 tx.commit().await.map_err(|e|e.to_string())
}

#[tauri::command]
pub async fn workspace_store_pdf(state:tauri::State<'_,WorkspaceState>,token:String,company_id:String,id:String,bytes:Vec<u8>,import_source:bool)->Result<String,String>{
 let guard=state.0.lock().await;let session=checked(&guard,&token)?;
 if company_id!=session.lease.company_id{return Err("WORKSPACE_COMPANY_MISMATCH".into());}
 super::publication_files::store_pdf_with_limit(&session.files,&company_id,&id,&bytes,if import_source{250*1024*1024}else{5*1024*1024})
}
#[tauri::command]
pub async fn workspace_read_pdf(state:tauri::State<'_,WorkspaceState>,token:String,relative_path:String)->Result<Vec<u8>,String>{
 use std::io::Read;
 let guard=state.0.lock().await;let session=checked(&guard,&token)?;
 let relative=Path::new(&relative_path);
 if relative_path.is_empty()||relative_path.contains(':')||relative.components().any(|c|!matches!(c,std::path::Component::Normal(_))){return Err("WORKSPACE_FILE_PATH_INVALID".into());}
 let count:i64=sqlx::query_scalar("SELECT count(*) FROM dm_attachments a JOIN chemical_product__ownership o ON o.child_id=a.owner_id WHERE a.owner_type='chemical_product' AND o.company_id=? AND a.relative_path=?")
  .bind(&session.lease.company_id).bind(&relative_path).fetch_one(&session.pool).await.map_err(|e|e.to_string())?;
 let imports:i64=sqlx::query_scalar("SELECT count(*) FROM sds_import_session WHERE company_id=? AND managed_source_path=?")
  .bind(&session.lease.company_id).bind(&relative_path).fetch_one(&session.pool).await.map_err(|e|e.to_string())?;
 if count==0&&imports==0{return Err("WORKSPACE_FILE_NOT_OWNED".into());}
 let path=inside(&session.files,&session.files.join(relative))?;
 let max=if imports>0{250*1024*1024}else{5*1024*1024};
 let mut bytes=Vec::new();fs::File::open(path).map_err(|e|e.to_string())?.take(max+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
 if bytes.len() as u64>max||!bytes.starts_with(b"%PDF-"){return Err("WORKSPACE_PDF_INVALID".into());} Ok(bytes)
}

#[cfg(test)]
mod tests {
 use super::*;
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
}
