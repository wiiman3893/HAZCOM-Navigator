mod authoring;
mod publication_files;
mod browser_auth;
use tauri_plugin_sql::{Migration, MigrationKind};

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "constellation_initial_schema",
            sql: include_str!("../../../../database/migrations/001_constellation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "derived_compliance_views",
            sql: include_str!("../../../../database/migrations/002_derived_views.sql"),
            kind: MigrationKind::Up,
        },
        Migration { version: 3, description: "local_authoring", sql: include_str!("../../../../database/migrations/003_authoring.sql"), kind: MigrationKind::Up },
        Migration { version: 4, description: "bulk_sds_import", sql: include_str!("../../../../database/migrations/004_bulk_sds_import.sql"), kind: MigrationKind::Up },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            browser_auth::google_browser_sign_in,
            publication_files::read_publication_sds,
            publication_files::store_authoring_sds,
            publication_files::store_sds_import_source,
            authoring::authoring_batch
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:hazcom-navigator.db", migrations())
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running HazCom Navigator");
}

#[cfg(test)]
mod migration_acceptance {
    use super::migrations;
    use sqlx::migrate::{Migration as SqlxMigration, MigrationType, Migrator};
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::borrow::Cow;
    use std::path::PathBuf;

    // Tauri SQL plugin 2.4.1 converts these exact Migration specs into SQLx
    // migrations with no_tx=false, then calls pool.migrate(&migrator). Keeping
    // this fixture on SQLx's Migrator exercises that native migration engine.
    fn migrator(through: i64) -> Migrator {
        let specs = migrations()
            .into_iter()
            .filter(|migration| migration.version <= through)
            .map(|migration| {
                SqlxMigration::new(
                    migration.version,
                    Cow::Borrowed(migration.description),
                    MigrationType::ReversibleUp,
                    Cow::Borrowed(migration.sql),
                    false,
                )
            })
            .collect::<Vec<_>>();
        Migrator {
            migrations: Cow::Owned(specs),
            ignore_missing: false,
            locking: true,
            no_tx: false,
        }
    }

    fn migrator_with_broken_fourth_migration() -> Migrator {
        let specs = migrations().into_iter().map(|migration| {
            let sql = if migration.version == 4 {
                Cow::Owned("CREATE TABLE migration_rollback_probe(id TEXT); INSERT INTO table_that_does_not_exist VALUES('fail');".to_string())
            } else {
                Cow::Borrowed(migration.sql)
            };
            SqlxMigration::new(migration.version, Cow::Borrowed(migration.description), MigrationType::ReversibleUp, sql, false)
        }).collect::<Vec<_>>();
        Migrator { migrations: Cow::Owned(specs), ignore_missing: false, locking: true, no_tx: false }
    }

    async fn authoring_counts(pool: &sqlx::SqlitePool) -> Vec<(String, i64)> {
        let tables = [
            "company", "work_area", "chemical_product", "worker", "work_area_product",
            "work_area_assignment", "sds_verification", "hazcom_review", "training_event",
            "work_area__ownership", "chemical_product__ownership", "worker__ownership",
            "work_area_product__ownership", "work_area_assignment__ownership",
            "sds_verification__ownership", "hazcom_review__ownership", "training_event__ownership",
            "rel_chemical_product_work_area_product_9d42d6cd", "rel_worker_work_area_assignment_d30ac2b9",
            "dm_attachments", "authoring_sds_integrity", "dm_change_history",
        ];
        let mut result = Vec::new();
        for table in tables {
            let count: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM {table}"))
                .fetch_one(pool).await.expect("count pre-existing authoring rows");
            result.push((table.to_string(), count));
        }
        result
    }

    async fn existing_data_snapshot(pool: &sqlx::SqlitePool) -> Vec<(String, String)> {
        use sqlx::Row;
        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'sds_import_%' AND name <> '_sqlx_migrations' ORDER BY name",
        ).fetch_all(pool).await.unwrap();
        let mut snapshot = Vec::new();
        for table in tables {
            let quoted_table = format!("\"{}\"", table.replace('"', "\"\""));
            let pragma = format!("PRAGMA table_info({quoted_table})");
            let columns = sqlx::query(&pragma).fetch_all(pool).await.unwrap()
                .into_iter().map(|row| row.get::<String, _>("name")).collect::<Vec<_>>();
            let quoted_values = columns.iter().map(|column| {
                let quoted = format!("\"{}\"", column.replace('"', "\"\""));
                format!("quote({quoted})")
            }).collect::<Vec<_>>().join(",");
            let query = format!("SELECT COALESCE(json_group_array(json_array({quoted_values})), '[]') FROM (SELECT * FROM {quoted_table} ORDER BY rowid)");
            let rows: String = sqlx::query_scalar(&query).fetch_one(pool).await.unwrap();
            snapshot.push((table, rows));
        }
        snapshot
    }

    #[tokio::test]
    async fn schema_three_upgrade_is_transactional_idempotent_and_preserves_authoring_rows() {
        let copied_database = std::env::var_os("HAZCOM_SCHEMA3_FIXTURE_DB").map(PathBuf::from);
        let options = if let Some(path) = copied_database.as_ref() {
            SqliteConnectOptions::new().filename(path).foreign_keys(true).create_if_missing(false)
        } else {
            SqliteConnectOptions::new().filename(":memory:").foreign_keys(true)
        };
        let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await
            .expect("open disposable SQLite fixture");
        if copied_database.is_some() {
            let version: i64 = sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations WHERE success=1")
                .fetch_one(&pool).await.expect("read copied Tauri migration ledger");
            assert_eq!(version, 3, "copied live workspace must be schema 3 before the test");
        } else {
            migrator(3).run(&pool).await.expect("create schema 3 fixture");

            // Representative Company-scoped authoring graph and SDS metadata from
            // the existing schema, present before the migration under test.
            sqlx::query("INSERT INTO company(id,name,contact_email) VALUES('fixture-co','Fixture Co','safety@example.test')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO work_area(id,name,location,poc_name,poc_email,poc_phone_number,description) VALUES('area-1','Mixing','Building 1','Lead','lead@example.test','555-0100','Fixture area')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO work_area__ownership(id,child_id,relationship_id,company_id) VALUES('area-own','area-1','10f4ef7a-86c3-4f4d-9d33-cff2c0eee738','fixture-co')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO chemical_product(id,product_name,manufacturer,sds_date) VALUES('product-1','Synthetic Cleaner','Example Manufacturer','2026-01-01')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO chemical_product__ownership(id,child_id,relationship_id,company_id) VALUES('product-own','product-1','940a4d09-5250-4b89-9911-1ac6f4ba64cf','fixture-co')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO worker(id,name) VALUES('worker-1','Fixture Worker')").execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO worker__ownership(id,child_id,relationship_id,company_id) VALUES('worker-own','worker-1','1e679f94-12b0-4d70-839e-d54c064f5ab1','fixture-co')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO work_area_product(id,quantity,storage_location,added_date) VALUES('placement-1','1 gal','Cabinet','2026-02-01')").execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO work_area_product__ownership(id,child_id,relationship_id,work_area_id) VALUES('placement-own','placement-1','96db12e7-1201-4f03-8a31-3a8fa6c2ab95','area-1')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO rel_chemical_product_work_area_product_9d42d6cd(id,chemical_product_id,work_area_product_id) VALUES('product-placement','product-1','placement-1')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO work_area_assignment(id,assigned_date,training_required_since) VALUES('assignment-1','2026-02-01','2026-02-01')").execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO work_area_assignment__ownership(id,child_id,relationship_id,work_area_id) VALUES('assignment-own','assignment-1','2915981b-e56b-4e0b-a619-a1fbcf9a6566','area-1')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO rel_worker_work_area_assignment_d30ac2b9(id,worker_id,work_area_assignment_id) VALUES('worker-assignment','worker-1','assignment-1')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO sds_verification(id,verified_at) VALUES('verification-1','2026-02-02')").execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO sds_verification__ownership(id,child_id,relationship_id,chemical_product_id) VALUES('verification-own','verification-1','7b8f5523-3a5c-4bfa-bf83-e5310911ea7b','product-1')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO hazcom_review(id,review_date) VALUES('review-1','2026-02-03')").execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO hazcom_review__ownership(id,child_id,relationship_id,work_area_id) VALUES('review-own','review-1','024e4f65-976b-4a77-8323-d4b317e693a1','area-1')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO training_event(id,training_date) VALUES('training-1','2026-02-04')").execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO training_event__ownership(id,child_id,relationship_id,work_area_assignment_id) VALUES('training-own','training-1','609b3aa7-28ab-498b-8b28-287c5232be85','assignment-1')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO dm_attachments(id,owner_type,owner_id,slot_key,ordinal,relative_path,original_filename,mime_type,size_bytes,created_at) VALUES('sds-1','chemical_product','product-1','sds',0,'fixture/sds-1.pdf','sds-1.pdf','application/pdf',123,'2026-02-01T00:00:00Z')")
                .execute(&pool).await.unwrap();
            sqlx::query("INSERT INTO authoring_sds_integrity(attachment_id,sha256) VALUES('sds-1',?)")
                .bind("a".repeat(64)).execute(&pool).await.unwrap();
        }

        let before_counts = authoring_counts(&pool).await;
        let before_existing_data = existing_data_snapshot(&pool).await;
        let before_sds = sqlx::query_as::<_, (String, String, String, i64, String)>(
            "SELECT a.id,a.owner_id,a.relative_path,a.size_bytes,i.sha256 FROM dm_attachments a JOIN authoring_sds_integrity i ON i.attachment_id=a.id WHERE a.slot_key='sds' ORDER BY a.id",
        ).fetch_all(&pool).await.unwrap();
        let version: i64 = sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations WHERE success=1")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(version, 3);

        migrator(4).run(&pool).await.expect("apply schema 4 migration");
        let version: i64 = sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations WHERE success=1")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(version, 4);
        for table in ["sds_import_session", "sds_import_page", "sds_import_draft"] {
            let found: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?")
                .bind(table).fetch_one(&pool).await.unwrap();
            assert_eq!(found, 1, "missing {table}");
        }
        let index_count: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type='index' AND name IN ('idx_sds_import_session_company','idx_sds_import_draft_session')")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(index_count, 2);
        for (table, expected) in [("sds_import_session", 1_i64), ("sds_import_page", 1_i64), ("sds_import_draft", 1_i64)] {
            let foreign_keys: i64 = sqlx::query_scalar(&format!("SELECT count(*) FROM pragma_foreign_key_list('{table}')"))
                .fetch_one(&pool).await.unwrap();
            assert_eq!(foreign_keys, expected, "unexpected foreign keys for {table}");
        }
        assert_eq!(authoring_counts(&pool).await, before_counts, "migration changed existing authoring rows");
        assert_eq!(existing_data_snapshot(&pool).await, before_existing_data, "migration changed a pre-existing SQLite row");
        let after_sds = sqlx::query_as::<_, (String, String, String, i64, String)>(
            "SELECT a.id,a.owner_id,a.relative_path,a.size_bytes,i.sha256 FROM dm_attachments a JOIN authoring_sds_integrity i ON i.attachment_id=a.id WHERE a.slot_key='sds' ORDER BY a.id",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(after_sds, before_sds, "migration changed existing SDS metadata");
        let fk_errors: i64 = sqlx::query_scalar("SELECT count(*) FROM pragma_foreign_key_check")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(fk_errors, 0);
        let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(integrity, "ok");

        // The plugin keeps its migration ledger and rerunning its migrator is a no-op.
        migrator(4).run(&pool).await.expect("reopen schema 4 fixture");
        let version: i64 = sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations WHERE success=1")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(version, 4);
        assert_eq!(authoring_counts(&pool).await, before_counts, "reopening schema 4 changed existing rows");
        assert_eq!(existing_data_snapshot(&pool).await, before_existing_data, "reopening changed pre-existing SQLite data");
        pool.close().await;
    }

    #[tokio::test]
    async fn failed_schema_four_migration_rolls_back_ddl_and_ledger() {
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        migrator(3).run(&pool).await.expect("create schema 3 fixture");
        assert!(migrator_with_broken_fourth_migration().run(&pool).await.is_err());
        let table_count: i64 = sqlx::query_scalar("SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('migration_rollback_probe','sds_import_session','sds_import_page','sds_import_draft')")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(table_count, 0, "failed migration left schema objects behind");
        let version: i64 = sqlx::query_scalar("SELECT max(version) FROM _sqlx_migrations WHERE success=1")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(version, 3, "failed migration advanced its ledger");
    }
}
