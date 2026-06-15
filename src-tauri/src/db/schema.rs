use rusqlite::Connection;

pub fn init(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Migration: chat_history table structure change (add session_id, drop skill/confidence)
    migrate_chat_history(conn)?;

    conn.execute_batch(
        r#"
-- 记账记录
CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    datetime TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT,
    amount REAL NOT NULL DEFAULT 0,
    account TEXT DEFAULT '个人',
    note TEXT,
    payment_method TEXT,
    local_updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    synced INTEGER DEFAULT 0,
    nocobase_id INTEGER,
    nocobase_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_records_datetime ON records(datetime);
CREATE INDEX IF NOT EXISTS idx_records_type ON records(type);
CREATE INDEX IF NOT EXISTS idx_records_category ON records(category);
CREATE INDEX IF NOT EXISTS idx_records_synced ON records(synced);

-- 差旅补助
CREATE TABLE IF NOT EXISTS business_trip (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    trip_id TEXT,
    start_date TEXT,
    end_date TEXT,
    days INTEGER,
    trip_allowance REAL DEFAULT 0,
    transport_allowance REAL DEFAULT 0,
    total REAL DEFAULT 0,
    status TEXT DEFAULT ' 待发放',
    paid_trip_allowance REAL DEFAULT 0,
    paid_transport_allowance REAL DEFAULT 0,
    paid_date TEXT,
    notes TEXT,
    local_updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    synced INTEGER DEFAULT 0,
    nocobase_id INTEGER,
    nocobase_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 系统 Prompt
CREATE TABLE IF NOT EXISTS system_prompts (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 学习数据
CREATE TABLE IF NOT EXISTS learning_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    key TEXT,
    value TEXT,
    count INTEGER DEFAULT 1,
    local_updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    synced INTEGER DEFAULT 0,
    nocobase_id INTEGER,
    nocobase_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 对话历史
CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    data TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id, created_at);

-- 同步日志
CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,
    collection TEXT NOT NULL,
    status TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 应用配置（AI Key、NocoBase URL 等）
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#,
    )?;

    // Seed prompts if empty
    let prompt_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM system_prompts",
        [],
        |row| row.get(0),
    )?;

    if prompt_count == 0 {
        seed_prompts(conn)?;
    }

    // Seed default app_config if empty
    let config_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM app_config",
        [],
        |row| row.get(0),
    )?;

    if config_count == 0 {
        seed_default_config(conn)?;
    }

    // Migration: add local_updated_at column to business_trip for sync support
    // NOTE: SQLite ALTER TABLE ADD COLUMN does not support non-constant defaults like datetime('now', 'localtime')
    let has_local_updated_at: bool = conn.prepare("SELECT * FROM pragma_table_info('business_trip') WHERE name = 'local_updated_at'")
        .ok()
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, bool>(0)).ok())
        .unwrap_or(false);
    if !has_local_updated_at {
        let _ = conn.execute("ALTER TABLE business_trip ADD COLUMN local_updated_at TEXT DEFAULT ''", []);
        let _ = conn.execute("UPDATE business_trip SET local_updated_at = datetime('now', 'localtime') WHERE local_updated_at IS NULL OR local_updated_at = ''", []);
    }

    // Migration: add local_updated_at column to learning_data for sync support
    let has_learning_local_updated_at: bool = conn.prepare("SELECT * FROM pragma_table_info('learning_data') WHERE name = 'local_updated_at'")
        .ok()
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, bool>(0)).ok())
        .unwrap_or(false);
    if !has_learning_local_updated_at {
        let _ = conn.execute("ALTER TABLE learning_data ADD COLUMN local_updated_at TEXT DEFAULT ''", []);
        let _ = conn.execute("UPDATE learning_data SET local_updated_at = datetime('now', 'localtime') WHERE local_updated_at IS NULL OR local_updated_at = ''", []);
    }
    
    // Migration: drop deprecated columns from business_trip
    let _ = conn.execute("ALTER TABLE business_trip DROP COLUMN destination", []);
    let _ = conn.execute("ALTER TABLE business_trip DROP COLUMN employee_name", []);
    let _ = conn.execute("ALTER TABLE business_trip DROP COLUMN reason", []);

    // Migration: strip time from start_date/end_date (keep only YYYY-MM-DD)
    let _ = conn.execute(
        "UPDATE business_trip SET start_date = SUBSTR(start_date, 1, 10) WHERE LENGTH(start_date) > 10",
        [],
    );
    let _ = conn.execute(
        "UPDATE business_trip SET end_date = SUBSTR(end_date, 1, 10) WHERE LENGTH(end_date) > 10",
        [],
    );

    // Migration: add emoji prefix to status values
    let _ = conn.execute(
        "UPDATE business_trip SET status = '⏳ 待发放' WHERE status = '待发放'",
        [],
    );
    let _ = conn.execute(
        "UPDATE business_trip SET status = '✅ 已发放' WHERE status = '已发放'",
        [],
    );
    let _ = conn.execute(
        "UPDATE business_trip SET status = '❌ 已过期' WHERE status = '已过期'",
        [],
    );

    // Migration: seed preferences prompt if missing
    let pref_exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM system_prompts WHERE name = 'preferences'",
        [],
        |row| row.get(0),
    )?;
    if pref_exists == 0 {
        conn.execute(
            "INSERT INTO system_prompts (name, content) VALUES ('preferences', ?)",
            [include_str!("../../prompts/preferences.md")],
        )?;
    }

    // Sync dispatch prompt from file (always update to pick up new rules like _source annotations)
    conn.execute(
        "INSERT INTO system_prompts (name, content, updated_at) VALUES ('dispatch', ?, datetime('now', 'localtime')) ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = datetime('now', 'localtime')",
        [include_str!("../../prompts/dispatch.md")],
    )?;

    // Cleanup: drop deprecated user_preferences table (KV model abandoned, preferences are now markdown docs)
    let _ = conn.execute("DROP TABLE IF EXISTS user_preferences", []);

    // Cleanup: learning_data with value containing |field (from short-lived composite-key experiment)
    // These rows are invalid since they stored field in value as JSON, but the new format stores field in key
    let _ = conn.execute(
        "DELETE FROM learning_data WHERE type = 'correction' AND (value LIKE '{%\"field\"%' OR value LIKE '{%field:%}')",
        [],
    );

    // Cleanup: remove deprecated 'record' prompt (merged into dispatch.md)
    let _ = conn.execute("DELETE FROM system_prompts WHERE name = 'record'", []);

    // Migration: add retry_count and last_error columns for sync retry control
    // records table
    let has_records_retry: bool = conn.prepare("SELECT * FROM pragma_table_info('records') WHERE name = 'retry_count'")
        .ok()
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, bool>(0)).ok())
        .unwrap_or(false);
    if !has_records_retry {
        let _ = conn.execute("ALTER TABLE records ADD COLUMN retry_count INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE records ADD COLUMN last_error TEXT", []);
    }

    // business_trip table
    let has_trip_retry: bool = conn.prepare("SELECT * FROM pragma_table_info('business_trip') WHERE name = 'retry_count'")
        .ok()
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, bool>(0)).ok())
        .unwrap_or(false);
    if !has_trip_retry {
        let _ = conn.execute("ALTER TABLE business_trip ADD COLUMN retry_count INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE business_trip ADD COLUMN last_error TEXT", []);
    }

    // learning_data table
    let has_learning_retry: bool = conn.prepare("SELECT * FROM pragma_table_info('learning_data') WHERE name = 'retry_count'")
        .ok()
        .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, bool>(0)).ok())
        .unwrap_or(false);
    if !has_learning_retry {
        let _ = conn.execute("ALTER TABLE learning_data ADD COLUMN retry_count INTEGER DEFAULT 0", []);
        let _ = conn.execute("ALTER TABLE learning_data ADD COLUMN last_error TEXT", []);
    }

    Ok(())
}

fn seed_prompts(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO system_prompts (name, content) VALUES (?, ?)",
        ["dispatch", include_str!("../../prompts/dispatch.md")],
    )?;
    conn.execute(
        "INSERT INTO system_prompts (name, content) VALUES (?, ?)",
        ["preferences", include_str!("../../prompts/preferences.md")],
    )?;

    Ok(())
}

fn seed_default_config(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)",
        ["ocr_enabled", "true"],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)",
        ["budget_monthly", "3500.0"],
    )?;
    // ai_services starts as empty array, user configures via Settings
    Ok(())
}

/// 优雅迁移 chat_history 表结构
/// 旧结构：id, uuid, session_id(可能不存在), role, content, data, skill, confidence, created_at
/// 新结构：id, uuid, session_id, role, content, data, created_at
fn migrate_chat_history(conn: &Connection) -> Result<(), rusqlite::Error> {
    // 检查表是否存在
    let table_exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='chat_history'",
        [],
        |row| row.get(0),
    )?;

    if table_exists == 0 {
        // 表不存在，直接创建新结构
        conn.execute(
            r#"CREATE TABLE chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                uuid TEXT UNIQUE NOT NULL,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT,
                data TEXT,
                created_at TEXT DEFAULT (datetime('now', 'localtime'))
            )"#,
            [],
        )?;
        conn.execute(
            "CREATE INDEX idx_chat_history_session ON chat_history(session_id, created_at)",
            [],
        )?;
        return Ok(());
    }

    // 检查是否已经有 session_id 字段（判断是否已迁移）
    let has_session_id = column_exists(conn, "chat_history", "session_id");
    let has_skill = column_exists(conn, "chat_history", "skill");
    let has_confidence = column_exists(conn, "chat_history", "confidence");

    // 如果已经是新结构，不需要迁移
    if has_session_id && !has_skill && !has_confidence {
        return Ok(());
    }

    eprintln!("[Migration] Migrating chat_history table structure...");

    // 1. 备份旧数据到新表
    conn.execute_batch(
        r#"
        CREATE TABLE chat_history_backup (
            id INTEGER PRIMARY KEY,
            uuid TEXT,
            role TEXT,
            content TEXT,
            data TEXT,
            created_at TEXT
        );
        
        INSERT INTO chat_history_backup (id, uuid, role, content, data, created_at)
        SELECT id, uuid, role, content, data, created_at FROM chat_history;
        "#,
    )?;

    let backup_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chat_history_backup",
        [],
        |row| row.get(0),
    )?;
    eprintln!("[Migration] Backed up {} chat messages", backup_count);

    // 2. 删除旧表
    conn.execute("DROP TABLE chat_history", [])?;

    // 3. 创建新表
    conn.execute(
        r#"CREATE TABLE chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT,
            data TEXT,
            created_at TEXT DEFAULT (datetime('now', 'localtime'))
        )"#,
        [],
    )?;
    conn.execute(
        "CREATE INDEX idx_chat_history_session ON chat_history(session_id, created_at)",
        [],
    )?;

    // 4. 恢复数据，为新 session_id 生成默认值
    let timestamp = chrono::Local::now().format("%Y%m%d%H%M%S");
    let default_session = format!("migrated_session_{}", timestamp);

    if backup_count > 0 {
        conn.execute(
            &format!(
                "INSERT INTO chat_history (id, uuid, session_id, role, content, data, created_at)
                 SELECT id, 
                        COALESCE(uuid, lower(hex(randomblob(16)))), 
                        '{}',
                        COALESCE(role, 'user'),
                        content,
                        data,
                        created_at
                 FROM chat_history_backup
                 WHERE role IS NOT NULL",
                default_session
            ),
            [],
        )?;
    }

    let restored_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM chat_history",
        [],
        |row| row.get(0),
    )?;
    eprintln!("[Migration] Restored {} chat messages to new structure", restored_count);

    // 5. 删除备份表
    conn.execute("DROP TABLE chat_history_backup", [])?;

    Ok(())
}

/// 检查表是否存在指定列
fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    let query = format!(
        "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name='{}'",
        table, column
    );
    conn.query_row(&query, [], |row| row.get::<_, i64>(0))
        .map(|count| count > 0)
        .unwrap_or(false)
}
