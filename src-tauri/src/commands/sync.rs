use tauri::State;
use serde::Serialize;

use crate::db::Database;

#[derive(Serialize)]
pub struct SyncResult {
    pub pushed: i32,
    pub pulled: i32,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn sync_push(
    _state: State<'_, Database>,
) -> Result<SyncResult, String> {
    // TODO: implement push logic
    Ok(SyncResult {
        pushed: 0,
        pulled: 0,
        errors: vec!["Sync not yet implemented".to_string()],
    })
}

#[tauri::command]
pub async fn sync_pull(
    _state: State<'_, Database>,
) -> Result<SyncResult, String> {
    // TODO: implement pull logic
    Ok(SyncResult {
        pushed: 0,
        pulled: 0,
        errors: vec!["Sync not yet implemented".to_string()],
    })
}

#[tauri::command]
pub async fn sync_full(
    _state: State<'_, Database>,
) -> Result<SyncResult, String> {
    // TODO: implement full sync
    Ok(SyncResult {
        pushed: 0,
        pulled: 0,
        errors: vec!["Sync not yet implemented".to_string()],
    })
}

#[tauri::command]
pub async fn import_from_nocobase(
    _state: State<'_, Database>,
) -> Result<serde_json::Value, String> {
    // TODO: implement import
    Ok(serde_json::json!({
        "imported": 0,
        "errors": ["Import not yet implemented"]
    }))
}

#[tauri::command]
pub async fn get_sync_logs(
    state: State<'_, Database>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let conn = state.get_conn()?;
    let logs = crate::db::sync_log::get_logs(&conn, limit.unwrap_or(20))?;
    Ok(serde_json::json!({ "data": logs }))
}
