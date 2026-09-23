mod authoring;
mod publication_files;
mod browser_auth;
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
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
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            browser_auth::google_browser_sign_in,
            publication_files::read_publication_sds,
            publication_files::store_authoring_sds,
            authoring::authoring_batch
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:hazcom-navigator.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running HazCom Navigator");
}
