use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use serde::Serialize;
use std::io::Write;

fn debug_log(msg: &str) {
    let path = std::path::PathBuf::from("D:\\Code\\accounting-app\\llm_debug.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{}", msg);
    }
}

use crate::db::Database;
use crate::models::AiService;

// Simple in-memory config cache (backed by SQLite)
pub struct AppConfig {
    pub data: Mutex<HashMap<String, String>>,
}

impl AppConfig {
    pub fn new(db: &Database) -> Self {
        let mut map = HashMap::new();
        if let Ok(conn) = db.get_conn().lock() {
            let rows: Vec<(String, String)> = conn
                .prepare("SELECT key, value FROM app_config")
                .and_then(|mut stmt| {
                    stmt.query_map([], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
                })
                .unwrap_or_default();
            for (k, v) in rows {
                map.insert(k, v);
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
    {
        let guard = app_config.data.lock().map_err(|e| e.to_string())?;
        if let Some(v) = guard.get(&key) {
            return Ok(v.clone());
        }
    }
    let conn = state.get_conn();
    let value = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn_guard
            .prepare("SELECT value FROM app_config WHERE key = ?")
            .map_err(|e| e.to_string())?;
        stmt.query_row([&key], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Config key '{}' not found: {}", key, e))
    }?;
    if let Ok(mut g) = app_config.data.lock() {
        g.insert(key.clone(), value.clone());
    }
    Ok(value)
}

#[tauri::command]
pub async fn set_config(
    state: State<'_, Database>,
    app_config: State<'_, AppConfig>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = state.get_conn();
    {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        conn_guard
            .execute(
                "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                (&key, &value),
            )
            .map_err(|e| e.to_string())?;
    }
    let mut guard = app_config.data.lock().map_err(|e| e.to_string())?;
    guard.insert(key, value);
    Ok(())
}

#[tauri::command]
pub async fn get_all_config(
    state: State<'_, Database>,
    app_config: State<'_, AppConfig>,
) -> Result<AllConfig, String> {
    let conn = state.get_conn();
    let rows: Vec<(String, String)> = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        conn_guard
            .prepare("SELECT key, value FROM app_config")
            .and_then(|mut stmt| {
                stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .map_err(|e| e.to_string())?
    };
    {
        let mut guard = app_config.data.lock().map_err(|e| e.to_string())?;
        for (k, v) in rows {
            guard.insert(k, v);
        }
    }
    let guard = app_config.data.lock().map_err(|e| e.to_string())?;
    Ok(AllConfig {
        ai_api_key: guard.get("ai_api_key").cloned().unwrap_or_default(),
        ai_api_url: guard.get("ai_api_url").cloned().unwrap_or_else(|| "https://coding.dashscope.aliyuncs.com/v1".to_string()),
        ai_model: guard.get("ai_model").cloned().unwrap_or_else(|| "qwen3.6-plus".to_string()),
        nocobase_url: guard.get("nocobase_url").cloned().unwrap_or_default(),
        nocobase_token: guard.get("nocobase_token").cloned().unwrap_or_default(),
        budget_monthly: guard.get("budget_monthly")
            .and_then(|v| v.parse().ok())
            .unwrap_or(3500.0),
    })
}

// --- AI Services Management ---

#[tauri::command]
pub async fn get_ai_services(
    app_config: State<'_, AppConfig>,
) -> Result<Vec<AiService>, String> {
    let guard = app_config.data.lock().map_err(|e| e.to_string())?;
    if let Some(json) = guard.get("ai_services") {
        let services: Vec<AiService> = serde_json::from_str(json)
            .map_err(|e| format!("解析 AI 服务配置失败: {}", e))?;
        Ok(services)
    } else {
        Ok(vec![])
    }
}

#[tauri::command]
pub async fn save_ai_services(
    state: State<'_, Database>,
    app_config: State<'_, AppConfig>,
    services: Vec<AiService>,
) -> Result<(), String> {
    // Ensure only one service is active
    let mut services = services;
    let mut found_active = false;
    for s in &mut services {
        if s.active && !found_active {
            found_active = true;
        } else {
            s.active = false;
        }
    }
    if !found_active && !services.is_empty() {
        services[0].active = true;
    }

    let json = serde_json::to_string(&services)
        .map_err(|e| format!("序列化失败: {}", e))?;
    let conn = state.get_conn();
    {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        conn_guard
            .execute(
                "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                ("ai_services", &json),
            )
            .map_err(|e| e.to_string())?;
    }
    let mut guard = app_config.data.lock().map_err(|e| e.to_string())?;
    guard.insert("ai_services".to_string(), json);
    Ok(())
}

#[tauri::command]
pub async fn activate_ai_service(
    state: State<'_, Database>,
    app_config: State<'_, AppConfig>,
    id: String,
) -> Result<(), String> {
    // Read current services
    let mut services = {
        let guard = app_config.data.lock().map_err(|e| e.to_string())?;
        if let Some(json) = guard.get("ai_services") {
            serde_json::from_str::<Vec<AiService>>(json)
                .map_err(|e| format!("解析 AI 服务配置失败: {}", e))?
        } else {
            vec![]
        }
    };

    // Set active
    for s in &mut services {
        s.active = s.id == id;
    }

    // Save back
    let json = serde_json::to_string(&services)
        .map_err(|e| format!("序列化失败: {}", e))?;
    let conn = state.get_conn();
    {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        conn_guard
            .execute(
                "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                ("ai_services", &json),
            )
            .map_err(|e| e.to_string())?;
    }
    let mut guard = app_config.data.lock().map_err(|e| e.to_string())?;
    guard.insert("ai_services".to_string(), json);
    Ok(())
}

/// Resolve the active AI service. Falls back to legacy config fields if no services defined.
fn resolve_active_service(guard: &std::sync::MutexGuard<'_, HashMap<String, String>>) -> Result<AiService, String> {
    // Try ai_services list first
    if let Some(json) = guard.get("ai_services") {
        let services: Vec<AiService> = serde_json::from_str(json)
            .map_err(|e| format!("解析 AI 服务配置失败: {}", e))?;
        if let Some(active) = services.iter().find(|s| s.active) {
            return Ok(active.clone());
        }
        if let Some(first) = services.first() {
            return Ok(first.clone());
        }
    }

    // Fallback: build from legacy fields
    let api_key = guard.get("ai_api_key").cloned().ok_or_else(|| "未配置 AI API Key".to_string())?;
    let api_url = guard.get("ai_api_url")
        .cloned()
        .unwrap_or_else(|| "https://coding.dashscope.aliyuncs.com/v1".to_string());
    let model = guard.get("ai_model")
        .cloned()
        .unwrap_or_else(|| "qwen3.6-plus".to_string());

    Ok(AiService {
        id: "legacy".to_string(),
        name: "旧版配置".to_string(),
        api_url,
        api_key,
        model,
        active: true,
    })
}

fn build_endpoint(api_url: &str) -> String {
    // Strip trailing /v1 if present, then append the full path
    let base = api_url.strip_suffix("/v1").unwrap_or(api_url);
    format!("{}/v1/chat/completions", base)
}

#[tauri::command]
pub async fn call_llm(
    app_config: State<'_, AppConfig>,
    system_message: String,
    user_message: String,
) -> Result<String, String> {
    debug_log("[call_llm] FUNCTION CALLED");

    let svc = {
        let guard = app_config.data.lock().map_err(|e| {
            let msg = e.to_string();
            debug_log(&format!("[call_llm] lock error: {}", msg));
            msg
        })?;
        resolve_active_service(&guard).map_err(|e| {
            debug_log(&format!("[call_llm] resolve error: {}", e));
            e
        })?
    };

    debug_log(&format!("[call_llm] service: {} model: {}", svc.name, svc.model));
    debug_log(&format!("[call_llm] api_key len: {}", svc.api_key.len()));

    if svc.api_key.is_empty() {
        debug_log("[call_llm] ERROR: empty api key");
        return Err("未配置 API Key".to_string());
    }

    let endpoint = build_endpoint(&svc.api_url);
    debug_log(&format!("[call_llm] endpoint: {}", endpoint));

    let client = reqwest::Client::new();
    let response = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", svc.api_key))
        .json(&serde_json::json!({
            "model": svc.model,
            "messages": [
                { "role": "system", "content": system_message },
                { "role": "user", "content": user_message }
            ],
            "temperature": 0.1,
            "max_tokens": 2000,
        }))
        .send()
        .await
        .map_err(|e| {
            let msg = format!("请求失败: {}", e);
            debug_log(&format!("[call_llm] REQUEST ERROR: {}", msg));
            msg
        })?;

    let status = response.status();
    debug_log(&format!("[call_llm] status: {}", status));

    let body = response
        .text()
        .await
        .map_err(|e| {
            let msg = format!("读取响应失败: {}", e);
            debug_log(&format!("[call_llm] READ ERROR: {}", msg));
            msg
        })?;

    debug_log(&format!("[call_llm] body len: {}", body.len()));

    if status.is_success() {
        let json: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| {
                let msg = format!("解析响应失败: {}", e);
                debug_log(&format!("[call_llm] PARSE ERROR: {}", msg));
                msg
            })?;
        // Log the full response structure for debugging
        debug_log(&format!("[call_llm] choices count: {}", json["choices"].as_array().map_or(0, |a| a.len())));
        if let Some(choices) = json["choices"].as_array() {
            if let Some(first) = choices.first() {
                debug_log(&format!("[call_llm] first choice keys: {:?}", first.as_object().map_or(vec![], |o| o.keys().collect::<Vec<_>>())));
                debug_log(&format!("[call_llm] message.content: {:?}", first["message"]["content"]));
                if let Some(tool_calls) = first["message"]["tool_calls"].as_array() {
                    debug_log(&format!("[call_llm] tool_calls count: {}", tool_calls.len()));
                }
            }
        }
        let content = json["choices"][0]["message"]["content"]
            .as_str()
            .ok_or_else(|| {
                let msg = format!("LLM 返回空响应, JSON: {}", &body[..body.len().min(500)]);
                debug_log(&format!("[call_llm] EMPTY CONTENT: {}", msg));
                msg
            })?;
        debug_log(&format!("[call_llm] content len: {}", content.len()));
        Ok(content.to_string())
    } else {
        let msg = format!("API 返回错误 ({}): {}", status, body);
        debug_log(&format!("[call_llm] ERROR: {}", msg));
        Err(msg)
    }
}

#[tauri::command]
pub async fn test_ai_connection(
    app_config: State<'_, AppConfig>,
) -> Result<serde_json::Value, String> {
    let (api_key, api_url, model) = {
        let guard = app_config.data.lock().map_err(|e| e.to_string())?;
        let svc = resolve_active_service(&guard)?;
        (svc.api_key, svc.api_url, svc.model)
    };

    let endpoint = build_endpoint(&api_url);

    let client = reqwest::Client::new();
    let response = client
        .post(&endpoint)
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
