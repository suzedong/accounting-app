use rusqlite::Connection;
use serde::{Deserialize, Serialize};

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

pub fn get_history(conn: &Connection, limit: u32) -> Result<Vec<ChatMessageRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, uuid, role, content, data, skill, confidence, created_at FROM chat_history ORDER BY created_at DESC LIMIT ?",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_map([limit], |row| {
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
    .collect()
}

pub fn save_message(conn: &Connection, input: ChatMessageInput) -> Result<(), String> {
    let uuid = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO chat_history (uuid, role, content, data, skill, confidence) VALUES (?, ?, ?, ?, ?, ?)",
        (&uuid, &input.role, &input.content, &input.data, &input.skill, &input.confidence),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_history(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM chat_history", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
