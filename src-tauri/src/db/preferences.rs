use serde::{Deserialize, Serialize};

use super::connection::Database;

#[allow(dead_code)]
#[derive(Serialize)]
pub struct PreferenceRow {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
pub struct PreferenceInput {
    pub key: String,
    pub value: String,
}

#[allow(dead_code)]
pub fn get_all(state: &Database) -> Result<Vec<PreferenceRow>, String> {
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

#[allow(dead_code)]
pub fn update(state: &Database, key: &str, value: &str) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute(
        "INSERT INTO user_preferences (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
