#![allow(dead_code)]

use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

/// Struct for JSON log file entry (slightly different from AppLogEntry)
#[derive(Serialize)]
struct JsonLogEntry {
    id: u64,
    level: String,
    module: String,
    message: String,
    timestamp: String,
    latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
}

impl From<&AppLogEntry> for JsonLogEntry {
    fn from(entry: &AppLogEntry) -> Self {
        Self {
            id: entry.id,
            level: entry.level.label().to_string(),
            module: entry.module.clone(),
            message: entry.message.clone(),
            timestamp: entry.timestamp.clone(),
            latency_ms: entry.latency_ms,
            request_id: entry.request_id.clone(),
        }
    }
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// Global log file writer - lazily initialized
static LOG_FILE: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Initialize the log file path. Call this once at startup.
pub fn init_log_file(mut log_dir: PathBuf) {
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    
    // Check if we're in development mode
    let is_development = cfg!(debug_assertions) || 
                         std::env::var("TAURI_ENV").map(|v| v == "development").unwrap_or(false);
    
    if is_development {
        // Development mode: use project directory for easier access (outside src-tauri to avoid hot reload)
        if let Ok(current_dir) = std::env::current_dir() {
            // If we're in src-tauri/, go up one level to project root
            let project_dir = if current_dir.file_name().map(|n| n == "src-tauri").unwrap_or(false) {
                current_dir.parent().unwrap_or(&current_dir)
            } else {
                &current_dir
            };
            let dev_log_file = project_dir.join("logs").join(format!("app_{}.jsonl", date));
            if let Err(e) = try_init_log_file(&dev_log_file) {
                eprintln!("[Logger] Failed to initialize dev log file at {}: {}", dev_log_file.display(), e);
            } else {
                eprintln!("[Logger] Log file initialized (dev): {}", dev_log_file.display());
                return;
            }
        }
    }
    
    // Production mode: use the provided system directory
    let log_file = log_dir.join(format!("app_{}.jsonl", date));
    
    if let Err(e) = try_init_log_file(&log_file) {
        eprintln!("[Logger] Failed to initialize log file at {}: {}", log_file.display(), e);
        
        // Fallback to current working directory
        log_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let fallback_file = log_dir.join("logs").join(format!("app_{}.jsonl", date));
        
        if let Err(e) = try_init_log_file(&fallback_file) {
            eprintln!("[Logger] Failed to initialize fallback log file at {}: {}", fallback_file.display(), e);
            eprintln!("[Logger] Logging to file disabled, only logging to console");
            return;
        }
        
        eprintln!("[Logger] Log file initialized (fallback): {}", fallback_file.display());
    } else {
        eprintln!("[Logger] Log file initialized (prod): {}", log_file.display());
    }
}

fn try_init_log_file(log_file: &PathBuf) -> std::io::Result<()> {
    // Ensure directory exists
    if let Some(parent) = log_file.parent() {
        fs::create_dir_all(parent)?;
    }
    
    // Create or touch the file
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)?;
    
    if let Ok(mut guard) = LOG_FILE.lock() {
        *guard = Some(log_file.clone());
    }
    
    Ok(())
}

/// Write a log entry to the JSON log file
fn write_to_log_file(entry: &AppLogEntry) {
    if let Ok(guard) = LOG_FILE.lock() {
        if let Some(ref log_path) = *guard {
            let json_entry = JsonLogEntry::from(entry);
            if let Ok(json) = serde_json::to_string(&json_entry) {
                if let Ok(mut file) = OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(log_path)
                {
                    let _ = writeln!(file, "{}", json);
                }
            }
        }
    }
}

/// Emit a log entry to the frontend via Tauri event.
/// Also prints to stderr and writes to log file.
pub fn emit_log(app: &tauri::AppHandle, level: AppLogLevel, module: &str, message: &str) {
    emit_log_with_request_id(app, level, module, message, None, None);
}

/// Emit a log entry with request ID and latency info
pub fn emit_log_with_request_id(
    app: &tauri::AppHandle,
    level: AppLogLevel,
    module: &str,
    message: &str,
    request_id: Option<String>,
    latency_ms: Option<u64>,
) {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let timestamp = chrono::Local::now().format("%H:%M:%S%.3f").to_string();

    let entry = AppLogEntry {
        id,
        level,
        module: module.to_string(),
        message: message.to_string(),
        timestamp,
        latency_ms,
        request_id,
    };

    // Print to terminal
    if let Some(latency) = entry.latency_ms {
        eprintln!("[{}] [{}] {} ({}ms)", entry.level.label(), entry.module, entry.message, latency);
    } else {
        eprintln!("[{}] [{}] {}", entry.level.label(), entry.module, entry.message);
    }

    // Write to JSON log file
    write_to_log_file(&entry);

    // Emit to frontend
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
    emit_log_with_request_id(app, level, module, message, None, Some(latency_ms));
}

/// Emit a log entry with request ID (used for LLM correlation)
pub fn emit_log_with_request_id_only(
    app: &tauri::AppHandle,
    level: AppLogLevel,
    module: &str,
    message: &str,
    request_id: &str,
) {
    emit_log_with_request_id(app, level, module, message, Some(request_id.to_string()), None);
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
