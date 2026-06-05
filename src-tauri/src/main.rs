#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod commands;
mod models;
mod logger;

fn main() {
    // Initialize database (opens connection in constructor)
    let database = db::Database::new();

    // Initialize app config (loads from SQLite)
    let app_config = commands::config::AppConfig::new(&database);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Emit startup log
            use tauri::Emitter;
            let handle = app.handle().clone();
            let _ = handle.emit("app_log", logger::AppLogEntry {
                id: 0,
                level: logger::AppLogLevel::Info,
                module: "app".to_string(),
                message: "应用启动".to_string(),
                timestamp: chrono::Local::now().format("%H:%M:%S%.3f").to_string(),
                latency_ms: None,
            });

            Ok(())
        })
        .manage(database)
        .manage(app_config)
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
            commands::prompts::refresh_prompt_from_file,
            // Learning
            commands::learning::get_learning_corrections,
            commands::learning::save_correction,
            commands::learning::delete_correction,
            commands::learning::clear_corrections,
            // Chat
            commands::chat::get_chat_history,
            commands::chat::save_chat_message,
            commands::chat::clear_chat_history,
            commands::chat::get_chat_sessions,
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
            commands::sync::nocobase_test_connection,
            commands::sync::sync_push,
            commands::sync::sync_pull,
            commands::sync::sync_full,
            commands::sync::get_sync_logs,
            // OCR
            commands::ocr::check_ocr_status,
            commands::ocr::check_ocr_status_fast,
            commands::ocr::start_ocr_discover,
            commands::ocr::select_python,
            commands::ocr::install_ocr_dependencies,
            commands::ocr::install_paddleocr_for_python,
            commands::ocr::uninstall_paddleocr_for_python,
            commands::ocr::reinstall_paddleocr_for_python,
            commands::ocr::set_ocr_enabled,
            commands::ocr::ocr_recognize,
            commands::ocr::install_bundled_python,
            commands::ocr::uninstall_bundled_python,
            commands::ocr::reinstall_bundled_python,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
