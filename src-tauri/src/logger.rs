#![allow(dead_code)]

use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Emitter;

/// Log level for frontend display
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AppLogLevel {
    Info,
    Warn,
    Error,
    Debug,
    Sql,
    Ipc,
}

impl AppLogLevel {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
            Self::Debug => "DEBUG",
            Self::Sql => "SQL",
            Self::Ipc => "IPC",
        }
    }
}

/// Log entry sent to frontend
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogEntry {
    pub id: u64,
    pub level: AppLogLevel,
    pub module: String,
    pub message: String,
    pub timestamp: String,
    pub latency_ms: Option<u64>,
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Emit a log entry to the frontend via Tauri event.
/// Also prints to stderr for terminal visibility.
pub fn emit_log(app: &tauri::AppHandle, level: AppLogLevel, module: &str, message: &str) {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();

    let entry = AppLogEntry {
        id,
        level,
        module: module.to_string(),
        message: message.to_string(),
        timestamp,
        latency_ms: None,
    };

    // Also print to terminal
    eprintln!("[{}] [{}] {}", level.label(), module, message);

    let _ = app.emit("app_log", &entry);
}

/// Emit a log entry with latency info
pub fn emit_log_with_latency(
    app: &tauri::AppHandle,
    level: AppLogLevel,
    module: &str,
    message: &str,
    latency_ms: u64,
) {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();

    let entry = AppLogEntry {
        id,
        level,
        module: module.to_string(),
        message: message.to_string(),
        timestamp,
        latency_ms: Some(latency_ms),
    };

    eprintln!("[{}] [{}] {} ({}ms)", level.label(), module, message, latency_ms);

    let _ = app.emit("app_log", &entry);
}

/// Convenience macro: log with app handle available in scope
/// Usage: app_log!(app, Info, "records", "created record id=42")
#[macro_export]
macro_rules! app_log {
    ($app:expr, $level:ident, $module:expr, $msg:expr) => {
        $crate::logger::emit_log($app, $crate::logger::AppLogLevel::$level, $module, $msg)
    };
    ($app:expr, $level:ident, $module:expr, $msg:expr, $latency:expr) => {
        $crate::logger::emit_log_with_latency($app, $crate::logger::AppLogLevel::$level, $module, $msg, $latency)
    };
}

/// Convenience macro for SQL logging (no app handle needed — just prints)
#[macro_export]
macro_rules! sql_log {
    ($msg:expr) => {
        eprintln!("[SQL] {}", $msg)
    };
}
