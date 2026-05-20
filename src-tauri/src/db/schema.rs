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
    destination TEXT,
    employee_name TEXT,
    reason TEXT,
    trip_allowance REAL DEFAULT 0,
    transport_allowance REAL DEFAULT 0,
    total REAL DEFAULT 0,
    status TEXT DEFAULT '待发放',
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

-- 用户偏好
CREATE TABLE IF NOT EXISTS user_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
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

    Ok(())
}

fn seed_prompts(conn: &Connection) -> Result<(), rusqlite::Error> {
    let dispatch_content = r#"# dispatch.md

## 角色

你是一个智能记账助手。分析用户输入，选择最合适的**操作（action）**并返回结构化 JSON。

**重要**：用户可能发送图片（账单截图、支付通知、小票照片等）。收到图片时，请从中提取交易信息（金额、类型、分类、商户、时间等）。

## 返回格式

**必须且只能返回以下 JSON 结构**，不要返回其他格式：

```json
{
  "action": "操作名",
  "params": { "操作参数" },
  "render": "text | table | card | list | chart",
  "title": "给用户看的简短标题",
  "confidence": 0.0~1.0
}
```

## 能力清单

### create_record — 创建记账记录
当用户提到金额、花费、收入、交易时触发。

**params**: `{"fields": {"amount": 金额, "type": "收入/支出", "category": "分类", "account": "账户", "payment": "支付方式", "datetime": "YYYY-MM-DD HH:mm:ss", "note": "备注"}}`

### correct_record — 纠正上一条记录
当用户对刚记录的账条表示不满并指出正确值时触发。

### query_records — 查询记账记录列表
当用户想查看记账记录时触发。

### render_stats — 渲染统计结果
当用户想看统计结果时触发。

### render_budget — 渲染预算状态
当用户想了解预算状态时触发。

### save_preference — 保存用户偏好
当用户表达对记账习惯、格式、默认值的偏好时触发。

### update_prompt — 修改系统 prompt
仅在用户明确要求修改解析规则时触发。

### ask_follow_up — 追问补充信息
当用户明显要记账但缺少关键字段时触发。

### reply_text — 纯文本回复
用户输入不包含任何记账意图时触发。
"#;

    let record_content = r#"备注生成规则：备注需包含关键交易信息，避免过于简单。默认格式为'商户名'。餐饮堂食格式为'【堂食】_餐厅名'，外卖格式为'平台 - 商家名 外卖'。话费格式为'运营商 + 话费'。支付方式已通过独立字段记录，备注中不要重复包含支付方式。"#;

    conn.execute(
        "INSERT INTO system_prompts (name, content) VALUES (?, ?)",
        ["dispatch", dispatch_content],
    )?;
    conn.execute(
        "INSERT INTO system_prompts (name, content) VALUES (?, ?)",
        ["record", record_content],
    )?;

    Ok(())
}
