use crate::db::connection::Database;
use crate::db::sync_log::log_sync;
use crate::db::nocobase::client::{NocoBaseClient, iso_utc_to_local_db, diff_seconds_remote_minus_local};
use rusqlite::params;

/// 同步结果
pub struct SyncResult {
    pub pulled: i32,
    pub pushed: i32,
    pub deleted: i32,
    pub conflicts: i32,
    pub errors: Vec<String>,
}

/// 全量对比同步 - records 表
pub async fn sync_records_full(
    db: &Database,
    client: &NocoBaseClient,
) -> Result<SyncResult, String> {
    let mut result = SyncResult {
        pulled: 0,
        pushed: 0,
        deleted: 0,
        conflicts: 0,
        errors: Vec::new(),
    };

    println!("[SYNC] 开始全量对比同步...");

    // 1. 获取云端所有记录（UUID + updated_at）
    println!("[SYNC] 步骤 1: 获取云端所有记录...");
    let remote_records = fetch_all_remote_records(client).await?;
    println!("[SYNC] 云端记录数: {}", remote_records.len());

    // 2. 获取本地所有记录（UUID + local_updated_at + synced）
    println!("[SYNC] 步骤 2: 获取本地所有记录...");
    let local_records = fetch_all_local_records(db)?;
    println!("[SYNC] 本地记录数: {}", local_records.len());

    // 3. 构建索引（UUID -> 记录信息）
    let remote_map: std::collections::HashMap<String, RemoteRecordInfo> = remote_records
        .into_iter()
        .filter_map(|r| {
            if r.uuid.is_empty() {
                None
            } else {
                Some((r.uuid.clone(), r))
            }
        })
        .collect();

    let local_map: std::collections::HashMap<String, LocalRecordInfo> = local_records
        .into_iter()
        .map(|l| (l.uuid.clone(), l))
        .collect();

    // 4. 对比差异并执行同步操作
    println!("[SYNC] 步骤 3: 对比差异并执行同步...");

    // 4.1 处理云端有本地无的记录 → 拉取到本地
    for (uuid, remote) in &remote_map {
        if !local_map.contains_key(uuid) {
            println!("[SYNC] 云端有本地无: {} → 拉取", uuid);
            if let Err(e) = pull_record_to_local(db, client, uuid, remote).await {
                result.errors.push(format!("拉取 {} 失败: {}", uuid, e));
            } else {
                result.pulled += 1;
            }
        }
    }

    // 4.2 处理本地有云端无的记录 → 根据 synced 状态决定操作
    for (uuid, local) in &local_map {
        if !remote_map.contains_key(uuid) {
            if local.synced == 0 {
                // 重试次数超限，跳过
                if local.retry_count >= 3 {
                    println!("[SYNC] 本地有云端无但重试已达上限: {} → 跳过", uuid);
                    continue;
                }
                // synced = 0 → 推送到云端（本地新增未同步）
                println!("[SYNC] 本地有云端无且未同步: {} → 推送", uuid);
                if let Err(e) = push_record_to_remote(db, client, uuid, local).await {
                    mark_push_failure(db, "records", uuid, &e)?;
                    result.errors.push(format!("推送 {} 失败: {}", uuid, e));
                } else {
                    result.pushed += 1;
                }
            } else {
                // synced = 1 → 删除本地记录（云端已删除）
                println!("[SYNC] 本地有云端无且已同步: {} → 删除本地", uuid);
                if let Err(e) = delete_local_record(db, uuid) {
                    result.errors.push(format!("删除本地 {} 失败: {}", uuid, e));
                } else {
                    result.deleted += 1;
                }
            }
        }
    }

    // 4.3 处理两边都有的记录 → 比较时间，更新较旧的
    for (uuid, local) in &local_map {
        if let Some(remote) = remote_map.get(uuid) {
            // 比较更新时间：本地是空格格式本地时间，云端是 ISO UTC
            let diff = diff_seconds_remote_minus_local(&local.local_updated_at, &remote.updated_at);

            match diff {
                Some(diff) => {
                    // 设置阈值：5分钟（300秒）
                    let threshold = 300;

                    if diff > threshold {
                        // 云端明显较新 → 更新本地
                        println!("[SYNC] 云端较新: {} (diff={}s) → 更新本地", uuid, diff);
                        if let Err(e) = update_local_from_remote(db, client, uuid, remote).await {
                            result.errors.push(format!("更新本地 {} 失败: {}", uuid, e));
                        } else {
                            result.pulled += 1;
                            result.conflicts += 1;
                        }
                    } else if diff < -threshold {
                        // 本地明显较新 → 推送到云端
                        if local.retry_count >= 3 {
                            println!("[SYNC] 本地较新但重试已达上限: {} → 跳过", uuid);
                            continue;
                        }
                        println!("[SYNC] 本地较新: {} (diff={}s) → 推送", uuid, diff);
                        if let Err(e) = push_record_to_remote(db, client, uuid, local).await {
                            mark_push_failure(db, "records", uuid, &e)?;
                            result.errors.push(format!("推送 {} 失败: {}", uuid, e));
                        } else {
                            result.pushed += 1;
                            result.conflicts += 1;
                        }
                    } else {
                        // 时间接近，视为一致
                        println!("[SYNC] 时间一致: {} (diff={}s) → 无操作", uuid, diff);
                    }
                },
                None => {
                    // 无法解析时间，跳过
                    println!("[SYNC] 无法解析时间: {} → 跳过", uuid);
                }
            }
        }
    }

    // 5. 记录同步日志
    let status = if result.errors.is_empty() { "success" } else { "partial" };
    let message = if result.errors.is_empty() {
        None
    } else {
        Some(result.errors.first().unwrap().as_str())
    };
    log_sync(db, "sync_full", "records", status, result.pulled + result.pushed, message)?;

    println!("[SYNC] 同步完成: 拉取={}, 推送={}, 删除={}, 冲突={}, 错误={}",
        result.pulled, result.pushed, result.deleted, result.conflicts, result.errors.len());

    Ok(result)
}

/// 云端记录信息
struct RemoteRecordInfo {
    uuid: String,
    updated_at: String,
    id: Option<i64>,
}

/// 本地记录信息
struct LocalRecordInfo {
    uuid: String,
    local_updated_at: String,
    synced: i32,
    retry_count: i32,
    datetime: String,
    r#type: String,
    category: Option<String>,
    amount: f64,
    account: String,
    note: Option<String>,
    payment_method: Option<String>,
}

/// 获取云端所有记录
async fn fetch_all_remote_records(client: &NocoBaseClient) -> Result<Vec<RemoteRecordInfo>, String> {
    let mut records = Vec::new();
    let mut page = 1;
    let page_size = 100;

    loop {
        let resp = client.list_records("records", None, page, page_size).await?;
        
        if resp.data.is_empty() {
            break;
        }

        for item in resp.data {
            let uuid = item.get("uuid")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            
            let updated_at = item.get("updated_at")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            
            let id = item.get("id").and_then(|v| v.as_i64());

            records.push(RemoteRecordInfo {
                uuid,
                updated_at,
                id,
            });
        }

        if page >= resp.meta.total_page {
            break;
        }
        page += 1;
    }

    Ok(records)
}

/// 获取本地所有记录
fn fetch_all_local_records(db: &Database) -> Result<Vec<LocalRecordInfo>, String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = guard
        .prepare(
            "SELECT uuid, local_updated_at, synced, retry_count, datetime, type, category, amount, account, note, payment_method 
             FROM records"
        )
        .map_err(|e| e.to_string())?;

    let records = stmt
        .query_map([], |row| {
            Ok(LocalRecordInfo {
                uuid: row.get(0)?,
                local_updated_at: row.get(1)?,
                synced: row.get(2)?,
                retry_count: row.get(3)?,
                datetime: row.get(4)?,
                r#type: row.get(5)?,
                category: row.get(6)?,
                amount: row.get(7)?,
                account: row.get(8)?,
                note: row.get(9)?,
                payment_method: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(records)
}

/// 拉取单条记录到本地（云端有本地无）
async fn pull_record_to_local(
    db: &Database,
    client: &NocoBaseClient,
    uuid: &str,
    remote: &RemoteRecordInfo,
) -> Result<(), String> {
    // 使用 filter 获取特定 UUID 的完整记录数据
    let filter = serde_json::json!({
        "uuid": uuid
    });
    
    let resp = client.list_records("records", Some(filter), 1, 1).await?;
    let item = resp.data.first()
        .ok_or_else(|| format!("云端找不到记录 {}", uuid))?;

    let nocobase_id = remote.id;
    let nocobase_updated_at = Some(remote.updated_at.clone());

    // 插入到本地
    insert_local_record(db, uuid, item, nocobase_id, nocobase_updated_at)?;

    Ok(())
}

/// 推送本地记录到云端（本地有云端无）
async fn push_record_to_remote(
    db: &Database,
    client: &NocoBaseClient,
    uuid: &str,
    local: &LocalRecordInfo,
) -> Result<(), String> {
    // 构建记录数据
    let record_data = serde_json::json!({
        "uuid": uuid,
        "datetime": local.datetime,
        "type": local.r#type,
        "category": local.category,
        "amount": local.amount,
        "account": local.account,
        "note": local.note,
        "payment_method": local.payment_method,
        "local_updated_at": local.local_updated_at,
    });

    // 推送到云端
    let resp = client.create_record("records", record_data).await?;
    
    // 从响应中提取 id 和 updated_at
    let nocobase_id = resp.get("id").and_then(|v| v.as_i64());
    let nocobase_updated_at = resp.get("updated_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // 更新本地同步状态
    update_local_sync_status(db, uuid, nocobase_id, nocobase_updated_at)?;

    Ok(())
}

/// 更新本地记录（云端较新）
async fn update_local_from_remote(
    db: &Database,
    client: &NocoBaseClient,
    uuid: &str,
    remote: &RemoteRecordInfo,
) -> Result<(), String> {
    // 使用 filter 获取特定 UUID 的完整记录数据
    let filter = serde_json::json!({
        "uuid": uuid
    });
    
    let resp = client.list_records("records", Some(filter), 1, 1).await?;
    let item = resp.data.first()
        .ok_or_else(|| format!("云端找不到记录 {}", uuid))?;

    // 更新本地记录的所有字段
    update_local_record_full(db, uuid, item, remote.id, Some(remote.updated_at.clone()))?;

    Ok(())
}

/// 更新本地记录的所有字段
fn update_local_record_full(
    db: &Database,
    uuid: &str,
    item: &serde_json::Value,
    nocobase_id: Option<i64>,
    nocobase_updated_at: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;

    let datetime = get_json_string(item, "datetime")
        .and_then(|d| iso_utc_to_local_db(&d))
        .unwrap_or("".to_string());
    let r#type = get_json_string(item, "type").unwrap_or("".to_string());
    let category = get_json_string(item, "category");
    let amount = item.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let account = get_json_string(item, "account").unwrap_or("个人".to_string());
    let note = get_json_string(item, "note");
    let payment_method = get_json_string(item, "payment_method");

    guard
        .execute(
            "UPDATE records SET datetime = ?, type = ?, category = ?, amount = ?, account = ?, note = ?, payment_method = ?, synced = 1, nocobase_id = ?, nocobase_updated_at = ?, local_updated_at = ? WHERE uuid = ?",
            params![datetime, r#type, category, amount, account, note, payment_method, nocobase_id, nocobase_updated_at.clone(), iso_utc_to_local_db(&nocobase_updated_at.unwrap_or_default()).unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()), uuid],
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 删除本地记录（云端已删除）
fn delete_local_record(db: &Database, uuid: &str) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;

    guard
        .execute("DELETE FROM records WHERE uuid = ?", [uuid])
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

    let datetime = get_json_string(item, "datetime")
        .and_then(|d| iso_utc_to_local_db(&d))
        .unwrap_or("".to_string());
    let r#type = get_json_string(item, "type").unwrap_or("".to_string());
    let category = get_json_string(item, "category");
    let amount = item.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let account = get_json_string(item, "account").unwrap_or("个人".to_string());
    let note = get_json_string(item, "note");
    let payment_method = get_json_string(item, "payment_method");

    guard
        .execute(
            "INSERT INTO records (uuid, datetime, type, category, amount, account, note, payment_method, synced, nocobase_id, nocobase_updated_at, local_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
            params![uuid, datetime, r#type, category, amount, account, note, payment_method, nocobase_id, nocobase_updated_at.clone(), iso_utc_to_local_db(&nocobase_updated_at.unwrap_or_default()).unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string())],
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 更新本地同步状态
fn update_local_sync_status(
    db: &Database,
    uuid: &str,
    nocobase_id: Option<i64>,
    nocobase_updated_at: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;

    guard
        .execute(
            "UPDATE records SET synced = 1, nocobase_id = ?, nocobase_updated_at = ?, local_updated_at = ? WHERE uuid = ?",
            params![nocobase_id, nocobase_updated_at.clone(), iso_utc_to_local_db(&nocobase_updated_at.unwrap_or_default()).unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string()), uuid],
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

/// 获取 JSON 字段值，支持驼峰和下划线命名
fn get_json_string(item: &serde_json::Value, name: &str) -> Option<String> {
    // 先尝试下划线命名
    if let Some(v) = item.get(name).and_then(|v| v.as_str()) {
        return Some(v.to_string());
    }
    
    // 尝试驼峰命名（将下划线转为驼峰）
    let camel_case = name.split('_')
        .enumerate()
        .map(|(i, part)| {
            if i == 0 {
                part.to_string()
            } else {
                let mut chars = part.chars();
                match chars.next() {
                    None => String::new(),
                    Some(c) => c.to_uppercase().to_string() + chars.as_str(),
                }
            }
        })
        .collect::<String>();
    
    item.get(&camel_case).and_then(|v| v.as_str()).map(|s| s.to_string())
}

/// 仅从云端拉取记录到本地（不执行推送）
pub async fn pull_records_only(
    db: &Database,
    client: &NocoBaseClient,
) -> Result<(i32, Vec<String>), String> {
    let mut pulled = 0;
    let mut errors = Vec::new();

    println!("[SYNC] 开始仅拉取同步...");

    // 1. 获取云端所有记录（UUID + updated_at）
    println!("[SYNC] 步骤 1: 获取云端所有记录...");
    let remote_records = fetch_all_remote_records(client).await?;
    println!("[SYNC] 云端记录数: {}", remote_records.len());

    // 2. 获取本地所有记录（UUID + local_updated_at + synced）
    println!("[SYNC] 步骤 2: 获取本地所有记录...");
    let local_records = fetch_all_local_records(db)?;
    println!("[SYNC] 本地记录数: {}", local_records.len());

    // 3. 构建索引
    let remote_map: std::collections::HashMap<String, RemoteRecordInfo> = remote_records
        .into_iter()
        .filter_map(|r| {
            if r.uuid.is_empty() {
                None
            } else {
                Some((r.uuid.clone(), r))
            }
        })
        .collect();

    let local_map: std::collections::HashMap<String, LocalRecordInfo> = local_records
        .into_iter()
        .map(|l| (l.uuid.clone(), l))
        .collect();

    // 4. 仅处理云端有本地无的记录 → 拉取到本地
    println!("[SYNC] 步骤 3: 拉取云端有本地无的记录...");
    for (uuid, remote) in &remote_map {
        if !local_map.contains_key(uuid) {
            println!("[SYNC] 云端有本地无: {} → 拉取", uuid);
            if let Err(e) = pull_record_to_local(db, client, uuid, remote).await {
                errors.push(format!("拉取 {} 失败: {}", uuid, e));
            } else {
                pulled += 1;
            }
        }
    }

    // 5. 处理两边都有的记录 → 仅更新本地（云端较新时）
    println!("[SYNC] 步骤 4: 更新本地较旧的记录...");
    for (uuid, local) in &local_map {
        if let Some(remote) = remote_map.get(uuid) {
            let diff = diff_seconds_remote_minus_local(&local.local_updated_at, &remote.updated_at);

            if let Some(diff) = diff {
                let threshold = 300; // 5分钟

                if diff > threshold {
                    // 云端较新 → 更新本地
                    println!("[SYNC] 云端较新: {} (diff={}s) → 更新本地", uuid, diff);
                    if let Err(e) = update_local_from_remote(db, client, uuid, remote).await {
                        errors.push(format!("更新本地 {} 失败: {}", uuid, e));
                    } else {
                        pulled += 1;
                    }
                }
            }
        }
    }

    println!("[SYNC] 仅拉取完成: 拉取={}, 错误={}", pulled, errors.len());

    Ok((pulled, errors))
}