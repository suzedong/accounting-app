use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;
use serde::Serialize;

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

/// Resolve the active AI service from the ai_services list.
fn resolve_active_service(guard: &std::sync::MutexGuard<'_, HashMap<String, String>>) -> Result<AiService, String> {
    let json = guard.get("ai_services")
        .ok_or_else(|| "未配置 AI 服务列表".to_string())?;
    let services: Vec<AiService> = serde_json::from_str(json)
        .map_err(|e| format!("解析 AI 服务配置失败: {}", e))?;

    if let Some(active) = services.iter().find(|s| s.active) {
        return Ok(active.clone());
    }
    services.first()
        .cloned()
        .ok_or_else(|| "AI 服务列表为空".to_string())
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
    call_llm_with_tools(app_config, system_message, Some(user_message), None, false).await
}

#[tauri::command]
pub async fn call_llm_with_tools(
    app_config: State<'_, AppConfig>,
    system_message: String,
    user_message: Option<String>,
    tools_json: Option<String>,
    include_tool_calls: bool,
) -> Result<String, String> {
    let svc = {
        let guard = app_config.data.lock().map_err(|e| e.to_string())?;
        resolve_active_service(&guard).map_err(|e| e)?
    };

    if svc.api_key.is_empty() {
        return Err("未配置 API Key".to_string());
    }

    let endpoint = build_endpoint(&svc.api_url);

    // Build messages array
    let mut messages: Vec<serde_json::Value> = vec![
        serde_json::json!({ "role": "system", "content": system_message }),
    ];
    if let Some(msg) = user_message {
        messages.push(serde_json::json!({ "role": "user", "content": msg }));
    }

    // Build request body
    let mut body = serde_json::json!({
        "model": svc.model,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 4000,
    });

    // Add tools if provided
    if let Some(tools_str) = &tools_json {
        let tools: Vec<serde_json::Value> = serde_json::from_str(tools_str)
            .map_err(|e| format!("解析 tools 失败: {}", e))?;
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(tools);
            body["tool_choice"] = serde_json::json!("auto");
        }
    }

    let client = reqwest::Client::new();
    let response = client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", svc.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = response.status();

    let body_text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        eprintln!("[LLM] Request failed: status={}, model={}, url={}", status, svc.model, endpoint);
        eprintln!("[LLM] Request body size: {} bytes", serde_json::to_string(&body).unwrap_or_default().len());
        eprintln!("[LLM] Response: {}", body_text.chars().take(500).collect::<String>());
        return Err(format!("API 返回错误 ({}): {}", status, body_text));
    }

    let json: serde_json::Value = serde_json::from_str(&body_text)
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let choice = &json["choices"][0];
    let message = &choice["message"];

    // Extract tool_calls if present and requested
    let tool_calls = if include_tool_calls {
        if let Some(calls) = message.get("tool_calls").and_then(|v| v.as_array()) {
            Some(serde_json::json!(calls))
        } else {
            None
        }
    } else {
        None
    };

    let content = message["content"].as_str().unwrap_or("");

    // Return structured response if tool_calls are requested
    if include_tool_calls {
        Ok(serde_json::json!({
            "content": content,
            "tool_calls": tool_calls,
        }).to_string())
    } else {
        Ok(content.to_string())
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
