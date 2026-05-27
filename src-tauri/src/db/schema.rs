use rusqlite::Connection;

pub fn init(conn: &Connection) -> Result<(), rusqlite::Error> {
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
    local_updated_at TEXT DEFAULT (datetime('now')),
    synced INTEGER DEFAULT 0,
    nocobase_id INTEGER,
    nocobase_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
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
    synced INTEGER DEFAULT 0,
    nocobase_id INTEGER,
    nocobase_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 系统 Prompt
CREATE TABLE IF NOT EXISTS system_prompts (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 学习数据
CREATE TABLE IF NOT EXISTS learning_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    key TEXT,
    value TEXT,
    count INTEGER DEFAULT 1,
    synced INTEGER DEFAULT 0,
    nocobase_id INTEGER,
    nocobase_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 对话历史
CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL,
    content TEXT,
    data TEXT,
    skill TEXT,
    confidence REAL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 同步日志
CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,
    collection TEXT NOT NULL,
    status TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
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

    // Cleanup: drop deprecated user_preferences table (KV model abandoned, preferences are now markdown docs)
    let _ = conn.execute("DROP TABLE IF EXISTS user_preferences", []);

    // Cleanup: learning_data with value containing |field (from short-lived composite-key experiment)
    // These rows are invalid since they stored field in value as JSON, but the new format stores field in key
    let _ = conn.execute(
        "DELETE FROM learning_data WHERE type = 'correction' AND (value LIKE '{%\"field\"%' OR value LIKE '{%field:%}')",
        [],
    );

    Ok(())
}

fn seed_prompts(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO system_prompts (name, content) VALUES (?, ?)",
        ["dispatch", include_str!("../../prompts/dispatch.md")],
    )?;
    conn.execute(
        "INSERT INTO system_prompts (name, content) VALUES (?, ?)",
        ["record", include_str!("../../prompts/record.md")],
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
