use tauri::State;
use serde::Serialize;
use serde::Deserialize;

use crate::db::Database;
use crate::db::nocobase::client::NocoBaseClient;
use crate::db::nocobase::push::push_records;
use crate::db::nocobase::pull::pull_records;
use crate::db::nocobase::trip_sync::{push_trips, pull_trips};
use crate::db::nocobase::learning_sync::{push_learning, pull_learning};

#[derive(Serialize)]
pub struct TableSyncResult {
    pub records_pushed: i32,
    pub records_pulled: i32,
    pub trips_pushed: i32,
    pub trips_pulled: i32,
    pub learning_pushed: i32,
    pub learning_pulled: i32,
    pub total_pushed: i32,
    pub total_pulled: i32,
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
) -> Result<TableSyncResult, String> {
    let (url, token) = get_nocobase_config(&state)?;
    let client = NocoBaseClient::new(url, token);

    let mut all_errors = Vec::new();

    // 推送记账记录
    let (records_pushed, errors) = push_records(&state, &client).await?;
    all_errors.extend(errors);

    // 推送差旅补助
    let (trips_pushed, errors) = push_trips(&state, &client).await?;
    all_errors.extend(errors);

    // 推送学习数据
    let (learning_pushed, errors) = push_learning(&state, &client).await?;
    all_errors.extend(errors);

    let total_pushed = records_pushed + trips_pushed + learning_pushed;

    Ok(TableSyncResult {
        records_pushed,
        records_pulled: 0,
        trips_pushed,
        trips_pulled: 0,
        learning_pushed,
        learning_pulled: 0,
        total_pushed,
        total_pulled: 0,
        errors: all_errors,
    })
}

#[tauri::command]
pub async fn sync_pull(
    state: State<'_, Database>,
) -> Result<TableSyncResult, String> {
    let (url, token) = get_nocobase_config(&state)?;
    let client = NocoBaseClient::new(url, token);

    let mut all_errors = Vec::new();

    // 拉取记账记录
    let (records_pulled, errors) = pull_records(&state, &client).await?;
    all_errors.extend(errors);

    // 拉取差旅补助
    let (trips_pulled, errors) = pull_trips(&state, &client).await?;
    all_errors.extend(errors);

    // 拉取学习数据
    let (learning_pulled, errors) = pull_learning(&state, &client).await?;
    all_errors.extend(errors);

    let total_pulled = records_pulled + trips_pulled + learning_pulled;

    Ok(TableSyncResult {
        records_pushed: 0,
        records_pulled,
        trips_pushed: 0,
        trips_pulled,
        learning_pushed: 0,
        learning_pulled,
        total_pushed: 0,
        total_pulled,
        errors: all_errors,
    })
}

#[tauri::command]
pub async fn sync_full(
    state: State<'_, Database>,
) -> Result<TableSyncResult, String> {
    let (url, token) = get_nocobase_config(&state)?;
    let client = NocoBaseClient::new(url, token);

    let mut all_errors = Vec::new();

    // 先 Pull（获取 NocoBase 更新）
    let (records_pulled, errors) = pull_records(&state, &client).await?;
    all_errors.extend(errors);

    let (trips_pulled, errors) = pull_trips(&state, &client).await?;
    all_errors.extend(errors);

    let (learning_pulled, errors) = pull_learning(&state, &client).await?;
    all_errors.extend(errors);

    // 再 Push（推送本地未同步记录）
    let (records_pushed, errors) = push_records(&state, &client).await?;
    all_errors.extend(errors);

    let (trips_pushed, errors) = push_trips(&state, &client).await?;
    all_errors.extend(errors);

    let (learning_pushed, errors) = push_learning(&state, &client).await?;
    all_errors.extend(errors);

    let total_pushed = records_pushed + trips_pushed + learning_pushed;
    let total_pulled = records_pulled + trips_pulled + learning_pulled;

    Ok(TableSyncResult {
        records_pushed,
        records_pulled,
        trips_pushed,
        trips_pulled,
        learning_pushed,
        learning_pulled,
        total_pushed,
        total_pulled,
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
