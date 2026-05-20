#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod commands;
mod models;

fn main() {
    // Initialize database (opens connection in constructor)
    let database = db::Database::new();

    // Initialize app config (loads from SQLite)
    let app_config = commands::config::AppConfig::new(&database);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(database)
        .manage(app_config)
        .invoke_handler(tauri::generate_handler![
            // Records
            commands::records::get_records,
            commands::records::get_record,
            commands::records::create_record,
            commands::records::update_record,
            commands::records::delete_record,
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
            commands::prompts::get_all_preferences,
            commands::prompts::update_preference,
            // Learning
            commands::learning::get_learning_corrections,
            commands::learning::save_correction,
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
            // Sync
            commands::sync::sync_push,
            commands::sync::sync_pull,
            commands::sync::sync_full,
            commands::sync::import_from_nocobase,
            commands::sync::get_sync_logs,
            // OCR
            commands::ocr::ocr_recognize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
