#!/usr/bin/env python3
"""
从 NocoBase 导入 records 和 business_trip 数据到本地 SQLite
用法: cd 项目根目录 && python scripts/import_from_nocobase.py
      python scripts/import_from_nocobase.py --db-path /path/to/app_data.db
"""
import os
import sys
import json
import sqlite3
import urllib.request
import urllib.parse
from pathlib import Path
from datetime import datetime

# --- 配置 ---

def load_env():
    env = {}
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        for line in env_path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env

env = load_env()
NOCOBASE_URL = env.get('NOCOBASE_API_URL', 'http://121.17.49.100:13000/api')
NOCOBASE_TOKEN = env.get('NOCOBASE_API_TOKEN', '')
DEFAULT_DB_PATH = Path(__file__).parent.parent / 'database' / 'app_data.db'

SCHEMA_SQL = r"""
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

CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,
    collection TEXT NOT NULL,
    status TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_prompts (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_preferences (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);
"""


def iso_to_local(dt_str):
    """Convert ISO 8601 UTC (e.g. '2026-05-02T16:00:00.000Z') to local SQLite format 'YYYY-MM-DD HH:MM:SS'"""
    if not dt_str:
        return datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    # Parse ISO 8601 and convert to local time
    try:
        # Handle 'Z' suffix
        s = dt_str.replace('Z', '+00:00')
        dt = datetime.fromisoformat(s)
        # Convert to local time
        local_dt = dt.astimezone()
        return local_dt.strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        return dt_str


def date_to_local_date(date_str):
    """Convert ISO 8601 date to local date string 'YYYY-MM-DD' (no timezone conversion needed for date-only)"""
    if not date_str:
        return ''
    try:
        s = date_str.replace('Z', '+00:00')
        dt = datetime.fromisoformat(s)
        return dt.strftime('%Y-%m-%d')
    except Exception:
        return date_str[:10]


def nocobase_api(collection: str, page: int = 1, page_size: int = 100):
    """调用 NocoBase API 获取数据"""
    params = urllib.parse.urlencode({'page': page, 'pageSize': page_size, 'sort': '-id'})
    url = f'{NOCOBASE_URL}/{collection}?{params}'
    req = urllib.request.Request(url)
    req.add_header('Authorization', f'Bearer {NOCOBASE_TOKEN}')
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
        return data.get('data', []), data.get('meta', {})
    except Exception as e:
        print(f'  [ERR] API 请求失败: {e}')
        return [], {}


def fetch_all(collection: str):
    """分页获取全部数据"""
    all_data = []
    page = 1
    while True:
        print(f'  正在拉取 {collection} 第 {page} 页...')
        items, meta = nocobase_api(collection, page=page, page_size=200)
        if not items:
            break
        all_data.extend(items)
        total = meta.get('count', 0)
        if len(all_data) >= total:
            break
        page += 1
    return all_data


def init_schema(conn: sqlite3.Connection):
    """创建数据库表结构"""
    conn.executescript(SCHEMA_SQL)

    # 插入预置 prompts
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM system_prompts")
    if cursor.fetchone()[0] == 0:
        # dispatch.md
        prompt_path = Path(__file__).parent.parent / 'src-tauri' / 'prompts' / 'dispatch.md'
        if prompt_path.exists():
            content = prompt_path.read_text(encoding='utf-8')
            cursor.execute(
                "INSERT INTO system_prompts (name, content) VALUES (?, ?)",
                ('dispatch', content)
            )

        record_content = "备注生成规则：备注需包含关键交易信息，避免过于简单。默认格式为'商户名'。"
        cursor.execute(
            "INSERT INTO system_prompts (name, content) VALUES (?, ?)",
            ('record', record_content)
        )
        conn.commit()
        print('  [OK] 预置 Prompt 已插入')


def import_records(db_conn: sqlite3.Connection, records: list):
    """导入 records"""
    cursor = db_conn.cursor()
    imported = 0
    for r in records:
        row = r.get('data', r) if 'data' in r else r
        nocobase_id = row.get('id')
        uid = f"nocobase_{nocobase_id}"

        cursor.execute('''
            INSERT OR REPLACE INTO records
                (uuid, datetime, type, category, amount, account, note,
                 payment_method, local_updated_at, synced, nocobase_id,
                 nocobase_updated_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            uid,
            iso_to_local(row.get('datetime', '')),
            row.get('type', '支出'),
            row.get('category', '其他'),
            float(row.get('amount', 0)),
            row.get('account', '个人'),
            row.get('note', '') or '',
            row.get('payment_method', '') or '',
            datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            1,
            nocobase_id,
            datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        ))
        imported += 1
    db_conn.commit()
    return imported


def import_trips(db_conn: sqlite3.Connection, trips: list):
    """导入 business_trip"""
    cursor = db_conn.cursor()
    imported = 0
    for t in trips:
        row = t.get('data', t) if 'data' in t else t
        nocobase_id = row.get('id')
        uid = f"nocobase_{nocobase_id}"

        cursor.execute('''
            INSERT OR REPLACE INTO business_trip
                (uuid, trip_id, start_date, end_date, days, destination,
                 employee_name, reason, trip_allowance, transport_allowance,
                 total, status, paid_trip_allowance, paid_transport_allowance,
                 paid_date, notes, synced, nocobase_id, nocobase_updated_at,
                 created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            uid,
            row.get('trip_id', '') or '',
            date_to_local_date(row.get('start_date', '')),
            date_to_local_date(row.get('end_date', '')),
            int(row.get('days', 0)),
            row.get('destination', '') or '',
            row.get('employee_name', '') or '',
            row.get('reason', '') or '',
            float(row.get('trip_allowance', 0) or 0),
            float(row.get('transport_allowance', 0) or 0),
            float(row.get('total', 0) or 0),
            row.get('status', '待发放'),
            float(row.get('paid_trip_allowance', 0) or 0),
            float(row.get('paid_transport_allowance', 0) or 0),
            iso_to_local(row.get('paid_date')) if row.get('paid_date') else '',
            row.get('notes', '') or '',
            1,
            nocobase_id,
            datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        ))
        imported += 1
    db_conn.commit()
    return imported


def main():
    db_path = DEFAULT_DB_PATH
    if len(sys.argv) > 1 and sys.argv[1] == '--db-path':
        db_path = Path(sys.argv[2])

    db_path.parent.mkdir(parents=True, exist_ok=True)

    print(f'数据库路径: {db_path}')
    print(f'NocoBase: {NOCOBASE_URL}')
    print()

    # 初始化 schema
    print('=== 初始化数据库结构 ===')
    conn = sqlite3.connect(str(db_path))
    init_schema(conn)
    print()

    # 拉取 NocoBase 数据
    print('=== 从 NocoBase 拉取数据 ===')
    records = fetch_all('records')
    print(f'  records: {len(records)} 条')

    trips = fetch_all('business_trip')
    print(f'  business_trip: {len(trips)} 条')
    print()

    # 导入
    print('=== 导入到本地 SQLite ===')

    # 先清空已有数据（防止重复导入）
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM records")
    old_count = cursor.fetchone()[0]
    if old_count > 0:
        print(f'  本地已有 {old_count} 条 records，将覆盖...')
        cursor.execute("DELETE FROM records")

    cursor.execute("SELECT COUNT(*) FROM business_trip")
    old_trip = cursor.fetchone()[0]
    if old_trip > 0:
        print(f'  本地已有 {old_trip} 条 business_trip，将覆盖...')
        cursor.execute("DELETE FROM business_trip")
    conn.commit()

    imported_records = import_records(conn, records)
    print(f'  [OK] 导入 records: {imported_records} 条')

    imported_trips = import_trips(conn, trips)
    print(f'  [OK] 导入 business_trip: {imported_trips} 条')

    # 统计验证
    cursor.execute("SELECT COUNT(*) FROM records")
    print(f'  验证: records 共 {cursor.fetchone()[0]} 条')
    cursor.execute("SELECT COUNT(*) FROM business_trip")
    print(f'  验证: business_trip 共 {cursor.fetchone()[0]} 条')

    conn.close()

    print()
    print(f'[DONE] 完成！数据库: {db_path}')
    print(f'   查看: sqlite3 "{db_path}" ".tables"')
    print(f'   查看: sqlite3 "{db_path}" "SELECT COUNT(*) FROM records;"')


if __name__ == '__main__':
    main()
