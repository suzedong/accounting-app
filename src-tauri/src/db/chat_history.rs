use serde::{Deserialize, Serialize};

use super::connection::Database;

#[derive(Serialize)]
pub struct ChatMessageRow {
    pub id: i64,
    pub uuid: String,
    pub session_id: String,
    pub role: String,
    pub content: Option<String>,
    pub data: Option<String>,
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct ChatMessageInput {
    pub session_id: String,
    pub role: String,
    pub content: Option<String>,
    pub data: Option<String>,
}

pub fn get_history(state: &Database, limit: u32) -> Result<Vec<ChatMessageRow>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare(
            "SELECT id, uuid, session_id, role, content, data, created_at FROM chat_history ORDER BY created_at DESC LIMIT ?",
        )
        .map_err(|e| e.to_string())?;

    let messages: Vec<ChatMessageRow> = stmt
        .query_map([limit], |row| {
            Ok(ChatMessageRow {
                id: row.get(0)?,
                uuid: row.get(1)?,
                session_id: row.get(2)?,
                role: row.get(3)?,
                content: row.get(4)?,
                data: row.get(5)?,
                created_at: row.get(6)?,
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
        "INSERT INTO chat_history (uuid, session_id, role, content, data) VALUES (?, ?, ?, ?, ?)",
        (&uuid, &input.session_id, &input.role, &input.content, &input.data),
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

pub fn get_sessions(state: &Database, limit: u32) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare(
            r#"SELECT session_id, 
                      COUNT(*) as message_count,
                      MIN(created_at) as started_at,
                      MAX(created_at) as last_message_at
               FROM chat_history 
               GROUP BY session_id 
               ORDER BY last_message_at DESC 
               LIMIT ?"#,
        )
        .map_err(|e| e.to_string())?;

    let sessions: Vec<serde_json::Value> = stmt
        .query_map([limit], |row| {
            Ok(serde_json::json!({
                "session_id": row.get::<_, String>(0)?,
                "message_count": row.get::<_, i64>(1)?,
                "started_at": row.get::<_, String>(2)?,
                "last_message_at": row.get::<_, String>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(sessions)
}
