#!/usr/bin/env python3
"""
从旧 SQLite 数据库导入 records 和 business_trip 到新数据库
用法: cd 项目根目录 && python scripts/import_from_old_db.py
"""
import sqlite3
import uuid
from pathlib import Path
from datetime import datetime

# --- 路径 ---
OLD_DB = Path.home() / '.qclaw' / 'workspace' / 'accounting-skill' / 'database' / 'accounting.db'
NEW_DB = Path(__file__).parent.parent / 'database' / 'app_data.db'

# --- 新数据库 Schema ---
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

CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chat_history (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL, role TEXT NOT NULL, content TEXT, data TEXT, skill TEXT, confidence REAL, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS learning_data (id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT UNIQUE NOT NULL, type TEXT NOT NULL, key TEXT, value TEXT, count INTEGER DEFAULT 1, synced INTEGER DEFAULT 0, nocobase_id INTEGER, nocobase_updated_at TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sync_log (id INTEGER PRIMARY KEY AUTOINCREMENT, direction TEXT NOT NULL, collection TEXT NOT NULL, status TEXT NOT NULL, count INTEGER DEFAULT 0, error TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS system_prompts (name TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS user_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')));
"""


def main():
    if not OLD_DB.exists():
        print(f"❌ 旧数据库不存在: {OLD_DB}")
        return

    NEW_DB.parent.mkdir(parents=True, exist_ok=True)

    old_conn = sqlite3.connect(str(OLD_DB))
    new_conn = sqlite3.connect(str(NEW_DB))
    old_cur = old_conn.cursor()
    new_cur = new_conn.cursor()

    # 初始化新库 schema
    print(f'数据库路径: {NEW_DB}')
    print('=== 初始化数据库结构 ===')
    new_conn.executescript(SCHEMA_SQL)

    # 插入预置 prompts
    new_cur.execute("SELECT COUNT(*) FROM system_prompts")
    if new_cur.fetchone()[0] == 0:
        prompt_path = Path(__file__).parent.parent / 'src-tauri' / 'prompts' / 'dispatch.md'
        if prompt_path.exists():
            content = prompt_path.read_text()
            new_cur.execute(
                "INSERT INTO system_prompts (name, content) VALUES (?, ?)",
                ('dispatch', content)
            )
        new_cur.execute(
            "INSERT INTO system_prompts (name, content) VALUES (?, ?)",
            ('record', "备注生成规则：备注需包含关键交易信息，避免过于简单。")
        )
        new_conn.commit()
        print('  ✓ 预置 Prompt 已插入')
    print()

    # 检查旧库数据
    old_cur.execute("SELECT COUNT(*) FROM records")
    old_records_count = old_cur.fetchone()[0]
    old_cur.execute("SELECT COUNT(*) FROM business_trip")
    old_trips_count = old_cur.fetchone()[0]
    print(f'旧数据库: {old_records_count} 条 records, {old_trips_count} 条 business_trip')
    print()

    # --- 导入 records ---
    print('=== 导入 records ===')
    # 先清空新库
    new_cur.execute("SELECT COUNT(*) FROM records")
    old_count = new_cur.fetchone()[0]
    if old_count > 0:
        print(f'  本地已有 {old_count} 条 records，将清空后重新导入...')
        new_cur.execute("DELETE FROM records")
        new_conn.commit()

    old_cur.execute("""
        SELECT datetime, type, category, amount, account, note, payment_method,
               created_at, updated_at
        FROM records ORDER BY datetime ASC
    """)
    rows = old_cur.fetchall()

    imported = 0
    for row in rows:
        (dt, typ, cat, amt, acc, note, pm, created_at, updated_at) = row
        uid = str(uuid.uuid4())

        new_cur.execute('''
            INSERT OR REPLACE INTO records
                (uuid, datetime, type, category, amount, account, note,
                 payment_method, local_updated_at, synced, nocobase_id,
                 nocobase_updated_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            uid,
            dt or datetime.now().isoformat(),
            typ or '支出',
            cat or '其他',
            float(amt) if amt else 0,
            acc or '个人',
            note or '',
            pm or '',
            datetime.now().isoformat(),
            0,  # synced = 0，标记为本地数据
            None,  # nocobase_id
            updated_at or '',
            created_at or datetime.now().isoformat(),
        ))
        imported += 1
        if imported % 100 == 0:
            new_conn.commit()

    new_conn.commit()
    print(f'  ✓ 导入 {imported} 条 records')

    # --- 导入 business_trip ---
    print()
    print('=== 导入 business_trip ===')
    new_cur.execute("SELECT COUNT(*) FROM business_trip")
    old_count = new_cur.fetchone()[0]
    if old_count > 0:
        print(f'  本地已有 {old_count} 条 business_trip，将清空后重新导入...')
        new_cur.execute("DELETE FROM business_trip")
        new_conn.commit()

    old_cur.execute("""
        SELECT trip_id, start_date, end_date, days,
               trip_allowance, transport_allowance, total,
               status, paid_date, notes, synced_at
        FROM business_trip ORDER BY start_date ASC
    """)
    rows = old_cur.fetchall()

    imported_trips = 0
    for row in rows:
        (trip_id, start_date, end_date, days,
         trip_allowance, transport_allowance, total,
         status, paid_date, notes, synced_at) = row
        uid = str(uuid.uuid4())

        new_cur.execute('''
            INSERT OR REPLACE INTO business_trip
                (uuid, trip_id, start_date, end_date, days, destination,
                 employee_name, reason, trip_allowance, transport_allowance,
                 total, status, paid_trip_allowance, paid_transport_allowance,
                 paid_date, notes, synced, nocobase_id, nocobase_updated_at,
                 created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            uid,
            trip_id or '',
            start_date or '',
            end_date or '',
            days or 0,
            '',  # destination (旧库无此字段)
            '',  # employee_name
            '',  # reason
            float(trip_allowance) if trip_allowance else 0,
            float(transport_allowance) if transport_allowance else 0,
            float(total) if total else 0,
            status or '待发放',
            0,  # paid_trip_allowance
            0,  # paid_transport_allowance
            paid_date or '',
            notes or '',
            0,
            None,
            synced_at or '',
            datetime.now().isoformat(),
        ))
        imported_trips += 1

    new_conn.commit()
    print(f'  ✓ 导入 {imported_trips} 条 business_trip')

    # 验证
    print()
    print('=== 验证 ===')
    new_cur.execute("SELECT COUNT(*) FROM records")
    print(f'  records: {new_cur.fetchone()[0]} 条')
    new_cur.execute("SELECT COUNT(*) FROM business_trip")
    print(f'  business_trip: {new_cur.fetchone()[0]} 条')
    new_cur.execute("SELECT MIN(datetime), MAX(datetime) FROM records")
    min_max = new_cur.fetchone()
    if min_max[0]:
        print(f'  records 时间范围: {min_max[0]} ~ {min_max[1]}')
    new_cur.execute("SELECT type, COUNT(*), SUM(amount) FROM records GROUP BY type")
    for row in new_cur.fetchall():
        print(f'  {row[0]}: {row[1]} 条, 合计 ¥{row[2]:.2f}')

    old_conn.close()
    new_conn.close()

    print()
    print(f'✅ 完成！数据库: {NEW_DB}')
    print(f'   查看: sqlite3 "{NEW_DB}" ".tables"')


if __name__ == '__main__':
    main()
