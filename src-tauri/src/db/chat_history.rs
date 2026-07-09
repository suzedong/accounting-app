use libsql::params;
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

pub async fn get_history(state: &Database, limit: u32) -> Result<Vec<ChatMessageRow>, String> {
    let conn = state.get_conn().await?;
    let mut rows = conn
        .query(
            "SELECT id, uuid, session_id, role, content, data, created_at FROM chat_history ORDER BY created_at DESC LIMIT ?",
            params![limit as i64],
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut messages = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        messages.push(ChatMessageRow {
            id: row.get::<i64>(0).map_err(|e| e.to_string())?,
            uuid: row.get::<String>(1).map_err(|e| e.to_string())?,
            session_id: row.get::<String>(2).map_err(|e| e.to_string())?,
            role: row.get::<String>(3).map_err(|e| e.to_string())?,
            content: row.get::<Option<String>>(4).map_err(|e| e.to_string())?,
            data: row.get::<Option<String>>(5).map_err(|e| e.to_string())?,
            created_at: row.get::<Option<String>>(6).map_err(|e| e.to_string())?.unwrap_or_default(),
        });
    }

    Ok(messages)
}

pub async fn save_message(state: &Database, input: ChatMessageInput) -> Result<(), String> {
    let conn = state.get_conn().await?;

    // 检查是否已存在相同 session 和 role 的消息（用于更新）
    let existing: Option<String> = {
        let mut rows = conn
            .query(
                "SELECT uuid FROM chat_history WHERE session_id = ? AND role = ? ORDER BY created_at DESC LIMIT 1",
                params![input.session_id.clone(), input.role.clone()],
            )
            .await
            .map_err(|e| e.to_string())?;
        match rows.next().await.map_err(|e| e.to_string())? {
            Some(row) => Some(row.get::<String>(0).map_err(|e| e.to_string())?),
            None => None,
        }
    };

    if let Some(uuid) = existing {
        // 如果 data 中包含 _cancelled，说明是取消操作，更新原消息
        if input
            .data
            .as_deref()
            .map(|d| d.contains("_cancelled"))
            .unwrap_or(false)
        {
            conn.execute(
                "UPDATE chat_history SET role = ?, content = ?, data = ? WHERE uuid = ?",
                params![input.role, input.content, input.data, uuid],
            )
            .await
            .map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    // 否则插入新消息
    let uuid = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO chat_history (uuid, session_id, role, content, data) VALUES (?, ?, ?, ?, ?)",
        params![uuid, input.session_id, input.role, input.content, input.data],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn clear_history(state: &Database) -> Result<(), String> {
    let conn = state.get_conn().await?;
    conn.execute("DELETE FROM chat_history", ())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn get_sessions(
    state: &Database,
    limit: u32,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = state.get_conn().await?;
    let mut rows = conn
        .query(
            r#"SELECT session_id,
                      COUNT(*) as message_count,
                      MIN(created_at) as started_at,
                      MAX(created_at) as last_message_at
               FROM chat_history
               GROUP BY session_id
               ORDER BY last_message_at DESC
               LIMIT ?"#,
            params![limit as i64],
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut sessions = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        sessions.push(serde_json::json!({
            "session_id": row.get::<String>(0).map_err(|e| e.to_string())?,
            "message_count": row.get::<i64>(1).map_err(|e| e.to_string())?,
            "started_at": row.get::<Option<String>>(2).map_err(|e| e.to_string())?.unwrap_or_default(),
            "last_message_at": row.get::<Option<String>>(3).map_err(|e| e.to_string())?.unwrap_or_default(),
        }));
    }

    Ok(sessions)
}
