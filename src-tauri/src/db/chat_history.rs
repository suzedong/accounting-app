use rusqlite::OptionalExtension;
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
#[serde(rename_all = "camelCase")]
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
    
    // 检查是否已存在相同 session 和 role 的消息（用于更新）
    let existing: Option<(String, String)> = guard
        .query_row(
            "SELECT uuid, data FROM chat_history WHERE session_id = ? AND role = ? ORDER BY created_at DESC LIMIT 1",
            [&input.session_id, &input.role],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some((uuid, _existing_data)) = existing {
        // 如果 data 中包含 _cancelled，说明是取消操作，更新原消息
        if input.data.as_deref().map(|d| d.contains("_cancelled")).unwrap_or(false) {
            guard.execute(
                "UPDATE chat_history SET role = ?, content = ?, data = ? WHERE uuid = ?",
                (&input.role, &input.content, &input.data, &uuid),
            )
            .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    // 否则插入新消息
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
