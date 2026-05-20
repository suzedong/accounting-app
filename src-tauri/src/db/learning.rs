use rusqlite::Connection;
use serde::Serialize;

#[derive(Serialize)]
pub struct LearningCorrection {
    pub keyword: String,
    pub field: String,
    pub value: String,
}

pub fn get_corrections(conn: &Connection) -> Result<Vec<LearningCorrection>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM learning_data WHERE type = 'correction'")
        .map_err(|e| e.to_string())?;

    let corrections = stmt
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

pub fn save_correction(conn: &Connection, keyword: &str, field: &str, value: &str) -> Result<(), String> {
    let uuid = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO learning_data (uuid, type, key, value) VALUES (?, 'correction', ?, ?)",
        [uuid, keyword, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_corrections(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM learning_data WHERE type = 'correction'", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
