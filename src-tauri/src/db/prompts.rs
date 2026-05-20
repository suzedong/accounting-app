use serde::Serialize;

use super::connection::Database;

#[derive(Serialize)]
pub struct PromptRow {
    pub name: String,
    pub content: String,
    pub updated_at: String,
}

pub fn get_prompt(state: &Database, name: &str) -> Result<Option<PromptRow>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare("SELECT name, content, updated_at FROM system_prompts WHERE name = ?")
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row([name], |row| {
        Ok(PromptRow {
            name: row.get(0)?,
            content: row.get(1)?,
            updated_at: row.get(2)?,
        })
    });

    match result {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn update_prompt(state: &Database, name: &str, content: &str) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute(
        "INSERT INTO system_prompts (name, content, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = datetime('now')",
        [name, content],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_all_preferences(state: &Database) -> Result<Vec<PreferenceRow>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare("SELECT key, value, updated_at FROM user_preferences")
        .map_err(|e| e.to_string())?;

    let rows: Vec<PreferenceRow> = stmt
        .query_map([], |row| {
            Ok(PreferenceRow {
                key: row.get(0)?,
                value: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(rows)
}

#[derive(Serialize)]
pub struct PreferenceRow {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

pub fn update_preference(state: &Database, key: &str, value: &str) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute(
        "INSERT INTO user_preferences (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
