use tauri::State;

use crate::db::Database;

#[tauri::command]
pub async fn get_system_prompt(
    state: State<'_, Database>,
    name: String,
) -> Result<serde_json::Value, String> {
    match crate::db::prompts::get_prompt(state.inner(), &name)? {
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
    crate::db::prompts::update_prompt(state.inner(), &name, &content)
}

#[tauri::command]
pub async fn update_preference(
    state: State<'_, Database>,
    key: String,
    value: String,
) -> Result<(), String> {
    crate::db::prompts::update_preference_in_doc(state.inner(), &key, &value)
}
