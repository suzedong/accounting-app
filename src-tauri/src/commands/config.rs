use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use serde::Serialize;

use crate::db::Database;

// Simple in-memory config cache
pub struct AppConfig {
    pub data: Mutex<HashMap<String, String>>,
}

impl AppConfig {
    pub fn new() -> Self {
        Self {
            data: Mutex::new(HashMap::new()),
        }
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
    _state: State<'_, Database>,
    _app_config: State<'_, AppConfig>,
    key: String,
) -> Result<String, String> {
    let guard = _app_config.data.lock().map_err(|e| e.to_string())?;
    guard.get(&key).cloned().ok_or_else(|| format!("Config key '{}' not found", key))
}

#[tauri::command]
pub async fn set_config(
    _state: State<'_, Database>,
    app_config: State<'_, AppConfig>,
    key: String,
    value: String,
) -> Result<(), String> {
    // TODO: persist to SQLite config table
    let mut guard = app_config.data.lock().map_err(|e| e.to_string())?;
    guard.insert(key, value);
    Ok(())
}

#[tauri::command]
pub async fn get_all_config(
    _state: State<'_, Database>,
    app_config: State<'_, AppConfig>,
) -> Result<AllConfig, String> {
    let guard = app_config.data.lock().map_err(|e| e.to_string())?;
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
