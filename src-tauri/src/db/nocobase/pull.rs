use crate::db::connection::Database;
use crate::db::sync_log::log_sync;
use crate::db::nocobase::client::NocoBaseClient;
use rusqlite::params;
use rusqlite::OptionalExtension;

/// 从 NocoBase 拉取更新到本地
pub async fn pull_records(
    db: &Database,
    client: &NocoBaseClient,
) -> Result<(i32, Vec<String>), String> {
    let mut pulled = 0;
    let mut errors = Vec::new();

    // 查询本地最大的 nocobase_updated_at，作为增量过滤条件
    let filter = get_last_sync_time(db)?;

    let mut page = 1;
    let page_size = 100;

    loop {
        let list_resp = match client.list_records("records", filter.clone(), page, page_size).await {
            Ok(resp) => resp,
            Err(e) => {
                errors.push(format!("拉取第 {} 页失败: {}", page, e));
                break;
            }
        };

        if list_resp.data.is_empty() {
            break;
        }

        // 3. 逐条处理
        for item in list_resp.data {
            match pull_single_record(db, &item).await {
                Ok(true) => pulled += 1,
                Ok(false) => {} // 跳过
                Err(e) => errors.push(format!("[pull] {}", e)),
            }
        }

        // 检查是否还有更多
        if page >= list_resp.meta.total_page {
            break;
        }
        page += 1;
    }

    // 4. 记录同步日志
    let status = if errors.is_empty() { "success" } else { "partial" };
    log_sync(db, "pull", "records", status, pulled, errors.first().map(|s| s.as_str()))?;

    Ok((pulled, errors))
}

/// 拉取单条记录到本地
/// 返回 Ok(true) = 已插入/更新, Ok(false) = 跳过
async fn pull_single_record(
    db: &Database,
    item: &serde_json::Value,
) -> Result<bool, String> {
    let uuid = item.get("uuid")
        .and_then(|v| v.as_str());
    
    // 跳过 uuid 为 NULL 的记录（历史数据）
    let uuid = match uuid {
        Some(u) if !u.is_empty() => u,
        _ => return Ok(false),
    };

    let nocobase_id = item.get("id").and_then(|v| v.as_i64());
    let nocobase_updated_at = item.get("updatedAt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 检查本地是否已有此记录
    let local_record = get_local_record_by_uuid(db, uuid)?;

    if let Some(local) = local_record {
        // 本地已有，比较更新时间
        let local_updated = local.local_updated_at.clone();
        let nocobase_updated = item.get("updatedAt")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // 如果本地更新，跳过
        if local_updated.as_str() > nocobase_updated {
            return Ok(false);
        }

        // NocoBase 更新，更新本地
        update_local_record(db, uuid, item, nocobase_id, nocobase_updated_at)?;
    } else {
        // 本地没有，创建新记录
        insert_local_record(db, uuid, item, nocobase_id, nocobase_updated_at)?;
    }

    Ok(true)
}

/// 本地记录结构
struct LocalRecordInfo {
    local_updated_at: String,
}

/// 查询本地最大的 nocobase_updated_at，返回 NocoBase filter（增量拉取用）
fn get_last_sync_time(db: &Database) -> Result<Option<serde_json::Value>, String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    // 过滤掉无效的 nocobase_updated_at（如旧 push 逻辑存储的 "now"）
    // 只接受 ISO 8601 格式的时间戳
    let max_time: Option<String> = guard
        .query_row(
            "SELECT MAX(nocobase_updated_at) FROM records 
             WHERE nocobase_updated_at IS NOT NULL 
             AND nocobase_updated_at LIKE '____-__-__T%'",
            [],
            |r| r.get::<_, Option<String>>(0),
        )
        .map_err(|e| e.to_string())?;

    if let Some(time) = max_time {
        // 使用 NocoBase filter: updatedAt > time
        Ok(Some(serde_json::json!({
            "updatedAt": { "$gt": time }
        })))
    } else {
        // 首次同步，无过滤
        Ok(None)
    }
}

/// 根据 uuid 查询本地记录
fn get_local_record_by_uuid(db: &Database, uuid: &str) -> Result<Option<LocalRecordInfo>, String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare("SELECT local_updated_at FROM records WHERE uuid = ?")
        .map_err(|e| e.to_string())?;

    let result = stmt
        .query_row([uuid], |row| {
            Ok(LocalRecordInfo {
                local_updated_at: row.get(0)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(result)
}

/// 更新本地记录
fn update_local_record(
    db: &Database,
    uuid: &str,
    item: &serde_json::Value,
    nocobase_id: Option<i64>,
    nocobase_updated_at: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;

    let datetime = item.get("datetime").and_then(|v| v.as_str()).unwrap_or("");
    let r#type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let category = item.get("category").and_then(|v| v.as_str());
    let amount = item.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let account = item.get("account").and_then(|v| v.as_str()).unwrap_or("个人");
    let note = item.get("note").and_then(|v| v.as_str());
    let payment_method = item.get("payment_method").and_then(|v| v.as_str());

    guard
        .execute(
            "UPDATE records SET datetime = ?, type = ?, category = ?, amount = ?, account = ?, note = ?, payment_method = ?, synced = 1, nocobase_id = ?, nocobase_updated_at = ?, local_updated_at = datetime('now') WHERE uuid = ?",
            params![datetime, r#type, category, amount, account, note, payment_method, nocobase_id, nocobase_updated_at, uuid],
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 插入新记录到本地
fn insert_local_record(
    db: &Database,
    uuid: &str,
    item: &serde_json::Value,
    nocobase_id: Option<i64>,
    nocobase_updated_at: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;

    let datetime = item.get("datetime").and_then(|v| v.as_str()).unwrap_or("");
    let r#type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let category = item.get("category").and_then(|v| v.as_str());
    let amount = item.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let account = item.get("account").and_then(|v| v.as_str()).unwrap_or("个人");
    let note = item.get("note").and_then(|v| v.as_str());
    let payment_method = item.get("payment_method").and_then(|v| v.as_str());

    guard
        .execute(
            "INSERT INTO records (uuid, datetime, type, category, amount, account, note, payment_method, synced, nocobase_id, nocobase_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
            params![uuid, datetime, r#type, category, amount, account, note, payment_method, nocobase_id, nocobase_updated_at],
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}
