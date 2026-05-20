use tauri::State;
use serde::Serialize;

use crate::db::Database;
use crate::db::{TripInput, TripUpdateInput};

#[tauri::command]
pub async fn get_business_trips(
    state: State<'_, Database>,
    status: Option<String>,
) -> Result<serde_json::Value, String> {
    let conn = state.get_conn()?;
    let trips = crate::db::trips::get_trips(&conn, status.as_deref())?;
    Ok(serde_json::json!({ "data": trips }))
}

#[tauri::command]
pub async fn create_business_trip(
    state: State<'_, Database>,
    fields: TripInput,
) -> Result<serde_json::Value, String> {
    let conn = state.get_conn()?;
    let trip = crate::db::trips::create_trip(&conn, fields)?;
    Ok(serde_json::json!({ "data": trip }))
}

#[tauri::command]
pub async fn update_business_trip(
    state: State<'_, Database>,
    id: i64,
    fields: TripUpdateInput,
) -> Result<serde_json::Value, String> {
    let conn = state.get_conn()?;
    let trip = crate::db::trips::update_trip(&conn, id, fields)?;
    Ok(serde_json::json!({ "data": trip }))
}

#[tauri::command]
pub async fn delete_business_trip(
    state: State<'_, Database>,
    id: i64,
) -> Result<(), String> {
    let conn = state.get_conn()?;
    crate::db::trips::delete_trip(&conn, id)
}
