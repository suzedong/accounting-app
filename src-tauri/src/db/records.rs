use libsql::{params, Value};
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
    pub created_at: String,
}

const SELECT_COLS: &str =
    "id, uuid, datetime, type, category, amount, account, note, payment_method, created_at";

fn row_to_record(row: &libsql::Row) -> Result<RecordRow, libsql::Error> {
    Ok(RecordRow {
        id: row.get::<i64>(0)?,
        uuid: row.get::<String>(1)?,
        datetime: row.get::<String>(2)?,
        r#type: row.get::<String>(3)?,
        category: row.get::<Option<String>>(4)?,
        amount: row.get::<f64>(5)?,
        account: row.get::<Option<String>>(6)?.unwrap_or_else(|| "个人".into()),
        note: row.get::<Option<String>>(7)?,
        payment_method: row.get::<Option<String>>(8)?,
        created_at: row.get::<Option<String>>(9)?.unwrap_or_default(),
    })
}

pub async fn get_records(
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
    let mut params: Vec<Value> = Vec::new();
    let mut where_clauses = Vec::new();

    if let Some(t) = filter_type {
        where_clauses.push("type = ?");
        params.push(Value::from(t.to_string()));
    }
    if let Some(c) = filter_category {
        where_clauses.push("category = ?");
        params.push(Value::from(c.to_string()));
    }
    if let Some(a) = filter_account {
        where_clauses.push("account = ?");
        params.push(Value::from(a.to_string()));
    }
    if let Some(d) = datetime_gte {
        where_clauses.push("datetime >= ?");
        params.push(Value::from(d.to_string()));
    }
    if let Some(d) = datetime_lte {
        where_clauses.push("datetime <= ?");
        params.push(Value::from(d.to_string()));
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

    let conn = state.get_conn().await?;

    let count_sql = format!("SELECT COUNT(*) FROM records {}", where_sql);
    let mut count_rows = conn
        .query(&count_sql, params.clone())
        .await
        .map_err(|e| e.to_string())?;
    let count: i64 = match count_rows.next().await.map_err(|e| e.to_string())? {
        Some(row) => row.get::<i64>(0).map_err(|e| e.to_string())?,
        None => 0,
    };

    let offset = (page - 1) * page_size;
    let list_sql = format!(
        "SELECT {} FROM records {} {} LIMIT ? OFFSET ?",
        SELECT_COLS, where_sql, order
    );
    params.push(Value::Integer(page_size as i64));
    params.push(Value::Integer(offset as i64));

    let mut rows = conn
        .query(&list_sql, params)
        .await
        .map_err(|e| e.to_string())?;

    let mut records = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        records.push(row_to_record(&row).map_err(|e| e.to_string())?);
    }

    Ok((records, count))
}

pub async fn get_record(state: &Database, id: i64) -> Result<Option<RecordRow>, String> {
    let conn = state.get_conn().await?;
    let sql = format!("SELECT {} FROM records WHERE id = ?", SELECT_COLS);
    let mut rows = conn
        .query(&sql, params![id])
        .await
        .map_err(|e| e.to_string())?;
    match rows.next().await.map_err(|e| e.to_string())? {
        Some(row) => Ok(Some(row_to_record(&row).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

pub async fn create_record(state: &Database, input: RecordInput) -> Result<RecordRow, String> {
    let conn = state.get_conn().await?;
    let uuid = uuid::Uuid::new_v4().to_string();
    let account = input.account.unwrap_or_else(|| "个人".to_string());

    conn.execute(
        "INSERT INTO records (uuid, datetime, type, category, amount, account, note, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            uuid.clone(),
            input.datetime,
            input.r#type,
            input.category,
            input.amount,
            account,
            input.note,
            input.payment_method,
        ],
    )
    .await
    .map_err(|e| e.to_string())?;

    get_record_by_uuid(state, &uuid)
        .await?
        .ok_or_else(|| "Failed to retrieve created record".to_string())
}

pub async fn update_record(
    state: &Database,
    id: i64,
    input: RecordUpdateInput,
) -> Result<RecordRow, String> {
    let mut sets: Vec<String> = Vec::new();
    let mut params_vec: Vec<Value> = Vec::new();

    if let Some(v) = input.datetime {
        sets.push("datetime = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.r#type {
        sets.push("type = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.category {
        sets.push("category = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.amount {
        sets.push("amount = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.account {
        sets.push("account = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.note {
        sets.push("note = ?".to_string());
        params_vec.push(Value::from(v));
    }
    if let Some(v) = input.payment_method {
        sets.push("payment_method = ?".to_string());
        params_vec.push(Value::from(v));
    }

    if sets.is_empty() {
        // 没有字段变化，直接返回
        return get_record(state, id)
            .await?
            .ok_or_else(|| "Record not found".to_string());
    }

    let sql = format!("UPDATE records SET {} WHERE id = ?", sets.join(", "));
    params_vec.push(Value::Integer(id));

    let conn = state.get_conn().await?;
    conn.execute(&sql, params_vec)
        .await
        .map_err(|e| e.to_string())?;

    get_record(state, id)
        .await?
        .ok_or_else(|| "Record not found after update".to_string())
}

pub async fn delete_record(state: &Database, id: i64) -> Result<(), String> {
    let conn = state.get_conn().await?;
    conn.execute("DELETE FROM records WHERE id = ?", params![id])
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

async fn get_record_by_uuid(state: &Database, uuid: &str) -> Result<Option<RecordRow>, String> {
    let conn = state.get_conn().await?;
    let sql = format!("SELECT {} FROM records WHERE uuid = ?", SELECT_COLS);
    let mut rows = conn
        .query(&sql, params![uuid])
        .await
        .map_err(|e| e.to_string())?;
    match rows.next().await.map_err(|e| e.to_string())? {
        Some(row) => Ok(Some(row_to_record(&row).map_err(|e| e.to_string())?)),
        None => Ok(None),
    }
}

/// Get distinct categories from existing records
pub async fn get_categories(
    state: &Database,
    record_type: Option<&str>,
) -> Result<Vec<String>, String> {
    let conn = state.get_conn().await?;

    let mut rows = if let Some(t) = record_type {
        conn.query(
            "SELECT DISTINCT category FROM records WHERE category IS NOT NULL AND category != '' AND type = ? ORDER BY category",
            params![t.to_string()],
        )
        .await
    } else {
        conn.query(
            "SELECT DISTINCT category FROM records WHERE category IS NOT NULL AND category != '' ORDER BY category",
            (),
        )
        .await
    }
    .map_err(|e| e.to_string())?;

    let mut categories = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        if let Ok(Some(v)) = row.get::<Option<String>>(0) {
            categories.push(v);
        }
    }
    Ok(categories)
}

/// Get distinct payment methods from existing records
pub async fn get_payment_methods(state: &Database) -> Result<Vec<String>, String> {
    let conn = state.get_conn().await?;
    let mut rows = conn
        .query(
            "SELECT DISTINCT payment_method FROM records WHERE payment_method IS NOT NULL AND payment_method != '' ORDER BY payment_method",
            (),
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut methods = Vec::new();
    while let Some(row) = rows.next().await.map_err(|e| e.to_string())? {
        if let Ok(Some(v)) = row.get::<Option<String>>(0) {
            methods.push(v);
        }
    }
    Ok(methods)
}
