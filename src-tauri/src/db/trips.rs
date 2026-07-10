use libsql::{params, Value};
use serde::{Deserialize, Serialize};

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

#[derive(Serialize)]
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
    pub created_at: String,
}

const SELECT_COLS: &str = "id, uuid, trip_id, start_date, end_date, days, trip_allowance, transport_allowance, total, status, paid_trip_allowance, paid_transport_allowance, paid_date, notes, created_at";

fn row_to_trip(row: &libsql::Row) -> Result<TripRow, libsql::Error> {
    Ok(TripRow {
        id: row.get::<i64>(0)?,
        uuid: row.get::<String>(1)?,
        trip_id: row.get::<Option<String>>(2)?,
        start_date: row.get::<Option<String>>(3)?,
        end_date: row.get::<Option<String>>(4)?,
        days: row.get::<Option<i64>>(5)?.map(|v| v as i32),
        trip_allowance: row.get::<Option<f64>>(6)?.unwrap_or(0.0),
        transport_allowance: row.get::<Option<f64>>(7)?.unwrap_or(0.0),
        total: row.get::<Option<f64>>(8)?.unwrap_or(0.0),
        status: row.get::<Option<String>>(9)?.unwrap_or_else(|| "⏳ 待发放".into()),
        paid_trip_allowance: row.get::<Option<f64>>(10)?.unwrap_or(0.0),
        paid_transport_allowance: row.get::<Option<f64>>(11)?.unwrap_or(0.0),
        paid_date: row.get::<Option<String>>(12)?,
        notes: row.get::<Option<String>>(13)?,
        created_at: row.get::<Option<String>>(14)?.unwrap_or_default(),
    })
}

pub async fn get_trips(state: &Database, status: Option<&str>) -> Result<Vec<TripRow>, String> {
    let conn = state.get_conn().await?;

    let mut rows = match status {
        Some(s) => {
            let sql = format!(
                "SELECT {} FROM business_trip WHERE status = ? ORDER BY start_date DESC",
                SELECT_COLS
            );
            conn.query(&sql, params![s.to_string()]).await
        }
        None => {
            let sql = format!(
                "SELECT {} FROM business_trip ORDER BY start_date DESC",
                SELECT_COLS
            );
            conn.query(&sql, ()).await
        }
    }
    .map_err(|e| e.to_string())?;

    let mut trips = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        trips.push(row_to_trip(&row).map_err(|e| e.to_string())?);
    }
    Ok(trips)
}

pub async fn create_trip(state: &Database, input: TripInput) -> Result<TripRow, String> {
    let conn = state.get_conn().await?;
    let uuid = uuid::Uuid::new_v4().to_string();
    let days = input.days.unwrap_or(0);
    let trip_allowance = days as f64 * 100.0;
    let transport_allowance = days as f64 * 30.0;
    let total = trip_allowance + transport_allowance;

    conn.execute(
        "INSERT INTO business_trip (uuid, trip_id, start_date, end_date, days, notes, trip_allowance, transport_allowance, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            uuid.clone(),
            input.trip_id,
            input.start_date,
            input.end_date,
            days,
            input.notes,
            trip_allowance,
            transport_allowance,
            total,
        ],
    )
    .await
    .map_err(|e| e.to_string())?;

    get_trip_by_uuid(state, &uuid)
        .await?
        .ok_or_else(|| "Failed to retrieve created trip".to_string())
}

pub async fn update_trip(
    state: &Database,
    id: i64,
    input: TripUpdateInput,
) -> Result<TripRow, String> {
    let mut sets: Vec<String> = Vec::new();
    let mut params_vec: Vec<Value> = Vec::new();

    if let Some(v) = input.trip_id {
        sets.push("trip_id = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.start_date {
        sets.push("start_date = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.end_date {
        sets.push("end_date = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.days {
        sets.push("days = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.notes {
        sets.push("notes = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.status {
        sets.push("status = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.paid_trip_allowance {
        sets.push("paid_trip_allowance = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.paid_transport_allowance {
        sets.push("paid_transport_allowance = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.paid_date {
        sets.push("paid_date = ?".to_string());
        params_vec.push(Value::from(v));
    }

    // days 变化时联动重算金额（当调用方未显式重写金额时统一维护）
    // 规则同 create_trip：trip_allowance = days*100 / transport_allowance = days*30 / total = days*130
    if let Some(days) = input.days {
        let trip_allowance = days as f64 * 100.0;
        let transport_allowance = days as f64 * 30.0;
        let total = trip_allowance + transport_allowance;
        sets.push("trip_allowance = ?".to_string());
        params_vec.push(Value::from(trip_allowance));
        sets.push("transport_allowance = ?".to_string());
        params_vec.push(Value::from(transport_allowance));
        sets.push("total = ?".to_string());
        params_vec.push(Value::from(total));
    }

    if sets.is_empty() {
        return get_trip(state, id)
            .await?
            .ok_or_else(|| "Trip not found".to_string());
    }

    let sql = format!("UPDATE business_trip SET {} WHERE id = ?", sets.join(", "));
    params_vec.push(Value::Integer(id));

    let conn = state.get_conn().await?;
    conn.execute(&sql, params_vec)
        .await
        .map_err(|e| e.to_string())?;

    get_trip(state, id)
        .await?
        .ok_or_else(|| "Trip not found after update".to_string())
}

pub async fn delete_trip(state: &Database, id: i64) -> Result<(), String> {
    let conn = state.get_conn().await?;
    conn.execute("DELETE FROM business_trip WHERE id = ?", params![id])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn get_trip(state: &Database, id: i64) -> Result<Option<TripRow>, String> {
    let conn = state.get_conn().await?;
    let sql = format!("SELECT {} FROM business_trip WHERE id = ?", SELECT_COLS);
    let mut rows = conn
        .query(&sql, params![id])
        .await
        .map_err(|e| e.to_string())?;
    match rows.next().await.map_err(|e| e.to_string())? {
        Some(row) => Ok(Some(row_to_trip(&row).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

async fn get_trip_by_uuid(state: &Database, uuid: &str) -> Result<Option<TripRow>, String> {
    let conn = state.get_conn().await?;
    let sql = format!("SELECT {} FROM business_trip WHERE uuid = ?", SELECT_COLS);
    let mut rows = conn
        .query(&sql, params![uuid])
        .await
        .map_err(|e| e.to_string())?;
    match rows.next().await.map_err(|e| e.to_string())? {
        Some(row) => Ok(Some(row_to_trip(&row).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}
