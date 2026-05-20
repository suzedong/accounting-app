use tauri::State;

use crate::db::Database;
use crate::db::chat_history::ChatMessageInput;

#[tauri::command]
pub async fn get_chat_history(
    state: State<'_, Database>,
    limit: Option<u32>,
) -> Result<serde_json::Value, String> {
    let conn = state.get_conn()?;
    let messages = crate::db::chat_history::get_history(&conn, limit.unwrap_or(50))?;
    Ok(serde_json::json!({ "data": messages }))
}

#[tauri::command]
pub async fn save_chat_message(
    state: State<'_, Database>,
    message: ChatMessageInput,
) -> Result<(), String> {
    let conn = state.get_conn()?;
    crate::db::chat_history::save_message(&conn, message)
}

#[tauri::command]
pub async fn clear_chat_history(state: State<'_, Database>) -> Result<(), String> {
    let conn = state.get_conn()?;
    crate::db::chat_history::clear_history(&conn)
}
