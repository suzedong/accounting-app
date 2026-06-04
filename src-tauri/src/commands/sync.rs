use tauri::State;
use serde::Serialize;
use serde::Deserialize;

use crate::db::Database;
use crate::db::nocobase::client::NocoBaseClient;
use crate::db::nocobase::push::push_records;
use crate::db::nocobase::pull::pull_records;

#[derive(Serialize)]
pub struct SyncResult {
    pub pushed: i32,
    pub pulled: i32,
    pub errors: Vec<String>,
}

#[derive(Deserialize)]
pub struct TestConnectionParams {
    pub url: String,
    pub token: String,
}

#[tauri::command]
pub async fn nocobase_test_connection(
    params: TestConnectionParams,
) -> Result<(), String> {
    let client = NocoBaseClient::new(params.url, params.token);
    client.test_connection().await
}

/// 获取 NocoBase 配置
fn get_nocobase_config(db: &Database) -> Result<(String, String), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare("SELECT key, value FROM app_config WHERE key IN ('nocobase_url', 'nocobase_token')")
        .map_err(|e| e.to_string())?;

    let mut url = None;
    let mut token = None;

    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect::<Vec<_>>();

    for (key, value) in rows {
        match key.as_str() {
            "nocobase_url" => url = Some(value),
            "nocobase_token" => token = Some(value),
            _ => {}
        }
    }

    match (url, token) {
        (Some(u), Some(t)) => Ok((u, t)),
        _ => Err("NocoBase 配置不完整，请设置 URL 和 Token".to_string()),
    }
}

#[tauri::command]
pub async fn sync_push(
    state: State<'_, Database>,
) -> Result<SyncResult, String> {
    let (url, token) = get_nocobase_config(&state)?;
    let client = NocoBaseClient::new(url, token);

    let (pushed, errors) = push_records(&state, &client).await?;

    Ok(SyncResult {
        pushed,
        pulled: 0,
        errors,
    })
}

#[tauri::command]
pub async fn sync_pull(
    state: State<'_, Database>,
) -> Result<SyncResult, String> {
    let (url, token) = get_nocobase_config(&state)?;
    let client = NocoBaseClient::new(url, token);

    let (pulled, errors) = pull_records(&state, &client).await?;

    Ok(SyncResult {
        pushed: 0,
        pulled,
        errors,
    })
}

#[tauri::command]
pub async fn sync_full(
    state: State<'_, Database>,
) -> Result<SyncResult, String> {
    let (url, token) = get_nocobase_config(&state)?;
    let client = NocoBaseClient::new(url, token);

    // 先 Pull（获取 NocoBase 更新）
    let (pulled, pull_errors) = pull_records(&state, &client).await?;

    // 再 Push（推送本地未同步记录）
    let (pushed, push_errors) = push_records(&state, &client).await?;

    let mut all_errors = pull_errors;
    all_errors.extend(push_errors);

    Ok(SyncResult {
        pushed,
        pulled,
        errors: all_errors,
    })
}

#[tauri::command]
pub async fn get_sync_logs(
    state: State<'_, Database>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let logs = crate::db::sync_log::get_logs(state.inner(), limit.unwrap_or(20))?;
    Ok(serde_json::json!({ "data": logs }))
}
