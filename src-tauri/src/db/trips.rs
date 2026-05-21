use rusqlite::OptionalExtension;
use serde::Deserialize;

use super::connection::Database;

#[derive(Deserialize)]
pub struct TripInput {
    pub trip_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub days: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct TripUpdateInput {
    pub trip_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub days: Option<i32>,
    pub notes: Option<String>,
    pub status: Option<String>,
    pub paid_trip_allowance: Option<f64>,
    pub paid_transport_allowance: Option<f64>,
    pub paid_date: Option<String>,
}

#[derive(serde::Serialize)]
pub struct TripRow {
    pub id: i64,
    pub uuid: String,
    pub trip_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub days: Option<i32>,
    pub trip_allowance: f64,
    pub transport_allowance: f64,
    pub total: f64,
    pub status: String,
    pub paid_trip_allowance: f64,
    pub paid_transport_allowance: f64,
    pub paid_date: Option<String>,
    pub notes: Option<String>,
    pub synced: i32,
    pub nocobase_id: Option<i64>,
    pub nocobase_updated_at: Option<String>,
    pub created_at: String,
}

fn row_to_trip(row: &rusqlite::Row<'_>) -> Result<TripRow, rusqlite::Error> {
    Ok(TripRow {
        id: row.get(0)?,
        uuid: row.get(1)?,
        trip_id: row.get(2)?,
        start_date: row.get(3)?,
        end_date: row.get(4)?,
        days: row.get(5)?,
        trip_allowance: row.get(6)?,
        transport_allowance: row.get(7)?,
        total: row.get(8)?,
        status: row.get(9)?,
        paid_trip_allowance: row.get(10)?,
        paid_transport_allowance: row.get(11)?,
        paid_date: row.get(12)?,
        notes: row.get(13)?,
        synced: row.get(14)?,
        nocobase_id: row.get(15)?,
        nocobase_updated_at: row.get(16)?,
        created_at: row.get(17)?,
    })
}

pub fn get_trips(state: &Database, status: Option<&str>) -> Result<Vec<TripRow>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;

    let rows: Vec<TripRow> = match status {
        Some(s) => {
            let s_owned = s.to_string();
            let mut stmt = guard.prepare(
                "SELECT id, uuid, trip_id, start_date, end_date, days, trip_allowance, transport_allowance, total, status, paid_trip_allowance, paid_transport_allowance, paid_date, notes, synced, nocobase_id, nocobase_updated_at, created_at FROM business_trip WHERE status = ? ORDER BY start_date DESC",
            ).map_err(|e| e.to_string())?;
            let result: Vec<TripRow> = stmt
                .query_map([&s_owned], row_to_trip)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            result
        }
        None => {
            let mut stmt = guard.prepare(
                "SELECT id, uuid, trip_id, start_date, end_date, days, trip_allowance, transport_allowance, total, status, paid_trip_allowance, paid_transport_allowance, paid_date, notes, synced, nocobase_id, nocobase_updated_at, created_at FROM business_trip ORDER BY start_date DESC",
            ).map_err(|e| e.to_string())?;
            let result: Vec<TripRow> = stmt
                .query_map([], row_to_trip)
                .map_err(|e| e.to_string())?
                .filter_map(|r| r.ok())
                .collect();
            result
        }
    };

    Ok(rows)
}

pub fn create_trip(state: &Database, input: TripInput) -> Result<TripRow, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let uuid = uuid::Uuid::new_v4().to_string();
    let days = input.days.unwrap_or(0);
    let trip_allowance = days as f64 * 100.0;
    let transport_allowance = days as f64 * 30.0;
    let total = trip_allowance + transport_allowance;

    guard.execute(
        "INSERT INTO business_trip (uuid, trip_id, start_date, end_date, days, notes, trip_allowance, transport_allowance, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (&uuid, &input.trip_id, &input.start_date, &input.end_date, &days, &input.notes, &trip_allowance, &transport_allowance, &total),
    ).map_err(|e| e.to_string())?;
    drop(guard);

    get_trip_by_uuid(state, &uuid)?.ok_or_else(|| "Failed to retrieve created trip".to_string())
}

pub fn update_trip(state: &Database, id: i64, input: TripUpdateInput) -> Result<TripRow, String> {
    let mut sets = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql + Send>> = Vec::new();

    macro_rules! add {
        ($field:expr, $val:expr) => {
            if let Some(v) = $val {
                sets.push(format!("{} = ?", $field));
                params.push(Box::new(v.clone()));
            }
        };
    }

    add!("trip_id", input.trip_id.as_ref());
    add!("start_date", input.start_date.as_ref());
    add!("end_date", input.end_date.as_ref());
    add!("days", input.days.as_ref());
    add!("notes", input.notes.as_ref());
    add!("status", input.status.as_ref());
    add!("paid_trip_allowance", input.paid_trip_allowance.as_ref());
    add!("paid_transport_allowance", input.paid_transport_allowance.as_ref());
    add!("paid_date", input.paid_date.as_ref());

    if sets.is_empty() {
        return get_trip(state, id)?.ok_or_else(|| "Trip not found".to_string());
    }

    let sql = format!("UPDATE business_trip SET {} WHERE id = ?", sets.join(", "));
    params.push(Box::new(id));

    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))
        .map_err(|e| e.to_string())?;
    drop(guard);

    get_trip(state, id)?.ok_or_else(|| "Trip not found after update".to_string())
}

pub fn delete_trip(state: &Database, id: i64) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute("DELETE FROM business_trip WHERE id = ?", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_trip(state: &Database, id: i64) -> Result<Option<TripRow>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard.prepare(
        "SELECT id, uuid, trip_id, start_date, end_date, days, trip_allowance, transport_allowance, total, status, paid_trip_allowance, paid_transport_allowance, paid_date, notes, synced, nocobase_id, nocobase_updated_at, created_at FROM business_trip WHERE id = ?",
    ).map_err(|e| e.to_string())?;

    stmt.query_row([id], row_to_trip)
        .optional()
        .map_err(|e| e.to_string())
}

fn get_trip_by_uuid(state: &Database, uuid: &str) -> Result<Option<TripRow>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard.prepare(
        "SELECT id, uuid, trip_id, start_date, end_date, days, trip_allowance, transport_allowance, total, status, paid_trip_allowance, paid_transport_allowance, paid_date, notes, synced, nocobase_id, nocobase_updated_at, created_at FROM business_trip WHERE uuid = ?",
    ).map_err(|e| e.to_string())?;

    stmt.query_row([uuid], row_to_trip)
        .optional()
        .map_err(|e| e.to_string())
}
