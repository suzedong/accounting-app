use serde::Serialize;

use super::connection::Database;

#[derive(Serialize)]
pub struct LearningCorrection {
    pub keyword: String,
    pub field: String,
    pub value: String,
}

pub fn get_corrections(state: &Database) -> Result<Vec<LearningCorrection>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = guard
        .prepare("SELECT key, value FROM learning_data WHERE type = 'correction'")
        .map_err(|e| e.to_string())?;

    let corrections: Vec<LearningCorrection> = stmt
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value: String = row.get(1)?;
            Ok(LearningCorrection {
                keyword: key,
                field: "unknown".to_string(),
                value,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(corrections)
}

pub fn save_correction(state: &Database, keyword: &str, _field: &str, value: &str) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let uuid = uuid::Uuid::new_v4().to_string();
    guard.execute(
        "INSERT INTO learning_data (uuid, type, key, value) VALUES (?, 'correction', ?, ?)",
        [uuid, keyword.to_string(), value.to_string()],
    )
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
