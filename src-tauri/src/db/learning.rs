use libsql::params;
use serde::Serialize;

use super::connection::Database;

#[derive(Serialize)]
pub struct LearningCorrection {
    pub id: i64,
    pub keyword: String,
    pub field: String,
    pub value: String,
}

pub async fn get_corrections(state: &Database) -> Result<Vec<LearningCorrection>, String> {
    let conn = state.get_conn().await?;
    let mut rows = conn
        .query(
            "SELECT id, key, value FROM learning_data WHERE type = 'correction' ORDER BY id",
            (),
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut corrections = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        let id: i64 = row.get::<i64>(0).map_err(|e| e.to_string())?;
        let key: String = row.get::<Option<String>>(1).map_err(|e| e.to_string())?.unwrap_or_default();
        let value: String = row.get::<Option<String>>(2).map_err(|e| e.to_string())?.unwrap_or_default();
        // Key format: "keyword|field" (new) or just "keyword" (old)
        let (keyword, field) = if let Some(idx) = key.find('|') {
            let k = key[..idx].to_string();
            let f = key[idx + 1..].to_string();
            (k, f)
        } else {
            // Old format: try to extract field from JSON value
            let field = if let Ok(json) = serde_json::from_str::<serde_json::Value>(&value) {
                json.get("field")
                    .and_then(|f| f.as_str())
                    .unwrap_or("unknown")
                    .to_string()
            } else {
                "unknown".to_string()
            };
            (key, field)
        };
        corrections.push(LearningCorrection {
            id,
            keyword,
            field,
            value,
        });
    }

    Ok(corrections)
}

pub async fn save_correction(
    state: &Database,
    keyword: &str,
    field: &str,
    value: &str,
) -> Result<(), String> {
    let conn = state.get_conn().await?;
    let uuid = uuid::Uuid::new_v4().to_string();
    // Store key as "keyword|field" to preserve field info
    let composite_key = format!("{}|{}", keyword, field);
    conn.execute(
        "INSERT INTO learning_data (uuid, type, key, value) VALUES (?, 'correction', ?, ?)",
        params![uuid, composite_key, value.to_string()],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn delete_correction(state: &Database, id: i64) -> Result<(), String> {
    let conn = state.get_conn().await?;
    conn.execute(
        "DELETE FROM learning_data WHERE type = 'correction' AND id = ?",
        params![id],
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn clear_corrections(state: &Database) -> Result<(), String> {
    let conn = state.get_conn().await?;
    conn.execute(
        "DELETE FROM learning_data WHERE type = 'correction'",
        (),
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
