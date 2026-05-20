use serde::Serialize;

use super::connection::Database;

#[derive(Serialize)]
pub struct SyncLogRow {
    pub id: i64,
    pub direction: String,
    pub collection: String,
    pub status: String,
    pub count: i32,
    pub error: Option<String>,
    pub created_at: String,
}

#[allow(dead_code)]
pub fn log_sync(state: &Database, direction: &str, collection: &str, status: &str, count: i32, error: Option<&str>) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute(
        "INSERT INTO sync_log (direction, collection, status, count, error) VALUES (?, ?, ?, ?, ?)",
        (direction, collection, status, count, error),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_logs(state: &Database, limit: u32) -> Result<Vec<SyncLogRow>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare(
            "SELECT id, direction, collection, status, count, error, created_at FROM sync_log ORDER BY created_at DESC LIMIT ?",
        )
        .map_err(|e| e.to_string())?;

    let logs: Vec<SyncLogRow> = stmt
        .query_map([limit], |row| {
            Ok(SyncLogRow {
                id: row.get(0)?,
                direction: row.get(1)?,
                collection: row.get(2)?,
                status: row.get(3)?,
                count: row.get(4)?,
                error: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(logs)
}
