-- ============================================================================
-- accounting-app · Turso 目标 schema（迁移后不再包含 NocoBase 同步列）
-- ============================================================================
-- 用途：在 Turso 云端建立与本地 SQLite 语义等价、但去除 NocoBase 遗留字段的表
-- 使用：由 migrate.mjs 自动 execute；也可用 `turso db shell <db> < schema.sql` 手动执行
-- 注意：所有 CREATE 都用 IF NOT EXISTS，重复执行安全；`--drop` 由 migrate.mjs 提供
-- ============================================================================

-- 记账记录
-- 剔除字段：synced / retry_count / last_error / nocobase_id / nocobase_updated_at
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
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_records_datetime ON records(datetime);
CREATE INDEX IF NOT EXISTS idx_records_type ON records(type);
CREATE INDEX IF NOT EXISTS idx_records_category ON records(category);

-- 差旅补助
-- 剔除字段：synced / retry_count / last_error / nocobase_id / nocobase_updated_at
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
    status TEXT DEFAULT '⏳ 待发放',
    paid_trip_allowance REAL DEFAULT 0,
    paid_transport_allowance REAL DEFAULT 0,
    paid_date TEXT,
    notes TEXT,
    local_updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 系统 Prompt（原样保留）
CREATE TABLE IF NOT EXISTS system_prompts (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 学习数据
-- 剔除字段：synced / retry_count / last_error / nocobase_id / nocobase_updated_at
CREATE TABLE IF NOT EXISTS learning_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,
    key TEXT,
    value TEXT,
    count INTEGER DEFAULT 1,
    local_updated_at TEXT DEFAULT (datetime('now', 'localtime')),
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- 对话历史（原样保留）
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

-- 应用配置（业务相关子集；nocobase_* / turso_* / *_token 等端点信息不迁移）
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
