use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
pub struct TripInput {
    pub trip_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub days: Option<i32>,
    pub destination: Option<String>,
    pub employee_name: Option<String>,
    pub reason: Option<String>,
    pub notes: Option<String>,
}

#[derive(Deserialize)]
pub struct TripUpdateInput {
    pub trip_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub days: Option<i32>,
    pub destination: Option<String>,
    pub employee_name: Option<String>,
    pub reason: Option<String>,
    pub notes: Option<String>,
    pub status: Option<String>,
    pub paid_trip_allowance: Option<f64>,
    pub paid_transport_allowance: Option<f64>,
    pub paid_date: Option<String>,
}

#[derive(Serialize)]
pub struct TripRow {
    pub id: i64,
    pub uuid: String,
    pub trip_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub days: Option<i32>,
    pub destination: Option<String>,
    pub employee_name: Option<String>,
    pub reason: Option<String>,
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
        destination: row.get(6)?,
        employee_name: row.get(7)?,
        reason: row.get(8)?,
        trip_allowance: row.get(9)?,
        transport_allowance: row.get(10)?,
        total: row.get(11)?,
        status: row.get(12)?,
        paid_trip_allowance: row.get(13)?,
        paid_transport_allowance: row.get(14)?,
        paid_date: row.get(15)?,
        notes: row.get(16)?,
        synced: row.get(17)?,
        nocobase_id: row.get(18)?,
        nocobase_updated_at: row.get(19)?,
        created_at: row.get(20)?,
    })
}

pub fn get_trips(conn: &Connection, status: Option<&str>) -> Result<Vec<TripRow>, String> {
    let (sql, params): (&str, &[&dyn rusqlite::types::ToSql]) = match status {
        Some(s) => (
            "SELECT id, uuid, trip_id, start_date, end_date, days, destination, employee_name, reason, trip_allowance, transport_allowance, total, status, paid_trip_allowance, paid_transport_allowance, paid_date, notes, synced, nocobase_id, nocobase_updated_at, created_at FROM business_trip WHERE status = ? ORDER BY start_date DESC",
            &[&s],
        ),
        None => (
            "SELECT id, uuid, trip_id, start_date, end_date, days, destination, employee_name, reason, trip_allowance, transport_allowance, total, status, paid_trip_allowance, paid_transport_allowance, paid_date, notes, synced, nocobase_id, nocobase_updated_at, created_at FROM business_trip ORDER BY start_date DESC",
            &[],
        ),
    };

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    stmt.query_map(params, row_to_trip)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn create_trip(conn: &Connection, input: TripInput) -> Result<TripRow, String> {
    let uuid = uuid::Uuid::new_v4().to_string();
    let days = input.days.unwrap_or(0);
    let trip_allowance = days as f64 * 100.0;
    let transport_allowance = days as f64 * 30.0;
    let total = trip_allowance + transport_allowance;

    conn.execute(
        "INSERT INTO business_trip (uuid, trip_id, start_date, end_date, days, destination, employee_name, reason, notes, trip_allowance, transport_allowance, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (&uuid, &input.trip_id, &input.start_date, &input.end_date, &days, &input.destination, &input.employee_name, &input.reason, &input.notes, &trip_allowance, &transport_allowance, &total),
    ).map_err(|e| e.to_string())?;

    get_trip_by_uuid(conn, &uuid)?.ok_or_else(|| "Failed to retrieve created trip".to_string())
}

pub fn update_trip(conn: &Connection, id: i64, input: TripUpdateInput) -> Result<TripRow, String> {
    let mut sets = Vec::new();
    let mut params: Vec<&(dyn rusqlite::types::ToSql)> = Vec::new();

    macro_rules! add {
        ($field:expr, $val:expr) => {
            if let Some(v) = $val {
                sets.push(format!("{} = ?", $field));
                params.push(&v);
            }
        };
    }

    add!("trip_id", input.trip_id.as_ref());
    add!("start_date", input.start_date.as_ref());
    add!("end_date", input.end_date.as_ref());
    add!("days", input.days.as_ref());
    add!("destination", input.destination.as_ref());
    add!("employee_name", input.employee_name.as_ref());
    add!("reason", input.reason.as_ref());
    add!("notes", input.notes.as_ref());
    add!("status", input.status.as_ref());
    add!("paid_trip_allowance", input.paid_trip_allowance.as_ref());
    add!("paid_transport_allowance", input.paid_transport_allowance.as_ref());
    add!("paid_date", input.paid_date.as_ref());

    if sets.is_empty() {
        return get_trip(conn, id)?.ok_or_else(|| "Trip not found".to_string());
    }

    let sql = format!("UPDATE business_trip SET {} WHERE id = ?", sets.join(", "));
    params.push(&id);

    conn.execute(&sql, params.as_slice()).map_err(|e| e.to_string())?;
    get_trip(conn, id)?.ok_or_else(|| "Trip not found after update".to_string())
}

pub fn delete_trip(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM business_trip WHERE id = ?", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_trip(conn: &Connection, id: i64) -> Result<Option<TripRow>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, uuid, trip_id, start_date, end_date, days, destination, employee_name, reason, trip_allowance, transport_allowance, total, status, paid_trip_allowance, paid_transport_allowance, paid_date, notes, synced, nocobase_id, nocobase_updated_at, created_at FROM business_trip WHERE id = ?",
    ).map_err(|e| e.to_string())?;

    stmt.query_row([id], row_to_trip)
        .optional()
        .map_err(|e| e.to_string())
}

fn get_trip_by_uuid(conn: &Connection, uuid: &str) -> Result<Option<TripRow>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, uuid, trip_id, start_date, end_date, days, destination, employee_name, reason, trip_allowance, transport_allowance, total, status, paid_trip_allowance, paid_transport_allowance, paid_date, notes, synced, nocobase_id, nocobase_updated_at, created_at FROM business_trip WHERE uuid = ?",
    ).map_err(|e| e.to_string())?;

    stmt.query_row([uuid], row_to_trip)
        .optional()
        .map_err(|e| e.to_string())
}
