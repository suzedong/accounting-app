use serde::Serialize;

use super::connection::Database;

#[derive(Serialize)]
pub struct LearningCorrection {
    pub id: i64,
    pub keyword: String,
    pub field: String,
    pub value: String,
}

pub fn get_corrections(state: &Database) -> Result<Vec<LearningCorrection>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = guard
        .prepare("SELECT id, key, value FROM learning_data WHERE type = 'correction' ORDER BY id")
        .map_err(|e| e.to_string())?;

    let corrections: Vec<LearningCorrection> = stmt
        .query_map([], |row| {
            let id: i64 = row.get(0)?;
            let key: String = row.get(1)?;
            let value: String = row.get(2)?;
            // Key format: "keyword|field" (new) or just "keyword" (old)
            let (keyword, field) = if let Some(idx) = key.find('|') {
                let k = key[..idx].to_string();
                let f = key[idx + 1..].to_string();
                (k, f)
            } else {
                // Old format: try to extract field from JSON value
                let field = if let Ok(json) = serde_json::from_str::<serde_json::Value>(&value) {
                    json.get("field").and_then(|f| f.as_str()).unwrap_or("unknown").to_string()
                } else {
                    "unknown".to_string()
                };
                (key, field)
            };
            Ok(LearningCorrection { id, keyword, field, value })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(corrections)
}

pub fn save_correction(state: &Database, keyword: &str, field: &str, value: &str) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let uuid = uuid::Uuid::new_v4().to_string();
    // Store key as "keyword|field" to preserve field info
    let composite_key = format!("{}|{}", keyword, field);
    guard.execute(
        "INSERT INTO learning_data (uuid, type, key, value) VALUES (?, 'correction', ?, ?)",
        [uuid, composite_key, value.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_correction(state: &Database, id: i64) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute("DELETE FROM learning_data WHERE type = 'correction' AND id = ?", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_corrections(state: &Database) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute("DELETE FROM learning_data WHERE type = 'correction'", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
