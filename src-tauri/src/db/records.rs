use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use super::connection::Database;

#[derive(Deserialize)]
pub struct RecordInput {
    pub datetime: String,
    pub r#type: String,
    pub category: Option<String>,
    pub amount: f64,
    pub account: Option<String>,
    pub note: Option<String>,
    pub payment_method: Option<String>,
}

#[derive(Deserialize)]
pub struct RecordUpdateInput {
    pub datetime: Option<String>,
    pub r#type: Option<String>,
    pub category: Option<String>,
    pub amount: Option<f64>,
    pub account: Option<String>,
    pub note: Option<String>,
    pub payment_method: Option<String>,
}

#[derive(Serialize)]
pub struct RecordRow {
    pub id: i64,
    pub uuid: String,
    pub datetime: String,
    pub r#type: String,
    pub category: Option<String>,
    pub amount: f64,
    pub account: String,
    pub note: Option<String>,
    pub payment_method: Option<String>,
    pub local_updated_at: String,
    pub synced: i32,
    pub nocobase_id: Option<i64>,
    pub nocobase_updated_at: Option<String>,
    pub created_at: String,
}

fn row_to_record(row: &rusqlite::Row<'_>) -> Result<RecordRow, rusqlite::Error> {
    Ok(RecordRow {
        id: row.get(0)?,
        uuid: row.get(1)?,
        datetime: row.get(2)?,
        r#type: row.get(3)?,
        category: row.get(4)?,
        amount: row.get(5)?,
        account: row.get(6)?,
        note: row.get(7)?,
        payment_method: row.get(8)?,
        local_updated_at: row.get(9)?,
        synced: row.get(10)?,
        nocobase_id: row.get(11)?,
        nocobase_updated_at: row.get(12)?,
        created_at: row.get(13)?,
    })
}

pub fn get_records(
    state: &Database,
    page: u32,
    page_size: u32,
    filter_type: Option<&str>,
    filter_category: Option<&str>,
    filter_account: Option<&str>,
    datetime_gte: Option<&str>,
    datetime_lte: Option<&str>,
    sort: Option<&str>,
) -> Result<(Vec<RecordRow>, i64), String> {
    let mut params: Vec<Box<dyn rusqlite::ToSql + Send>> = Vec::new();
    let mut where_clauses = Vec::new();

    if let Some(t) = filter_type {
        where_clauses.push("type = ?");
        params.push(Box::new(t.to_string()));
    }
    if let Some(c) = filter_category {
        where_clauses.push("category = ?");
        params.push(Box::new(c.to_string()));
    }
    if let Some(a) = filter_account {
        where_clauses.push("account = ?");
        params.push(Box::new(a.to_string()));
    }
    if let Some(d) = datetime_gte {
        where_clauses.push("datetime >= ?");
        params.push(Box::new(d.to_string()));
    }
    if let Some(d) = datetime_lte {
        where_clauses.push("datetime <= ?");
        params.push(Box::new(d.to_string()));
    }

    let where_sql = if where_clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let order = match sort.unwrap_or("datetime") {
        "datetime_desc" => "ORDER BY datetime DESC",
        "datetime_asc" => "ORDER BY datetime ASC",
        "amount_desc" => "ORDER BY amount DESC",
        "amount_asc" => "ORDER BY amount ASC",
        _ => "ORDER BY datetime DESC",
    };

    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;

    let count: i64 = guard
        .query_row(
            &format!("SELECT COUNT(*) FROM records {}", where_sql),
            rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())),
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let offset = (page - 1) * page_size;
    let mut stmt = guard
        .prepare(&format!(
            "SELECT id, uuid, datetime, type, category, amount, account, note, payment_method, local_updated_at, synced, nocobase_id, nocobase_updated_at, created_at FROM records {} {} LIMIT ? OFFSET ?",
            where_sql, order
        ))
        .map_err(|e| e.to_string())?;

    params.push(Box::new(page_size));
    params.push(Box::new(offset));

    let records: Vec<RecordRow> = stmt
        .query_map(rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())), row_to_record)
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok((records, count))
}

pub fn get_record(state: &Database, id: i64) -> Result<Option<RecordRow>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare(
            "SELECT id, uuid, datetime, type, category, amount, account, note, payment_method, local_updated_at, synced, nocobase_id, nocobase_updated_at, created_at FROM records WHERE id = ?",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row([id], row_to_record)
        .optional()
        .map_err(|e| e.to_string())
}

pub fn create_record(
    state: &Database,
    input: RecordInput,
) -> Result<RecordRow, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let uuid = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    guard.execute(
        "INSERT INTO records (uuid, datetime, type, category, amount, account, note, payment_method, local_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            &uuid,
            &input.datetime,
            &input.r#type,
            &input.category,
            &input.amount,
            &input.account.as_deref().unwrap_or("个人"),
            &input.note,
            &input.payment_method,
            &now,
        ),
    ).map_err(|e| e.to_string())?;
    drop(guard);

    get_record_by_uuid(state, &uuid)?.ok_or_else(|| "Failed to retrieve created record".to_string())
}

pub fn update_record(
    state: &Database,
    id: i64,
    input: RecordUpdateInput,
) -> Result<RecordRow, String> {
    let mut sets = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql + Send>> = Vec::new();

    macro_rules! add_set {
        ($field:expr, $val:expr) => {
            if let Some(v) = $val {
                sets.push(format!("{} = ?", $field));
                params.push(Box::new(v.clone()));
            }
        };
    }

    let now = chrono::Utc::now().to_rfc3339();
    add_set!("datetime", input.datetime.as_ref());
    add_set!("type", input.r#type.as_ref());
    add_set!("category", input.category.as_ref());
    add_set!("amount", input.amount.as_ref());
    add_set!("account", input.account.as_ref());
    add_set!("note", input.note.as_ref());
    add_set!("payment_method", input.payment_method.as_ref());

    sets.push("local_updated_at = ?".to_string());
    params.push(Box::new(now));

    if sets.is_empty() {
        return get_record(state, id)?.ok_or_else(|| "Record not found".to_string());
    }

    let sql = format!(
        "UPDATE records SET {} WHERE id = ?",
        sets.join(", ")
    );
    params.push(Box::new(id));

    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute(&sql, rusqlite::params_from_iter(params.iter().map(|p| p.as_ref())))
        .map_err(|e| e.to_string())?;
    drop(guard);

    get_record(state, id)?.ok_or_else(|| "Record not found after update".to_string())
}

pub fn delete_record(state: &Database, id: i64) -> Result<(), String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard.execute("DELETE FROM records WHERE id = ?", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn get_record_by_uuid(state: &Database, uuid: &str) -> Result<Option<RecordRow>, String> {
    let conn = state.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare(
            "SELECT id, uuid, datetime, type, category, amount, account, note, payment_method, local_updated_at, synced, nocobase_id, nocobase_updated_at, created_at FROM records WHERE uuid = ?",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row([uuid], row_to_record)
        .optional()
        .map_err(|e| e.to_string())
}
