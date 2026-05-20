use tauri::State;

use crate::db::Database;
use crate::db::{RecordInput, RecordUpdateInput};

#[tauri::command]
pub async fn get_records(
    state: State<'_, Database>,
    page: Option<u32>,
    page_size: Option<u32>,
    filter_type: Option<String>,
    filter_category: Option<String>,
    filter_account: Option<String>,
    datetime_gte: Option<String>,
    datetime_lte: Option<String>,
    sort: Option<String>,
) -> Result<serde_json::Value, String> {
    let (records, count) = crate::db::records::get_records(
        state.inner(),
        page.unwrap_or(1),
        page_size.unwrap_or(20),
        filter_type.as_deref(),
        filter_category.as_deref(),
        filter_account.as_deref(),
        datetime_gte.as_deref(),
        datetime_lte.as_deref(),
        sort.as_deref(),
    )?;

    Ok(serde_json::json!({
        "data": records,
        "meta": { "count": count }
    }))
}

#[tauri::command]
pub async fn get_record(
    state: State<'_, Database>,
    id: i64,
) -> Result<serde_json::Value, String> {
    let record = crate::db::records::get_record(state.inner(), id)?;
    match record {
        Some(r) => Ok(serde_json::json!({ "data": r })),
        None => Err("Record not found".to_string()),
    }
}

#[tauri::command]
pub async fn create_record(
    state: State<'_, Database>,
    fields: RecordInput,
) -> Result<serde_json::Value, String> {
    let record = crate::db::records::create_record(state.inner(), fields)?;
    Ok(serde_json::json!({ "data": record }))
}

#[tauri::command]
pub async fn update_record(
    state: State<'_, Database>,
    id: i64,
    fields: RecordUpdateInput,
) -> Result<serde_json::Value, String> {
    let record = crate::db::records::update_record(state.inner(), id, fields)?;
    Ok(serde_json::json!({ "data": record }))
}

#[tauri::command]
pub async fn delete_record(
    state: State<'_, Database>,
    id: i64,
) -> Result<(), String> {
    crate::db::records::delete_record(state.inner(), id)
}
