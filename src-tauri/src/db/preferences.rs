use rusqlite::Connection;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
pub struct PreferenceRow {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

#[derive(Deserialize)]
pub struct PreferenceInput {
    pub key: String,
    pub value: String,
}

pub fn get_all(conn: &Connection) -> Result<Vec<PreferenceRow>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value, updated_at FROM user_preferences")
        .map_err(|e| e.to_string())?;

    stmt.query_map([], |row| {
        Ok(PreferenceRow {
            key: row.get(0)?,
            value: row.get(1)?,
            updated_at: row.get(2)?,
        })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect()
}

pub fn update(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO user_preferences (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
        [key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
