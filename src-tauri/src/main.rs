#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod db;
mod commands;
mod models;
mod logger;

fn main() {
    // Initialize database (async): first try to read Turso config, fall back to pure local.
    let database = tauri::async_runtime::block_on(async {
        // Step 1: 打开纯本地 DB，读取配置
        let local = db::Database::new()
            .await
            .expect("Failed to open local database");

        let (enabled, url, token) = read_turso_config(&local).await;
        if enabled && !url.is_empty() && !token.is_empty() {
            // Turso 已启用，使用 Embedded Replica 重新打开
            match db::Database::new_with_turso(url.clone(), token.clone()).await {
                Ok(db) => {
                    eprintln!("[main] Turso Embedded Replica 已启用");
                    db
                }
                Err(e) => {
                    eprintln!(
                        "[main] Turso 启用失败，回退纯本地模式: {}",
                        e
                    );
                    local
                }
            }
        } else {
            local
        }
    });

    // Initialize app config (loads from SQLite)
    let app_config = tauri::async_runtime::block_on(async {
        commands::config::AppConfig::new(&database).await
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Initialize log file in app data directory
            let app_data_dir = app.path().app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let logs_dir = app_data_dir.join("logs");
            logger::init_log_file(logs_dir);

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
                request_id: None,
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
            commands::config::open_folder,
            // Turso sync
            commands::config::sync_turso,
            commands::config::test_turso_connection,
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

/// Read Turso sync config from app_config table (async, called during startup).
async fn read_turso_config(db: &db::Database) -> (bool, String, String) {
    let conn = match db.get_conn().await {
        Ok(c) => c,
        Err(_) => return (false, String::new(), String::new()),
    };
    let mut enabled = false;
    let mut url = String::new();
    let mut token = String::new();

    if let Ok(mut rows) = conn
        .query(
            "SELECT key, value FROM app_config WHERE key IN ('turso_sync_enabled','turso_url','turso_token')",
            (),
        )
        .await
    {
        while let Ok(Some(row)) = rows.next().await {
            // 用 get_value 避免遇到 NULL 时 libsql panic
            let k_val = match row.get_value(0) { Ok(v) => v, Err(_) => continue };
            let v_val = match row.get_value(1) { Ok(v) => v, Err(_) => continue };
            let k = match k_val {
                libsql::Value::Text(s) => s,
                _ => continue,
            };
            let v = match v_val {
                libsql::Value::Text(s) => s,
                libsql::Value::Null => String::new(),
                _ => continue,
            };
            match k.as_str() {
                "turso_sync_enabled" => enabled = v == "true" || v == "1",
                "turso_url" => url = v,
                "turso_token" => token = v,
                _ => {}
            }
        }
    }
    (enabled, url, token)
}
