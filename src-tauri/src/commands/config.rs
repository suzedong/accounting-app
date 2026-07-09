use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, State};
use serde::Serialize;

use crate::db::Database;
use crate::models::AiService;
use crate::app_log;

// Simple in-memory config cache (backed by SQLite)
pub struct AppConfig {
    pub data: Mutex<HashMap<String, String>>,
}

impl AppConfig {
    /// 当前操作系统对应的 `active_python_path` key。与 `commands/ocr.rs::PY_KEY`
    /// 保持一致；此处重复声明是为了避免跨模块循环依赖。
    #[cfg(target_os = "macos")]
    const PY_KEY: &'static str = "active_python_path_macos";
    #[cfg(target_os = "windows")]
    const PY_KEY: &'static str = "active_python_path_windows";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    const PY_KEY: &'static str = "active_python_path_linux";

    pub async fn new(db: &Database) -> Self {
        let mut map = HashMap::new();
        if let Ok(conn) = db.get_conn().await {
            if let Ok(mut rows) = conn.query("SELECT key, value FROM app_config", ()).await {
                while let Ok(Some(row)) = rows.next().await {
                    // 用 get_value 避免 NULL 触发 libsql 0.9 panic
                    let k = match row.get_value(0) {
                        Ok(libsql::Value::Text(s)) => s,
                        _ => continue,
                    };
                    let v = match row.get_value(1) {
                        Ok(libsql::Value::Text(s)) => s,
                        Ok(libsql::Value::Null) => String::new(),
                        _ => continue,
                    };
                    map.insert(k, v);
                }
            }

            // 平台相关配置迁移：把旧的 `active_python_path` 单 key 迁移到当前平台的新 key。
            // 只在**新 key 尚未存在**时迁移，避免覆盖用户已经在新 key 上做过的选择。
            // 迁移后删除旧 key，防止再次同步到另一台电脑造成"回退"。
            if let Some(legacy_value) = map.get("active_python_path").cloned() {
                if !legacy_value.is_empty() && !map.contains_key(Self::PY_KEY) {
                    eprintln!(
                        "[Config] 迁移 active_python_path → {}: {}",
                        Self::PY_KEY,
                        legacy_value
                    );
                    let _ = conn
                        .execute(
                            "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
                            libsql::params![Self::PY_KEY, legacy_value.clone()],
                        )
                        .await;
                    map.insert(Self::PY_KEY.to_string(), legacy_value);
                }
                let _ = conn
                    .execute(
                        "DELETE FROM app_config WHERE key = ?",
                        libsql::params!["active_python_path"],
                    )
                    .await;
                map.remove("active_python_path");
            }
        }
        Self {
            data: Mutex::new(map),
        }
    }
}

#[derive(Serialize)]
pub struct AllConfig {
    pub budget_monthly: f64,
    pub turso_sync_enabled: bool,
    pub turso_url: String,
    pub turso_token: String,
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
    let conn = state.get_conn().await?;
    let value = {
        let mut rows = conn
            .query(
                "SELECT value FROM app_config WHERE key = ?",
                libsql::params![key.clone()],
            )
            .await
            .map_err(|e| format!("Config key '{}' query failed: {}", key, e))?;
        match rows.next().await.map_err(|e| e.to_string())? {
            Some(row) => match row.get_value(0).map_err(|e| e.to_string())? {
                libsql::Value::Text(s) => s,
                libsql::Value::Null => String::new(),
                _ => return Err(format!("Config key '{}' has unexpected type", key)),
            },
            None => return Err(format!("Config key '{}' not found", key)),
        }
    };
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
    let conn = state.get_conn().await?;
    conn.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
        libsql::params![key.clone(), value.clone()],
    )
    .await
    .map_err(|e| e.to_string())?;
    let mut guard = app_config.data.lock().map_err(|e| e.to_string())?;
    guard.insert(key, value);
    Ok(())
}

#[tauri::command]
pub async fn get_all_config(
    app_config: State<'_, AppConfig>,
) -> Result<AllConfig, String> {
    let guard = app_config.data.lock().map_err(|e| e.to_string())?;
    Ok(AllConfig {
        budget_monthly: guard.get("budget_monthly")
            .and_then(|v| v.parse().ok())
            .unwrap_or(3500.0),
        turso_sync_enabled: guard.get("turso_sync_enabled")
            .map(|v| v == "true")
            .unwrap_or(false),
        turso_url: guard.get("turso_url").cloned().unwrap_or_default(),
        turso_token: guard.get("turso_token").cloned().unwrap_or_default(),
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
    let conn = state.get_conn().await?;
    conn.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
        libsql::params!["ai_services", json.clone()],
    )
    .await
    .map_err(|e| e.to_string())?;
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
    let conn = state.get_conn().await?;
    conn.execute(
        "INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)",
        libsql::params!["ai_services", json.clone()],
    )
    .await
    .map_err(|e| e.to_string())?;
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
    app: AppHandle,
    app_config: State<'_, AppConfig>,
    system_message: String,
    user_message: String,
) -> Result<String, String> {
    call_llm_with_tools(app, app_config, system_message, Some(user_message), None, false).await
}

#[tauri::command]
pub async fn call_llm_with_tools(
    app: AppHandle,
    app_config: State<'_, AppConfig>,
    system_message: String,
    user_message: Option<String>,
    tools_json: Option<String>,
    include_tool_calls: bool,
) -> Result<String, String> {
    let started_at = Instant::now();
    let svc = {
        let guard = app_config.data.lock().map_err(|e| e.to_string())?;
        match resolve_active_service(&guard) {
            Ok(svc) => svc,
            Err(e) => {
                app_log!(&app, Warn, "llm", &format!("AI 服务未就绪: {}", e));
                return Err(e);
            }
        }
    };

    if svc.api_key.is_empty() {
        app_log!(&app, Warn, "llm", &format!("AI 服务 {} 未配置 API Key", svc.model));
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
    let mut has_tools = false;
    if let Some(tools_str) = &tools_json {
        let tools: Vec<serde_json::Value> = match serde_json::from_str(tools_str) {
            Ok(tools) => tools,
            Err(e) => {
                app_log!(&app, Error, "llm", &format!("解析 tools 失败: {}", e));
                return Err(format!("解析 tools 失败: {}", e));
            }
        };
        if !tools.is_empty() {
            has_tools = true;
            body["tools"] = serde_json::json!(tools);
            body["tool_choice"] = serde_json::json!("auto");
        }
    }

    let client = reqwest::Client::new();
    let response = match client
        .post(&endpoint)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", svc.api_key))
        .json(&body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            app_log!(&app, Error, "llm", &format!("请求失败: model={}, url={}, error={}", svc.model, endpoint, e));
            return Err(format!("请求失败: {}", e));
        }
    };

    let status = response.status();

    let body_text = match response.text().await {
        Ok(text) => text,
        Err(e) => {
            app_log!(&app, Error, "llm", &format!("读取响应失败: model={}, error={}", svc.model, e));
            return Err(format!("读取响应失败: {}", e));
        }
    };

    if !status.is_success() {
        let response_preview = body_text.chars().take(500).collect::<String>();
        app_log!(
            &app,
            Error,
            "llm",
            &format!("API 返回错误: status={}, model={}, url={}, response={}", status, svc.model, endpoint, response_preview)
        );
        return Err(format!("API 返回错误 ({}): {}", status, body_text));
    }

    let json: serde_json::Value = match serde_json::from_str(&body_text) {
        Ok(json) => json,
        Err(e) => {
            app_log!(&app, Error, "llm", &format!("解析响应失败: model={}, error={}", svc.model, e));
            return Err(format!("解析响应失败: {}", e));
        }
    };

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
    app_log!(
        &app,
        Info,
        "llm",
        &format!("LLM 请求成功: model={}, tools={}", svc.model, has_tools),
        started_at.elapsed().as_millis() as u64
    );

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
    app: AppHandle,
    app_config: State<'_, AppConfig>,
) -> Result<serde_json::Value, String> {
    let started_at = Instant::now();
    let (api_key, api_url, model) = {
        let guard = app_config.data.lock().map_err(|e| e.to_string())?;
        let svc = resolve_active_service(&guard)?;
        (svc.api_key, svc.api_url, svc.model)
    };

    let endpoint = build_endpoint(&api_url);

    let client = reqwest::Client::new();
    let response = match client
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
    {
        Ok(response) => response,
        Err(e) => {
            app_log!(&app, Error, "llm", &format!("测试连接失败: model={}, url={}, error={}", model, endpoint, e));
            return Err(format!("请求失败: {}", e));
        }
    };

    if response.status().is_success() {
        app_log!(
            &app,
            Info,
            "llm",
            &format!("测试连接成功: model={}", model),
            started_at.elapsed().as_millis() as u64
        );
        Ok(serde_json::json!({ "success": true, "message": "连接成功" }))
    } else {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        let body_preview = body.chars().take(500).collect::<String>();
        app_log!(
            &app,
            Error,
            "llm",
            &format!("测试连接失败: model={}, status={}, response={}", model, status, body_preview)
        );
        Err(format!("API 返回错误 ({}): {}", status, body))
    }
}

// --- Turso Embedded Replica Sync ---

/// 触发一次 Turso Embedded Replica 双向同步。
///
/// 前置条件：应用启动时读取 `turso_sync_enabled/turso_url/turso_token` 配置；
/// 若已启用远程 URL/Token，则 Database 会以 Embedded Replica 方式打开，
/// 此命令会调用 `db.sync()` 完成一次双向同步。
///
/// 若未启用（纯本地模式），仍然会调用底层的 `sync()`，libsql 会返回错误或空结果，
/// 我们对错误予以透传。
#[tauri::command]
pub async fn sync_turso(state: State<'_, Database>) -> Result<serde_json::Value, String> {
    state.sync().await?;
    Ok(serde_json::json!({ "success": true, "message": "Turso 同步完成" }))
}

/// 测试到 Turso 的连接（并未真正打开 replica，仅通过 HTTP 探测健康）。
///
/// libsql 的远程连接建立在 build/sync 阶段，为避免创建/覆盖本地 replica 文件，
/// 我们只是简单地发起一个 HTTP GET 到 `{url}/health`（Turso 提供）作为可达性检测。
#[tauri::command]
pub async fn test_turso_connection(
    url: String,
    token: String,
) -> Result<serde_json::Value, String> {
    if url.trim().is_empty() {
        return Err("Turso URL 为空".to_string());
    }
    if token.trim().is_empty() {
        return Err("Turso Token 为空".to_string());
    }

    // 将 libsql:// 协议替换为 https:// 以便通过 HTTP 探测
    let base = url
        .trim()
        .trim_end_matches('/')
        .replacen("libsql://", "https://", 1);
    let health_url = format!("{}/health", base);

    let client = reqwest::Client::new();
    let resp = client
        .get(&health_url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    if resp.status().is_success() {
        Ok(serde_json::json!({ "success": true, "message": "Turso 连接可达" }))
    } else {
        Err(format!("Turso 返回错误: {}", resp.status()))
    }
}

#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    use std::process::Command;

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("无法打开文件夹: {}", e))?;
    }

    Ok(())
}
