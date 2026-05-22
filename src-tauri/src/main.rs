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

    // Initialize OCR engine (lazy load)
    let ocr_engine = OcrEngine::new();

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
            commands::ocr::load_ocr_models,
            commands::ocr::ocr_recognize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
