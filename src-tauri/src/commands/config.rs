use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use serde::Serialize;

use crate::db::Database;

// Simple in-memory config cache (backed by SQLite)
pub struct AppConfig {
    pub data: Mutex<HashMap<String, String>>,
}

impl AppConfig {
    pub fn new(db: &Database) -> Self {
        let mut map = HashMap::new();
        // Load from SQLite into memory cache
        if let Ok(conn) = db.get_conn().lock() {
            let mut stmt = match conn.prepare("SELECT key, value FROM app_config") {
                Ok(s) => s,
                Err(_) => return Self { data: Mutex::new(map) },
            };
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for row in rows.filter_map(|r| r.ok()) {
                    map.insert(row.0, row.1);
                }
            }
        }
        Self { data: Mutex::new(map) }
    }
}

#[derive(Serialize)]
pub struct AllConfig {
    pub ai_api_key: String,
    pub ai_api_url: String,
    pub ai_model: String,
    pub nocobase_url: String,
    pub nocobase_token: String,
    pub budget_monthly: f64,
}

#[tauri::command]
pub async fn get_config(
    state: State<'_, Database>,
    app_config: State<'_, AppConfig>,
    key: String,
) -> Result<String, String> {
    // Check memory cache first
    let guard = app_config.data.lock().map_err(|e| e.to_string())?;
    if let Some(v) = guard.get(&key) {
        return Ok(v.clone());
    }
    drop(guard);

    // Fallback to SQLite
    let conn = state.get_conn();
    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn_guard
        .prepare("SELECT value FROM app_config WHERE key = ?")
        .map_err(|e| e.to_string())?;
    let result: Result<String, _> = stmt.query_row([&key], |row| row.get(0));
    match result {
        Ok(v) => {
            drop(conn_guard);
            // Populate memory cache
            if let Ok(mut g) = app_config.data.lock() {
                g.insert(key.clone(), v.clone());
            }
            Ok(v)
        }
        Err(_) => Err(format!("Config key '{}' not found", key)),
    }
}

#[tauri::command]
pub async fn set_config(
    state: State<'_, Database>,
    app_config: State<'_, AppConfig>,
    key: String,
    value: String,
) -> Result<(), String> {
    // Persist to SQLite
    let conn = state.get_conn();
    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    conn_guard.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
        (&key, &value),
    )
    .map_err(|e| e.to_string())?;

    // Update memory cache
    let mut guard = app_config.data.lock().map_err(|e| e.to_string())?;
    guard.insert(key, value);
    Ok(())
}

#[tauri::command]
pub async fn get_all_config(
    state: State<'_, Database>,
    app_config: State<'_, AppConfig>,
) -> Result<AllConfig, String> {
    // Ensure cache is populated from SQLite
    let keys = ["ai_api_key", "ai_api_url", "ai_model", "nocobase_url", "nocobase_token", "budget_monthly"];
    let conn = state.get_conn();
    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn_guard
        .prepare("SELECT key, value FROM app_config")
        .map_err(|e| e.to_string())?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(conn_guard);

    // Populate memory cache
    let mut guard = app_config.data.lock().map_err(|e| e.to_string())?;
    for (k, v) in rows {
        guard.insert(k, v);
    }

    Ok(AllConfig {
        ai_api_key: guard.get("ai_api_key").cloned().unwrap_or_default(),
        ai_api_url: guard.get("ai_api_url").cloned().unwrap_or_else(|| "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string()),
        ai_model: guard.get("ai_model").cloned().unwrap_or_else(|| "qwen-plus".to_string()),
        nocobase_url: guard.get("nocobase_url").cloned().unwrap_or_default(),
        nocobase_token: guard.get("nocobase_token").cloned().unwrap_or_default(),
        budget_monthly: guard.get("budget_monthly")
            .and_then(|v| v.parse().ok())
            .unwrap_or(3500.0),
    })
}

#[tauri::command]
pub async fn test_ai_connection(
    app_config: State<'_, AppConfig>,
) -> Result<serde_json::Value, String> {
    let guard = app_config.data.lock().map_err(|e| e.to_string())?;
    let api_key = guard.get("ai_api_key").cloned().ok_or_else(|| "未配置 API Key".to_string())?;
    let api_url = guard.get("ai_api_url").cloned().unwrap_or_else(|| "https://dashscope.aliyuncs.com/compatible-mode/v1".to_string());
    let model = guard.get("ai_model").cloned().unwrap_or_else(|| "qwen-plus".to_string());
    drop(guard);

    let client = reqwest::Client::new();
    let response = client
        .post(&format!("{}/chat/completions", api_url))
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&serde_json::json!({
            "model": model,
            "messages": [{"role": "user", "content": "你好，请回复OK"}],
            "max_tokens": 10,
        }))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if response.status().is_success() {
        Ok(serde_json::json!({ "success": true, "message": "连接成功" }))
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        Err(format!("API 返回错误 ({}): {}", status, body))
    }
}
