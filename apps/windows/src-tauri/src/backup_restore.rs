use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::migrate::{Migration as SqlxMigration, MigrationType, Migrator};
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::{borrow::Cow, fs, io::Write, path::Path};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreFile { attachment_id: String, owner_id: String, sha256: String, size_bytes: usize, bytes: Vec<u8> }

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreManifest {
    format: String, version: u32, schema_version: Option<u32>, company_id: String,
    record_hash: String, attachment_hash: Option<String>, attachment_count: usize, created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileDescriptor<'a> { attachment_id: &'a str, owner_id: &'a str, size_bytes: usize, sha256: &'a str }

#[derive(Deserialize)]
pub struct RestoreStatement { statement: String, values: Vec<Value> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult { company_id: String, database_path: String, attachment_count: usize, record_count: usize }

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn allowed_insert(statement: &str) -> bool {
    const TABLES: &[&str] = &[
        "company", "work_area", "chemical_product", "worker", "work_area_product", "work_area_assignment",
        "sds_verification", "hazcom_review", "training_event", "work_area__ownership",
        "chemical_product__ownership", "worker__ownership", "work_area_product__ownership",
        "work_area_assignment__ownership", "sds_verification__ownership", "hazcom_review__ownership",
        "training_event__ownership", "rel_chemical_product_work_area_product_9d42d6cd",
        "rel_worker_work_area_assignment_d30ac2b9", "dm_attachments", "authoring_sds_integrity",
        "dm_change_history", "authoring_versions",
    ];
    if statement.contains(';') || !statement.starts_with("INSERT INTO ") { return false; }
    TABLES.iter().any(|table| statement.starts_with(&format!("INSERT INTO {table} (")))
}

fn migrator() -> Migrator {
    let migrations = super::migrations().into_iter().map(|migration| {
        SqlxMigration::new(
            migration.version,
            Cow::Borrowed(migration.description),
            MigrationType::ReversibleUp,
            Cow::Borrowed(migration.sql),
            false,
        )
    }).collect::<Vec<_>>();
    Migrator { migrations: Cow::Owned(migrations), ignore_missing: false, locking: true, no_tx: false }
}

fn stage_file(root: &Path, company_id: &str, file: &RestoreFile) -> Result<(), String> {
    if !valid_id(&file.attachment_id) || !valid_id(&file.owner_id) || file.bytes.len() != file.size_bytes ||
       file.bytes.len() > 5 * 1024 * 1024 || !file.bytes.starts_with(b"%PDF-") ||
       format!("{:x}", Sha256::digest(&file.bytes)) != file.sha256 {
        return Err("Backup SDS hash, size or PDF header mismatch".into());
    }
    let directory = root.join("attachments").join(company_id);
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let directory = directory.canonicalize().map_err(|e| e.to_string())?;
    if !directory.starts_with(root) { return Err("SDS staging path escapes restore workspace".into()); }
    let path = directory.join(format!("{}.pdf", file.attachment_id));
    let mut target = fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| e.to_string())?;
    target.write_all(&file.bytes).and_then(|_| target.sync_all()).map_err(|e| e.to_string())
}

fn verify_manifest(manifest: &RestoreManifest, company_id: &str, files: &[RestoreFile]) -> Result<(), String> {
    if manifest.format != "hazcom-company-backup" || !matches!(manifest.version, 1 | 2) ||
       manifest.version == 2 && manifest.schema_version != Some(3) ||
       manifest.company_id != company_id || manifest.attachment_count != files.len() ||
       manifest.record_hash.len() != 64 || !manifest.record_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Unsupported or mismatched backup manifest".into());
    }
    if manifest.version == 2 {
        let mut descriptors = files.iter().map(|file| FileDescriptor {
            attachment_id: &file.attachment_id, owner_id: &file.owner_id,
            size_bytes: file.size_bytes, sha256: &file.sha256,
        }).collect::<Vec<_>>();
        descriptors.sort_by(|a, b| a.attachment_id.cmp(b.attachment_id));
        let bytes = serde_json::to_vec(&descriptors).map_err(|e| e.to_string())?;
        let digest = format!("{:x}", Sha256::digest(bytes));
        if manifest.attachment_hash.as_deref() != Some(digest.as_str()) { return Err("Backup SDS descriptor manifest changed".into()); }
    }
    Ok(())
}

async fn stage_database(path: &Path, company_id: &str, statements: Vec<RestoreStatement>, files: &[RestoreFile]) -> Result<usize, String> {
    if statements.is_empty() || statements.len() > 100_000 { return Err("Backup record count is invalid".into()); }
    let options = SqliteConnectOptions::new().filename(path).create_if_missing(true)
        .foreign_keys(true).journal_mode(SqliteJournalMode::Delete);
    let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.map_err(|e| e.to_string())?;
    let result = async {
        migrator().run(&pool).await.map_err(|e| e.to_string())?;
        let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
        let count = statements.len();
        for item in statements {
            if !allowed_insert(&item.statement) { return Err("Unsafe backup SQL statement".into()); }
            let mut query = sqlx::query(&item.statement);
            for value in item.values {
                query = match value {
                    Value::Null => query.bind(None::<String>),
                    Value::String(text) => query.bind(text),
                    Value::Number(number) => query.bind(number.as_i64().ok_or("Invalid backup number")?),
                    Value::Bool(flag) => query.bind(flag),
                    _ => return Err("Invalid backup SQL value".into()),
                };
            }
            query.execute(&mut *tx).await.map_err(|e| e.to_string())?;
        }
        let company: String = sqlx::query_scalar("SELECT id FROM company LIMIT 1").fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
        let company_count: i64 = sqlx::query_scalar("SELECT count(*) FROM company").fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
        let db_files: i64 = sqlx::query_scalar("SELECT count(*) FROM dm_attachments").fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
        let foreign_keys: i64 = sqlx::query_scalar("SELECT count(*) FROM pragma_foreign_key_check").fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
        if company != company_id || company_count != 1 || db_files != files.len() as i64 || foreign_keys != 0 {
            return Err("Backup Company, SDS or relationship verification failed".into());
        }
        for file in files {
            let row: Option<(String, String, String, i64)> = sqlx::query_as("SELECT owner_type, owner_id, relative_path, size_bytes FROM dm_attachments WHERE id=?")
                .bind(&file.attachment_id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
            let expected_path = format!("{company_id}/{}.pdf", file.attachment_id);
            if !matches!(row,Some((ref owner_type,ref owner_id,ref relative,size)) if owner_type=="chemical_product" && owner_id==&file.owner_id && relative==&expected_path && size==file.size_bytes as i64) {
                return Err("Restored SDS metadata does not match staged bytes".into());
            }
            let expected_hash: Option<String> = sqlx::query_scalar("SELECT sha256 FROM authoring_sds_integrity WHERE attachment_id=?")
                .bind(&file.attachment_id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
            if expected_hash.is_some_and(|hash| hash != file.sha256) { return Err("Restored SDS integrity metadata mismatch".into()); }
        }
        tx.commit().await.map_err(|e| e.to_string())?;
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check").fetch_one(&pool).await.map_err(|e| e.to_string())?;
        if integrity != "ok" { return Err("Restored SQLite integrity check failed".into()); }
        Ok(count)
    }.await;
    pool.close().await;
    result
}

async fn restore_to_root(root: &Path, company_id: String, manifest: RestoreManifest, statements: Vec<RestoreStatement>, files: Vec<RestoreFile>) -> Result<RestoreResult, String> {
    if !valid_id(&company_id) || files.len() > 10_000 { return Err("Invalid backup Company or SDS count".into()); }
    verify_manifest(&manifest, &company_id, &files)?;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let company_root = root.join(&company_id);
    fs::create_dir_all(&company_root).map_err(|e| e.to_string())?;
    let company_root = company_root.canonicalize().map_err(|e| e.to_string())?;
    if !company_root.starts_with(&root) { return Err("Restore path escapes managed workspace".into()); }
    let active = company_root.join("active");
    if active.exists() { return Err("Restored Company workspace already exists; merge is unsupported".into()); }
    let staging = company_root.join(format!(".stage-{:016x}", rand::random::<u64>()));
    fs::create_dir(&staging).map_err(|e| e.to_string())?;
    let staging = staging.canonicalize().map_err(|e| e.to_string())?;
    if !staging.starts_with(&company_root) || !active.starts_with(&company_root) { return Err("Unsafe restore staging path".into()); }
    let result = async {
        let manifest_bytes=serde_json::to_vec(&manifest).map_err(|e|e.to_string())?;
        let mut manifest_file=fs::OpenOptions::new().write(true).create_new(true).open(staging.join("restore-manifest.json")).map_err(|e|e.to_string())?;
        manifest_file.write_all(&manifest_bytes).and_then(|_|manifest_file.sync_all()).map_err(|e|e.to_string())?;
        drop(manifest_file);
        for file in &files { stage_file(&staging, &company_id, file).map_err(|e|format!("Stage SDS: {e}"))?; }
        let record_count = stage_database(&staging.join("workspace.db"), &company_id, statements, &files).await.map_err(|e|format!("Stage SQLite: {e}"))?;
        fs::OpenOptions::new().write(true).open(staging.join("workspace.db")).and_then(|file| file.sync_all()).map_err(|e| format!("Sync SQLite: {e}"))?;
        if active.exists() { return Err("Restored Company workspace already exists; merge is unsupported".into()); }
        fs::rename(&staging, &active).map_err(|e| format!("Activate restore: {e}"))?;
        Ok(RestoreResult { company_id, database_path: active.join("workspace.db").to_string_lossy().into_owned(), attachment_count: files.len(), record_count })
    }.await;
    if result.is_err() && staging.starts_with(&company_root) && staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

/** Restores only into an isolated fresh workspace. The existing authoring database is never replaced. */
#[tauri::command]
pub async fn restore_company_backup(app: tauri::AppHandle, company_id: String, manifest: RestoreManifest, statements: Vec<RestoreStatement>, files: Vec<RestoreFile>) -> Result<RestoreResult, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("restored-workspaces");
    restore_to_root(&root, company_id, manifest, statements, files).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Row;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct NativePlan { company_id: String, manifest: RestoreManifest, statements: Vec<RestoreStatement>, files: Vec<RestoreFile> }

    #[tokio::test]
    async fn javascript_backup_plan_restores_through_native_sqlite_and_sds() {
        let plan: NativePlan = serde_json::from_str(include_str!("../../test/native-restore-plan.json")).unwrap();
        let root = std::env::temp_dir().join(format!("hazcom-restore-{:016x}", rand::random::<u64>()));
        let result = restore_to_root(&root, plan.company_id.clone(), plan.manifest, plan.statements, plan.files).await.unwrap();
        assert_eq!(result.attachment_count, 20);
        let pool = SqlitePoolOptions::new().connect_with(SqliteConnectOptions::new().filename(&result.database_path)).await.unwrap();
        let areas: i64 = sqlx::query_scalar("SELECT count(*) FROM work_area").fetch_one(&pool).await.unwrap();
        let products: i64 = sqlx::query_scalar("SELECT count(*) FROM chemical_product").fetch_one(&pool).await.unwrap();
        let workers: i64 = sqlx::query_scalar("SELECT count(*) FROM worker").fetch_one(&pool).await.unwrap();
        assert_eq!((areas, products, workers), (5, 20, 10));
        pool.close().await;
        assert!(root.join(&plan.company_id).join("active/restore-manifest.json").exists());
        let resolved = root.canonicalize().unwrap();
        let temporary = std::env::temp_dir().canonicalize().unwrap();
        assert!(resolved.starts_with(&temporary) && resolved.file_name().unwrap().to_string_lossy().starts_with("hazcom-restore-"));
        fs::remove_dir_all(resolved).unwrap();
    }

    #[tokio::test]
    async fn native_restore_is_atomic_fresh_and_rejects_corrupt_sds() {
        let root = std::env::temp_dir().join(format!("hazcom-restore-{:016x}", rand::random::<u64>()));
        let pdf = b"%PDF-1.4\nsynthetic test".to_vec();
        let good_file = RestoreFile { attachment_id: "sds-one".into(), owner_id: "product-one".into(), sha256: format!("{:x}", Sha256::digest(&pdf)), size_bytes: pdf.len(), bytes: pdf };
        let pdf_size = good_file.size_bytes;
        let descriptor = vec![FileDescriptor { attachment_id: "sds-one", owner_id: "product-one", size_bytes: pdf_size, sha256: &good_file.sha256 }];
        let descriptor_hash = format!("{:x}", Sha256::digest(serde_json::to_vec(&descriptor).unwrap()));
        let manifest = || RestoreManifest { format: "hazcom-company-backup".into(), version: 2, schema_version: Some(3), company_id: "company-one".into(), record_hash: "a".repeat(64), attachment_hash: Some(descriptor_hash.clone()), attachment_count: 1, created_at: "2026-09-26T00:00:00Z".into() };
        let statements = || vec![
            RestoreStatement { statement: "INSERT INTO company (id,name,contact_email) VALUES (?,?,?)".into(), values: vec!["company-one".into(), "Test".into(), "test@example.test".into()] },
            RestoreStatement { statement: "INSERT INTO chemical_product (id,product_name,manufacturer,sds_date) VALUES (?,?,?,?)".into(), values: vec!["product-one".into(), "Cleaner".into(), "Synthetic".into(), "2026-09-26".into()] },
            RestoreStatement { statement: "INSERT INTO chemical_product__ownership (id,child_id,relationship_id,company_id) VALUES (?,?,?,?)".into(), values: vec!["owner-one".into(), "product-one".into(), "940a4d09-5250-4b89-9911-1ac6f4ba64cf".into(), "company-one".into()] },
            RestoreStatement { statement: "INSERT INTO dm_attachments (id,owner_type,owner_id,relative_path,original_filename,size_bytes,created_at) VALUES (?,?,?,?,?,?,?)".into(), values: vec!["sds-one".into(), "chemical_product".into(), "product-one".into(), "company-one/sds-one.pdf".into(), "sds.pdf".into(), Value::from(pdf_size as i64), "2026-09-26T00:00:00Z".into()] },
        ];
        let corrupt = RestoreFile { attachment_id: good_file.attachment_id.clone(), owner_id: good_file.owner_id.clone(), sha256: good_file.sha256.clone(), size_bytes: good_file.size_bytes, bytes: b"%PDF-1.4\nsyNthetic test".to_vec() };
        assert!(restore_to_root(&root, "company-one".into(), manifest(), statements(), vec![corrupt]).await.is_err());
        assert!(!root.join("company-one/active").exists());
        assert!(restore_to_root(&root, "company-one".into(), manifest(), statements(), vec![]).await.is_err());
        assert!(!root.join("company-one/active").exists());
        let mut broken = statements();
        broken[2].values[3] = "other-company".into();
        assert!(restore_to_root(&root, "company-one".into(), manifest(), broken, vec![RestoreFile { attachment_id: good_file.attachment_id.clone(), owner_id: good_file.owner_id.clone(), sha256: good_file.sha256.clone(), size_bytes: good_file.size_bytes, bytes: good_file.bytes.clone() }]).await.is_err());
        assert!(!root.join("company-one/active").exists());
        let result = restore_to_root(&root, "company-one".into(), manifest(), statements(), vec![good_file]).await.unwrap();
        let pool = SqlitePoolOptions::new().connect_with(SqliteConnectOptions::new().filename(&result.database_path)).await.unwrap();
        let row = sqlx::query("SELECT id FROM company").fetch_one(&pool).await.unwrap();
        assert_eq!(row.get::<String, _>("id"), "company-one");
        pool.close().await;
        assert!(restore_to_root(&root, "company-one".into(), manifest(), statements(), vec![]).await.is_err());
        assert_eq!(fs::read(root.join("company-one/active/attachments/company-one/sds-one.pdf")).unwrap(), b"%PDF-1.4\nsynthetic test");
        assert!(root.join("company-one/active/restore-manifest.json").exists());
        let resolved = root.canonicalize().unwrap();
        let temporary = std::env::temp_dir().canonicalize().unwrap();
        assert!(resolved.starts_with(&temporary) && resolved.file_name().unwrap().to_string_lossy().starts_with("hazcom-restore-"));
        fs::remove_dir_all(resolved).unwrap();
    }
}
