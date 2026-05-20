use tauri::State;

use crate::db::Database;

#[tauri::command]
pub async fn get_system_prompt(
    state: State<'_, Database>,
    name: String,
) -> Result<serde_json::Value, String> {
    let conn = state.get_conn()?;
    match crate::db::prompts::get_prompt(&conn, &name)? {
        Some(p) => Ok(serde_json::json!({ "data": p })),
        None => Err(format!("Prompt '{}' not found", name)),
    }
}

#[tauri::command]
pub async fn update_system_prompt(
    state: State<'_, Database>,
    name: String,
    content: String,
) -> Result<(), String> {
    let conn = state.get_conn()?;
    crate::db::prompts::update_prompt(&conn, &name, &content)
}

#[tauri::command]
pub async fn get_all_preferences(
    state: State<'_, Database>,
) -> Result<serde_json::Value, String> {
    let conn = state.get_conn()?;
    let prefs = crate::db::preferences::get_all(&conn)?;
    Ok(serde_json::json!({ "data": prefs }))
}

#[tauri::command]
pub async fn update_preference(
    state: State<'_, Database>,
    key: String,
    value: String,
) -> Result<(), String> {
    let conn = state.get_conn()?;
    crate::db::preferences::update(&conn, &key, &value)
}
