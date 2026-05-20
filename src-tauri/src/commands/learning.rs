use tauri::State;

use crate::db::Database;

#[tauri::command]
pub async fn get_learning_corrections(
    state: State<'_, Database>,
) -> Result<serde_json::Value, String> {
    let corrections = crate::db::learning::get_corrections(state.inner())?;
    Ok(serde_json::json!({ "data": corrections }))
}

#[tauri::command]
pub async fn save_correction(
    state: State<'_, Database>,
    keyword: String,
    field: String,
    value: String,
) -> Result<(), String> {
    crate::db::learning::save_correction(state.inner(), &keyword, &field, &value)
}

#[tauri::command]
pub async fn clear_corrections(state: State<'_, Database>) -> Result<(), String> {
    crate::db::learning::clear_corrections(state.inner())
}
