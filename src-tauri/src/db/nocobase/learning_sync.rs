use crate::db::connection::Database;
use crate::db::sync_log::log_sync;
use crate::db::nocobase::client::NocoBaseClient;
use crate::db::nocobase::client::{extract_record_object, diff_seconds_remote_minus_local, iso_utc_to_local_db};
use rusqlite::params;
use rusqlite::OptionalExtension;

/// 从 NocoBase 拉取学习数据到本地
pub async fn pull_learning(
    db: &Database,
    client: &NocoBaseClient,
) -> Result<(i32, Vec<String>), String> {
    let mut pulled = 0;
    let mut errors = Vec::new();

    // 查询本地最大的 nocobase_updated_at，作为增量过滤条件
    let filter = get_last_learning_sync_time(db)?;

    let mut page = 1;
    let page_size = 100;

    loop {
        let list_resp = match client.list_records("learning_data", filter.clone(), page, page_size).await {
            Ok(resp) => resp,
            Err(e) => {
                errors.push(format!("拉取学习数据第 {} 页失败: {}", page, e));
                break;
            }
        };

        if list_resp.data.is_empty() {
            break;
        }

        // 逐条处理
        for item in list_resp.data {
            match pull_single_learning(db, &item).await {
                Ok(true) => pulled += 1,
                Ok(false) => {} // 跳过
                Err(e) => errors.push(format!("[pull_learning] {}", e)),
            }
        }

        if page >= list_resp.meta.total_page {
            break;
        }
        page += 1;
    }

    // 记录同步日志
    let status = if errors.is_empty() { "success" } else { "partial" };
    log_sync(db, "pull", "learning_data", status, pulled, errors.first().map(|s| s.as_str()))?;

    Ok((pulled, errors))
}

/// 推送本地未同步的学习数据到 NocoBase
pub async fn push_learning(
    db: &Database,
    client: &NocoBaseClient,
) -> Result<(i32, Vec<String>), String> {
    let mut pushed = 0;
    let mut errors = Vec::new();

    // 查询所有未同步且重试次数未达上限的本地记录
    let unsynced = get_unsynced_learning(db)?;

    if unsynced.is_empty() {
        log_sync(db, "push", "learning_data", "success", 0, None)?;
        return Ok((0, Vec::new()));
    }

    // 逐条推送到 NocoBase
    for record in unsynced {
        match push_single_learning(db, client, &record).await {
            Ok(_) => pushed += 1,
            Err(e) => {
                mark_push_failure(db, "learning_data", &record.uuid, &e)?;
                errors.push(format!("[{}] {}", record.uuid, e));
            }
        }
    }

    // 记录同步日志
    let status = if errors.is_empty() { "success" } else { "partial" };
    log_sync(db, "push", "learning_data", status, pushed, errors.first().map(|s| s.as_str()))?;

    Ok((pushed, errors))
}

/// 查询本地最大的 nocobase_updated_at
fn get_last_learning_sync_time(db: &Database) -> Result<Option<serde_json::Value>, String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let max_time: Option<String> = guard
        .query_row(
            "SELECT MAX(nocobase_updated_at) FROM learning_data 
             WHERE nocobase_updated_at IS NOT NULL 
             AND nocobase_updated_at != ''",
            [],
            |r| r.get::<_, Option<String>>(0),
        )
        .map_err(|e| e.to_string())?;

    if let Some(time) = max_time {
        Ok(Some(serde_json::json!({
            "updated_at": { "$gt": time }
        })))
    } else {
        Ok(None)
    }
}

/// 拉取单条学习数据到本地
async fn pull_single_learning(
    db: &Database,
    item: &serde_json::Value,
) -> Result<bool, String> {
    let uuid = item.get("uuid")
        .and_then(|v| v.as_str());
    
    let uuid = match uuid {
        Some(u) if !u.is_empty() => u,
        _ => return Ok(false),
    };

    let nocobase_id = item.get("id").and_then(|v| v.as_i64());
    let nocobase_updated_at = item.get("updated_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 检查本地是否已有此记录
    let local_record = get_local_learning_by_uuid(db, uuid)?;

    if let Some(local) = local_record {
        // 本地已有，比较更新时间（本地空格格式 vs 云端 ISO UTC）
        let diff = diff_seconds_remote_minus_local(&local.local_updated_at, &nocobase_updated_at.clone().unwrap_or_default());

        if let Some(diff) = diff {
            if diff <= 300 {
                // 时间接近或本地较新，跳过
                return Ok(false);
            }
            // 云端明显较新，更新本地
            update_local_learning(db, uuid, item, nocobase_id, nocobase_updated_at)?;
        } else {
            // 无法解析时间，跳过
            return Ok(false);
        }
    } else {
        // 本地没有，创建新记录
        insert_local_learning(db, uuid, item, nocobase_id, nocobase_updated_at)?;
    }

    Ok(true)
}

/// 根据 uuid 查询本地学习数据记录
fn get_local_learning_by_uuid(db: &Database, uuid: &str) -> Result<Option<LearningRecordInfo>, String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let record = guard
        .query_row(
            "SELECT local_updated_at FROM learning_data WHERE uuid = ?",
            [uuid],
            |row| Ok(LearningRecordInfo {
                local_updated_at: row.get(0)?,
            }),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(record)
}

/// 本地学习数据记录信息
struct LearningRecordInfo {
    local_updated_at: String,
}

/// 插入新的学习数据记录
fn insert_local_learning(
    db: &Database,
    uuid: &str,
    item: &serde_json::Value,
    nocobase_id: Option<i64>,
    nocobase_updated_at: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    
    let r#type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let key = item.get("key").and_then(|v| v.as_str());
    let value = item.get("value").and_then(|v| v.as_str());
    let count = item.get("count").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
    // local_updated_at 反映"本地这条记录最后变更时间"。从云端拉取时，转换为本地时间空格格式
    let local_updated_at: String = iso_utc_to_local_db(&nocobase_updated_at.clone().unwrap_or_default())
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());

    guard
        .execute(
            "INSERT INTO learning_data 
            (uuid, type, key, value, count, synced, nocobase_id, nocobase_updated_at, local_updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)",
            params![uuid, r#type, key, value, count, nocobase_id, nocobase_updated_at, local_updated_at],
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 更新本地学习数据记录
fn update_local_learning(
    db: &Database,
    uuid: &str,
    item: &serde_json::Value,
    nocobase_id: Option<i64>,
    nocobase_updated_at: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    
    let r#type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let key = item.get("key").and_then(|v| v.as_str());
    let value = item.get("value").and_then(|v| v.as_str());
    let count = item.get("count").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
    // local_updated_at 反映"本地这条记录最后变更时间"。从云端拉取时，转换为本地时间空格格式
    let local_updated_at: String = iso_utc_to_local_db(&nocobase_updated_at.clone().unwrap_or_default())
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());

    guard
        .execute(
            "UPDATE learning_data SET 
             type = ?, key = ?, value = ?, count = ?, synced = 1, 
             nocobase_id = ?, nocobase_updated_at = ?, local_updated_at = ?
             WHERE uuid = ?",
            params![r#type, key, value, count, nocobase_id, nocobase_updated_at, local_updated_at, uuid],
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 查询未同步且重试次数未达上限的学习数据记录
fn get_unsynced_learning(db: &Database) -> Result<Vec<UnsyncedLearning>, String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare("SELECT uuid, type, key, value, count, nocobase_id FROM learning_data WHERE synced = 0 AND retry_count < 3")
        .map_err(|e| e.to_string())?;

    let learning = stmt
        .query_map([], |row| {
            Ok(UnsyncedLearning {
                uuid: row.get(0)?,
                r#type: row.get(1)?,
                key: row.get(2)?,
                value: row.get(3)?,
                count: row.get(4)?,
                nocobase_id: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(learning)
}

/// 未同步学习数据记录结构
struct UnsyncedLearning {
    uuid: String,
    r#type: String,
    key: Option<String>,
    value: Option<String>,
    count: i32,
    nocobase_id: Option<i64>,
}

/// 推送单条学习数据到 NocoBase
async fn push_single_learning(
    db: &Database,
    client: &NocoBaseClient,
    record: &UnsyncedLearning,
) -> Result<(), String> {
    let data = serde_json::json!({
        "uuid": record.uuid,
        "type": record.r#type,
        "key": record.key,
        "value": record.value,
        "count": record.count,
    });

    // 异步操作（nocobase_id 已在查询时取出，无需再查）
    if let Some(nocobase_id) = record.nocobase_id {
        let result = client.update_record("learning_data", nocobase_id, data.clone()).await?;
        if let Some(obj) = extract_record_object(&result) {
            let updated_at = obj.get("updated_at").and_then(|v| v.as_str()).map(|s| s.to_string());
            update_learning_synced_status(db, &record.uuid, Some(nocobase_id), updated_at)?;
        } else {
            // update 返回空：用 UUID 查询云端确认记录是否真的不存在，避免错误地创建重复记录
            let filter = serde_json::json!({ "uuid": record.uuid });
            let check = client.list_records("learning_data", Some(filter), 1, 1).await?;
            if !check.data.is_empty() {
                return Err(format!(
                    "update 返回空但云端仍存在记录 uuid={}，跳过创建以防重复",
                    record.uuid
                ));
            }
            // 云端确认不存在，重新创建
            let result = client.create_record("learning_data", data).await?;
            if let Some(obj) = extract_record_object(&result) {
                let new_id = obj.get("id").and_then(|v| v.as_i64());
                let updated_at = obj.get("updated_at").and_then(|v| v.as_str()).map(|s| s.to_string());
                update_learning_synced_status(db, &record.uuid, new_id, updated_at)?;
            }
        }
    } else {
        let result = client.create_record("learning_data", data).await?;
        if let Some(obj) = extract_record_object(&result) {
            let nocobase_id = obj.get("id").and_then(|v| v.as_i64());
            let updated_at = obj.get("updated_at").and_then(|v| v.as_str()).map(|s| s.to_string());
            update_learning_synced_status(db, &record.uuid, nocobase_id, updated_at)?;
        }
    }

    Ok(())
}

/// 更新学习数据记录的同步状态
fn update_learning_synced_status(
    db: &Database,
    uuid: &str,
    nocobase_id: Option<i64>,
    updated_at: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    // 推送后，local_updated_at 与 nocobase_updated_at 保持一致（数据已同步到云端，与云端版本相同）
    let local_updated_at: String = iso_utc_to_local_db(&updated_at.clone().unwrap_or_default())
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string());
    guard
        .execute(
            "UPDATE learning_data SET synced = 1, nocobase_id = ?, nocobase_updated_at = ?, local_updated_at = ? WHERE uuid = ?",
            params![nocobase_id, updated_at, local_updated_at, uuid],
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