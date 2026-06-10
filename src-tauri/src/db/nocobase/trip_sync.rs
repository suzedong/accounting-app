use crate::db::connection::Database;
use crate::db::sync_log::log_sync;
use crate::db::nocobase::client::NocoBaseClient;
use rusqlite::params;
use rusqlite::OptionalExtension;

/// 从 NocoBase 拉取差旅补助记录到本地
pub async fn pull_trips(
    db: &Database,
    client: &NocoBaseClient,
) -> Result<(i32, Vec<String>), String> {
    let mut pulled = 0;
    let mut errors = Vec::new();

    // 查询本地最大的 nocobase_updated_at，作为增量过滤条件
    let filter = get_last_trip_sync_time(db)?;

    let mut page = 1;
    let page_size = 100;

    loop {
        let list_resp = match client.list_records("business_trip", filter.clone(), page, page_size).await {
            Ok(resp) => resp,
            Err(e) => {
                errors.push(format!("拉取差旅补助第 {} 页失败: {}", page, e));
                break;
            }
        };

        if list_resp.data.is_empty() {
            break;
        }

        // 逐条处理
        for item in list_resp.data {
            match pull_single_trip(db, &item).await {
                Ok(true) => pulled += 1,
                Ok(false) => {} // 跳过
                Err(e) => errors.push(format!("[pull_trip] {}", e)),
            }
        }

        if page >= list_resp.meta.total_page {
            break;
        }
        page += 1;
    }

    // 记录同步日志
    let status = if errors.is_empty() { "success" } else { "partial" };
    log_sync(db, "pull", "business_trip", status, pulled, errors.first().map(|s| s.as_str()))?;

    Ok((pulled, errors))
}

/// 推送本地未同步的差旅补助到 NocoBase
pub async fn push_trips(
    db: &Database,
    client: &NocoBaseClient,
) -> Result<(i32, Vec<String>), String> {
    let mut pushed = 0;
    let mut errors = Vec::new();

    // 查询所有未同步的本地记录
    let unsynced = get_unsynced_trips(db)?;

    if unsynced.is_empty() {
        log_sync(db, "push", "business_trip", "success", 0, None)?;
        return Ok((0, Vec::new()));
    }

    // 逐条推送到 NocoBase
    for record in unsynced {
        match push_single_trip(db, client, &record).await {
            Ok(_) => pushed += 1,
            Err(e) => errors.push(format!("[{}] {}", record.uuid, e)),
        }
    }

    // 记录同步日志
    let status = if errors.is_empty() { "success" } else { "partial" };
    log_sync(db, "push", "business_trip", status, pushed, errors.first().map(|s| s.as_str()))?;

    Ok((pushed, errors))
}

/// 查询本地最大的 nocobase_updated_at
fn get_last_trip_sync_time(db: &Database) -> Result<Option<serde_json::Value>, String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let max_time: Option<String> = guard
        .query_row(
            "SELECT MAX(nocobase_updated_at) FROM business_trip 
             WHERE nocobase_updated_at IS NOT NULL 
             AND nocobase_updated_at LIKE '____-__-__T%'",
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

/// 拉取单条差旅补助记录到本地
async fn pull_single_trip(
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
    let local_record = get_local_trip_by_uuid(db, uuid)?;

    if let Some(local) = local_record {
        // 本地已有，比较更新时间
        let local_updated = local.local_updated_at.clone();
        let nocobase_updated = item.get("updated_at")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        // 如果本地更新，跳过
        if local_updated.as_str() > nocobase_updated {
            return Ok(false);
        }

        // NocoBase 更新，更新本地
        update_local_trip(db, uuid, item, nocobase_id, nocobase_updated_at)?;
    } else {
        // 本地没有，创建新记录
        insert_local_trip(db, uuid, item, nocobase_id, nocobase_updated_at)?;
    }

    Ok(true)
}

/// 根据 uuid 查询本地差旅补助记录
fn get_local_trip_by_uuid(db: &Database, uuid: &str) -> Result<Option<TripRecordInfo>, String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let record = guard
        .query_row(
            "SELECT local_updated_at FROM business_trip WHERE uuid = ?",
            [uuid],
            |row| Ok(TripRecordInfo {
                local_updated_at: row.get(0)?,
            }),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(record)
}

/// 本地差旅补助记录信息
struct TripRecordInfo {
    local_updated_at: String,
}

/// 插入新的差旅补助记录
fn insert_local_trip(
    db: &Database,
    uuid: &str,
    item: &serde_json::Value,
    nocobase_id: Option<i64>,
    nocobase_updated_at: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    
    let trip_id = item.get("trip_id").and_then(|v| v.as_str()).unwrap_or("");
    let start_date = item.get("start_date").and_then(|v| v.as_str()).unwrap_or("");
    let end_date = item.get("end_date").and_then(|v| v.as_str()).unwrap_or("");
    let days = item.get("days").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let trip_allowance = item.get("trip_allowance").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let transport_allowance = item.get("transport_allowance").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let total = item.get("total").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let status = item.get("status").and_then(|v| v.as_str()).unwrap_or("⏳ 待发放");
    let paid_trip_allowance = item.get("paid_trip_allowance").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let paid_transport_allowance = item.get("paid_transport_allowance").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let paid_date = item.get("paid_date").and_then(|v| v.as_str());
    let notes = item.get("notes").and_then(|v| v.as_str());
    let local_updated_at: String = item.get("local_updated_at").and_then(|v| v.as_str()).map(|s| s.to_string())
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string());

    guard
        .execute(
            "INSERT INTO business_trip 
            (uuid, trip_id, start_date, end_date, days, trip_allowance, transport_allowance, 
             total, status, paid_trip_allowance, paid_transport_allowance, paid_date, notes, 
             local_updated_at, synced, nocobase_id, nocobase_updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
            params![
                uuid, trip_id, start_date, end_date, days, trip_allowance, transport_allowance,
                total, status, paid_trip_allowance, paid_transport_allowance, paid_date, notes,
                local_updated_at, nocobase_id, nocobase_updated_at
            ],
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 更新本地差旅补助记录
fn update_local_trip(
    db: &Database,
    uuid: &str,
    item: &serde_json::Value,
    nocobase_id: Option<i64>,
    nocobase_updated_at: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    
    let trip_id = item.get("trip_id").and_then(|v| v.as_str()).unwrap_or("");
    let start_date = item.get("start_date").and_then(|v| v.as_str()).unwrap_or("");
    let end_date = item.get("end_date").and_then(|v| v.as_str()).unwrap_or("");
    let days = item.get("days").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let trip_allowance = item.get("trip_allowance").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let transport_allowance = item.get("transport_allowance").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let total = item.get("total").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let status = item.get("status").and_then(|v| v.as_str()).unwrap_or("⏳ 待发放");
    let paid_trip_allowance = item.get("paid_trip_allowance").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let paid_transport_allowance = item.get("paid_transport_allowance").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let paid_date = item.get("paid_date").and_then(|v| v.as_str());
    let notes = item.get("notes").and_then(|v| v.as_str());
    let local_updated_at: String = item.get("local_updated_at").and_then(|v| v.as_str()).map(|s| s.to_string())
        .unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%dT%H:%M:%S").to_string());

    guard
        .execute(
            "UPDATE business_trip SET 
             trip_id = ?, start_date = ?, end_date = ?, days = ?, 
             trip_allowance = ?, transport_allowance = ?, total = ?, 
             status = ?, paid_trip_allowance = ?, paid_transport_allowance = ?, 
             paid_date = ?, notes = ?, local_updated_at = ?, synced = 1, 
             nocobase_id = ?, nocobase_updated_at = ?
             WHERE uuid = ?",
            params![
                trip_id, start_date, end_date, days, trip_allowance, transport_allowance, total,
                status, paid_trip_allowance, paid_transport_allowance, paid_date, notes,
                local_updated_at, nocobase_id, nocobase_updated_at, uuid
            ],
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// 查询未同步的差旅补助记录
fn get_unsynced_trips(db: &Database) -> Result<Vec<UnsyncedTrip>, String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = guard
        .prepare("SELECT uuid, trip_id, start_date, end_date, days, trip_allowance, 
                   transport_allowance, total, status, paid_trip_allowance, paid_transport_allowance, 
                   paid_date, notes FROM business_trip WHERE synced = 0")
        .map_err(|e| e.to_string())?;

    let trips = stmt
        .query_map([], |row| {
            Ok(UnsyncedTrip {
                uuid: row.get(0)?,
                trip_id: row.get(1)?,
                start_date: row.get(2)?,
                end_date: row.get(3)?,
                days: row.get(4)?,
                trip_allowance: row.get(5)?,
                transport_allowance: row.get(6)?,
                total: row.get(7)?,
                status: row.get(8)?,
                paid_trip_allowance: row.get(9)?,
                paid_transport_allowance: row.get(10)?,
                paid_date: row.get(11)?,
                notes: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(trips)
}

/// 未同步差旅补助记录结构
struct UnsyncedTrip {
    uuid: String,
    trip_id: String,
    start_date: String,
    end_date: String,
    days: i32,
    trip_allowance: f64,
    transport_allowance: f64,
    total: f64,
    status: String,
    paid_trip_allowance: f64,
    paid_transport_allowance: f64,
    paid_date: Option<String>,
    notes: Option<String>,
}

/// 推送单条差旅补助记录到 NocoBase
async fn push_single_trip(
    db: &Database,
    client: &NocoBaseClient,
    record: &UnsyncedTrip,
) -> Result<(), String> {
    let data = serde_json::json!({
        "uuid": record.uuid,
        "trip_id": record.trip_id,
        "start_date": record.start_date,
        "end_date": record.end_date,
        "days": record.days,
        "trip_allowance": record.trip_allowance,
        "transport_allowance": record.transport_allowance,
        "total": record.total,
        "status": record.status,
        "paid_trip_allowance": record.paid_trip_allowance,
        "paid_transport_allowance": record.paid_transport_allowance,
        "paid_date": record.paid_date,
        "notes": record.notes,
    });

    // 查询 nocobase_id（在 await 前释放锁）
    let nocobase_id: Option<i64> = {
        let conn = db.get_conn();
        let guard = conn.lock().map_err(|e| e.to_string())?;
        guard
            .query_row("SELECT nocobase_id FROM business_trip WHERE uuid = ?", [&record.uuid], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?
    };

    // 异步操作（锁已释放）
    if let Some(nocobase_id) = nocobase_id {
        let result = client.update_record("business_trip", nocobase_id, data).await?;
        let updated_at = result.get("updated_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        update_trip_synced_status(db, &record.uuid, Some(nocobase_id), updated_at)?;
    } else {
        let result = client.create_record("business_trip", data).await?;
        if let Some(obj) = result.as_object() {
            let nocobase_id = obj.get("id").and_then(|v| v.as_i64());
            let updated_at = obj.get("updated_at").and_then(|v| v.as_str()).map(|s| s.to_string());
            update_trip_synced_status(db, &record.uuid, nocobase_id, updated_at)?;
        }
    }

    Ok(())
}

/// 更新差旅补助记录的同步状态
fn update_trip_synced_status(
    db: &Database,
    uuid: &str,
    nocobase_id: Option<i64>,
    updated_at: Option<String>,
) -> Result<(), String> {
    let conn = db.get_conn();
    let guard = conn.lock().map_err(|e| e.to_string())?;
    guard
        .execute(
            "UPDATE business_trip SET synced = 1, nocobase_id = ?, nocobase_updated_at = ? WHERE uuid = ?",
            params![nocobase_id, updated_at, uuid],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}