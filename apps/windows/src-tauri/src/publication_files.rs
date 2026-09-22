use std::{fs, io::Read, path::{Component, Path}};
use tauri::Manager;

// Managed SDS references are relative to the application's attachments directory.
// No arbitrary author filesystem paths are exposed through this command.
#[tauri::command]
pub fn read_publication_sds(app: tauri::AppHandle, relative_path: String) -> Result<Vec<u8>, String> {
    let relative = Path::new(&relative_path);
    if relative_path.is_empty() || relative_path.contains(':') || relative.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("Unsafe managed SDS path".into());
    }
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("attachments").canonicalize().map_err(|e| e.to_string())?;
    let file = root.join(relative).canonicalize().map_err(|e| e.to_string())?;
    if !file.starts_with(&root) { return Err("SDS path escapes managed storage".into()); }
    let mut bytes = Vec::new();
    fs::File::open(file).map_err(|e| e.to_string())?.take(5 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > 5 * 1024 * 1024 || !bytes.starts_with(b"%PDF-") { return Err("Invalid SDS PDF or size".into()); }
    Ok(bytes)
}
