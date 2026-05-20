use serde::{Deserialize, Serialize};

use super::connection::Database;

#[derive(Serialize)]
pub struct ChatMessageRow {
    pub id: i64,
    pub uuid: String,
    pub role: String,
    pub content: Option<String>,
    pub data: Option<String>,
    pub skill: Option<String>,
    pub confidence: Option<f64>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct ChatMessageInput {
    pub role: String,
    pub content: Option<String>,
    pub data: Option<String>,
    pub skill: Option<String>,
    pub confidence: Option<f64>,
}

pub fn get_history(state: &Database, limit: u32) -> Result<Vec<ChatMessageRow>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare(
            "SELECT id, uuid, role, content, data, skill, confidence, created_at FROM chat_history ORDER BY created_at DESC LIMIT ?",
        )
        .map_err(|e| e.to_string())?;

    let messages: Vec<ChatMessageRow> = stmt
        .query_map([limit], |row| {
            Ok(ChatMessageRow {
                id: row.get(0)?,
                uuid: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                data: row.get(4)?,
                skill: row.get(5)?,
                confidence: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(messages)
}

pub fn save_message(state: &Database, input: ChatMessageInput) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let uuid = uuid::Uuid::new_v4().to_string();
    guard.execute(
        "INSERT INTO chat_history (uuid, role, content, data, skill, confidence) VALUES (?, ?, ?, ?, ?, ?)",
        (&uuid, &input.role, &input.content, &input.data, &input.skill, &input.confidence),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_history(state: &Database) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute("DELETE FROM chat_history", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
