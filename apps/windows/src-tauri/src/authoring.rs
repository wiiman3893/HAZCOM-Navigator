use serde::Deserialize;
use serde_json::Value;
use tauri_plugin_sql::{DbInstances, DbPool};

#[derive(Deserialize)]
pub struct Statement { statement: String, values: Vec<Value> }

// Same migrated plugin pool, one pinned connection/transaction for the entire service mutation.
// This local command has the same trust boundary as the existing main-window SQL capability.
#[tauri::command]
pub async fn authoring_batch(state: tauri::State<'_, DbInstances>, statements: Vec<Statement>) -> Result<(), String> {
    if statements.len()>10000 { return Err("Authoring batch too large".into()); }
    let instances=state.0.read().await;
    let Some(DbPool::Sqlite(pool))=instances.get("sqlite:hazcom-navigator.db") else { return Err("Authorized workspace is not open".into()); };
    run_batch(pool,statements).await
}
async fn run_batch(pool:&sqlx::SqlitePool,statements:Vec<Statement>)->Result<(),String>{
    let mut tx=pool.begin().await.map_err(|e|e.to_string())?;
    for item in statements {
        let mut query=sqlx::query(&item.statement);
        for value in item.values { query=match value {
            Value::Null=>query.bind(None::<String>),Value::String(v)=>query.bind(v),
            Value::Number(v)=>query.bind(v.as_i64().ok_or("Only integral SQL numbers supported")?),
            Value::Bool(v)=>query.bind(v),_=>return Err("Invalid SQL value".into())
        }; }
        query.execute(&mut *tx).await.map_err(|e|e.to_string())?;
    }
    tx.commit().await.map_err(|e|e.to_string())
}

#[cfg(test)]
mod tests{
 use super::*;
 #[tokio::test]
 async fn batch_rollback_and_optimistic_guard(){
  let pool=sqlx::sqlite::SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
  sqlx::query("CREATE TABLE records(id TEXT PRIMARY KEY, value TEXT NOT NULL)").execute(&pool).await.unwrap();
  let row=||Statement{statement:"INSERT INTO records VALUES (?,?)".into(),values:vec![Value::String("one".into()),Value::String("saved".into())]};
  assert!(run_batch(&pool,vec![row(),row()]).await.is_err());
  let count:i64=sqlx::query_scalar("SELECT count(*) FROM records").fetch_one(&pool).await.unwrap();assert_eq!(count,0);
  run_batch(&pool,vec![row()]).await.unwrap();
  let value:String=sqlx::query_scalar("SELECT value FROM records WHERE id='one'").fetch_one(&pool).await.unwrap();assert_eq!(value,"saved");
 }
}
