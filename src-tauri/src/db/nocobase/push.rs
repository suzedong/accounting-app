use crate::db::connection::Database;
use crate::db::sync_log::log_sync;
use crate::db::nocobase::client::NocoBaseClient;
use crate::db::nocobase::client::{extract_record_object, iso_utc_to_local_db};
use rusqlite::params;
use serde::Serialize;

/// 单条记录推送结果
#[derive(Serialize)]
#[allow(dead_code)]
pub struct PushRecordResult {
    pub success: bool,
    pub uuid: String,
    pub error: Option<String>,
}

/// 推送本地未同步记录到 NocoBase
pub async fn push_records(
    db: &Database,
    client: &NocoBaseClient,
) -> Result<(i32, Vec<String>), String> {
    let mut pushed = 0;
    let mut errors = Vec::new();

    // 1. 查询所有未同步且重试次数未达上限的本地记录
    let unsynced = get_unsynced_records(db)?;

    if unsynced.is_empty() {
        log_sync(db, "push", "records", "success", 0, None)?;
        return Ok((0, Vec::new()));
    }

    // 2. 逐条推送到 NocoBase
    for record in unsynced {
        match push_single_record(db, client, &record).await {
            Ok(_) => pushed += 1,
            Err(e) => {
                mark_push_failure(db, "records", &record.uuid, &e)?;
                errors.push(format!("[{}] {}", record.uuid, e));
            }
        }
    }

    // 3. 记录同步日志
    let status = if errors.is_empty() { "success" } else { "partial" };
    log_sync(db, "push", "records", status, pushed, errors.first().map(|s| s.as_str()))?;

    Ok((pushed, errors))
}

/// 推送单条记录到 NocoBase
async fn push_single_record(
    db: &Database,
    client: &NocoBaseClient,
    record: &UnsyncedRecord,
) -> Result<(), String> {
    // 构建推送到 NocoBase 的数据
    let data = serde_json::json!({
        "uuid": record.uuid,
        "datetime": record.datetime,
        "type": record.r#type,
        "category": record.category,
        "amount": record.amount,
        "account": record.account,
        "note": record.note,
        "payment_method": record.payment_method,
    });

    // 如果 NocoBase 已有此记录（nocobase_id 不为空），则更新
    if let Some(nocobase_id) = record.nocobase_id {
        let result = client.update_record("records", nocobase_id, data.clone()).await?;
        if let Some(obj) = extract_record_object(&result) {
            let updated_at = obj.get("updated_at").and_then(|v| v.as_str()).map(|s| s.to_string());
            update_record_synced_status(db, &record.uuid, Some(nocobase_id), updated_at)?;
        } else {
            // update 返回空：用 UUID 查询云端确认记录是否真的不存在，避免错误地创建重复记录
            let filter = serde_json::json!({ "uuid": record.uuid });
            let check = client.list_records("records", Some(filter), 1, 1).await?;
            if !check.data.is_empty() {
                return Err(format!(
                    "update 返回空但云端仍存在记录 uuid={}，跳过创建以防重复",
                    record.uuid
                ));
            }
            // 云端确认不存在，重新创建
            let result = client.create_record("records", data).await?;
            if let Some(obj) = extract_record_object(&result) {
                let new_id = obj.get("id").and_then(|v| v.as_i64());
                let updated_at = obj.get("updated_at").and_then(|v| v.as_str()).map(|s| s.to_string());
                update_record_synced_status(db, &record.uuid, new_id, updated_at)?;
            }
        }
    } else {
        // 创建新记录
        let result = client.create_record("records", data).await?;
        // 获取 NocoBase 返回的 ID
        if let Some(obj) = extract_record_object(&result) {
            let nocobase_id = obj.get("id").and_then(|v| v.as_i64());
            let updated_at = obj.get("updated_at").and_then(|v| v.as_str()).map(|s| s.to_string());
            update_record_synced_status(db, &record.uuid, nocobase_id, updated_at)?;
        }
    }

    Ok(())
}

/// 未同步记录的结构
struct UnsyncedRecord {
    uuid: String,
    datetime: String,
    r#type: String,
    category: Option<String>,
    amount: f64,
    account: String,
    note: Option<String>,
    payment_method: Option<String>,
    nocobase_id: Option<i64>,
}

/// 查询所有未同步且重试次数未达上限的本地记录
fn get_unsynced_records(db: &Database) -> Result<Vec<UnsyncedRecord>, String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare(
            "SELECT uuid, datetime, type, category, amount, account, note, payment_method, nocobase_id FROM records WHERE synced = 0 AND retry_count < 3",
        )
        .map_err(|e| e.to_string())?;

    let records: Vec<UnsyncedRecord> = stmt
        .query_map([], |row| {
            Ok(UnsyncedRecord {
                uuid: row.get(0)?,
                datetime: row.get(1)?,
                r#type: row.get(2)?,
                category: row.get(3)?,
                amount: row.get(4)?,
                account: row.get(5)?,
                note: row.get(6)?,
                payment_method: row.get(7)?,
                nocobase_id: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(records)
}

/// 更新本地记录的同步状态
fn update_record_synced_status(
    db: &Database,
    uuid: &str,
    nocobase_id: Option<i64>,
    nocobase_updated_at: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    // 推送后，local_updated_at 与 nocobase_updated_at 保持一致（数据已同步到云端，与云端版本相同）
    let local_updated_at: String = iso_utc_to_local_db(&nocobase_updated_at.clone().unwrap_or_default())
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    guard
        .execute(
            "UPDATE records SET synced = 1, nocobase_id = ?, nocobase_updated_at = ?, local_updated_at = ? WHERE uuid = ?",
            params![nocobase_id, nocobase_updated_at, local_updated_at, uuid],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 标记推送失败（递增重试次数，记录错误信息）
fn mark_push_failure(
    db: &Database,
    table: &str,
    uuid: &str,
    error: &str,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard
        .execute(
            &format!(
                "UPDATE {} SET retry_count = retry_count + 1, last_error = ? WHERE uuid = ?",
                table
            ),
            params![error, uuid],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
