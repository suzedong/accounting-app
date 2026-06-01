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
pub async fn refresh_prompt_from_file(
    state: State<'_, Database>,
    name: String,
) -> Result<String, String> {
    // Read prompt file from disk (not compiled-in)
    let candidates = [
        format!("prompts/{name}.md"),
        format!("../prompts/{name}.md"),
        format!("../../prompts/{name}.md"),
        format!("resources/prompts/{name}.md"),
    ];
    let content = candidates
        .iter()
        .find_map(|p| std::fs::read_to_string(p).ok())
        .ok_or_else(|| format!("找不到 prompts/{name}.md，请检查项目结构"))?;

    crate::db::prompts::update_prompt(state.inner(), &name, &content)?;
    Ok(format!("已刷新 {} ({})", name, content.len()))
}

#[tauri::command]
pub async fn update_preference(
    state: State<'_, Database>,
    key: String,
    value: String,
) -> Result<(), String> {
    crate::db::prompts::update_preference_in_doc(state.inner(), &key, &value)
}
