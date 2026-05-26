#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod commands;
mod models;
mod ocr;

use std::sync::Mutex;
use ocr::rapidocr::RapidOcr;

/// OCR 引擎状态（延迟加载）
pub struct OcrEngine {
    inner: Mutex<Option<RapidOcr>>,
}

impl OcrEngine {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// 加载 OCR 引擎
    pub fn load(&self, models_dir: std::path::PathBuf) -> Result<(), String> {
        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        let engine = RapidOcr::new(&models_dir)?;
        *guard = Some(engine);
        Ok(())
    }

    /// 获取 OCR 引擎实例
    pub fn get(&self) -> Result<std::sync::MutexGuard<'_, Option<RapidOcr>>, String> {
        self.inner.lock().map_err(|e| e.to_string())
    }
}

fn main() {
    // Initialize database (opens connection in constructor)
    let database = db::Database::new();

    // Initialize app config (loads from SQLite)
    let app_config = commands::config::AppConfig::new(&database);

    // Initialize OCR engine — try to load models on startup
    let ocr_engine = OcrEngine::new();
    let model_paths = find_ocr_model_paths();
    if let Some(dir) = model_paths {
        if let Err(e) = ocr_engine.load(dir) {
            eprintln!("OCR model load failed (will be unavailable): {}", e);
        }
    } else {
        eprintln!("OCR models not found in any search path");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(database)
        .manage(app_config)
        .manage(ocr_engine)
        .invoke_handler(tauri::generate_handler![
            // Records
            commands::records::get_records,
            commands::records::get_record,
            commands::records::create_record,
            commands::records::update_record,
            commands::records::delete_record,
            commands::records::get_categories,
            commands::records::get_payment_methods,
            // Trips
            commands::trips::get_business_trips,
            commands::trips::create_business_trip,
            commands::trips::update_business_trip,
            commands::trips::delete_business_trip,
            // Stats
            commands::stats::get_stats_summary,
            commands::stats::get_stats_by_category,
            commands::stats::get_stats_by_account,
            commands::stats::get_monthly_trend,
            commands::stats::get_comparison,
            commands::stats::get_budget_analysis,
            // Prompts
            commands::prompts::get_system_prompt,
            commands::prompts::update_system_prompt,
            commands::prompts::update_preference,
            // Learning
            commands::learning::get_learning_corrections,
            commands::learning::save_correction,
            commands::learning::delete_correction,
            commands::learning::clear_corrections,
            // Chat
            commands::chat::get_chat_history,
            commands::chat::save_chat_message,
            commands::chat::clear_chat_history,
            // Config
            commands::config::get_config,
            commands::config::set_config,
            commands::config::get_all_config,
            commands::config::test_ai_connection,
            commands::config::call_llm,
            commands::config::call_llm_with_tools,
            commands::config::get_ai_services,
            commands::config::save_ai_services,
            commands::config::activate_ai_service,
            // Sync
            commands::sync::sync_push,
            commands::sync::sync_pull,
            commands::sync::sync_full,
            commands::sync::import_from_nocobase,
            commands::sync::get_sync_logs,
            // OCR
            commands::ocr::check_ocr_status,
            commands::ocr::get_ocr_models,
            commands::ocr::download_ocr_model,
            commands::ocr::delete_ocr_model,
            commands::ocr::ocr_recognize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Find OCR model directory by searching multiple paths.
/// Returns the first existing directory containing ONNX model files.
fn find_ocr_model_paths() -> Option<std::path::PathBuf> {
    // 1. Check bundled/dev paths for actual ONNX files (Windows/Linux)
    let candidates: Vec<std::path::PathBuf> = vec![
        std::path::PathBuf::from("./models"),
        std::path::PathBuf::from("src-tauri/models"),
        std::path::PathBuf::from("models"),
    ];

    for path in &candidates {
        if path.exists() && path.is_dir() {
            let has_onnx = std::fs::read_dir(path)
                .ok()
                .map_or(false, |entries| {
                    entries.filter_map(|e| e.ok()).any(|e| {
                        e.path().extension().map_or(false, |ext| ext == "onnx")
                    })
                });
            if has_onnx {
                return Some(path.clone());
            }
        }
    }

    // 2. On macOS, OCR uses system Shortcuts — any existing dir works
    #[cfg(target_os = "macos")]
    {
        // Try app data dir
        if let Some(app_dir) = dirs::data_local_dir() {
            let data_models = app_dir.join("ai-jizhang/models");
            if data_models.exists() {
                return Some(data_models);
            }
            // Create it so engine can load
            if std::fs::create_dir_all(&data_models).is_ok() {
                return Some(data_models);
            }
        }
        // Fallback: try current dir
        let local = std::path::PathBuf::from("models");
        if std::fs::create_dir_all(&local).is_ok() {
            return Some(local);
        }
    }

    None
}
