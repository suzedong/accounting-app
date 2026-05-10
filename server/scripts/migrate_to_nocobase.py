#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SQLite → NocoBase 数据迁移脚本
将 accounting.db 中的所有数据迁移到 NocoBase 对应的 Collections 中
"""

import sqlite3
import json
import sys
import time
from pathlib import Path

# ==================== 配置区 ====================
# NocoBase API 地址（末尾不要加斜杠）
NOCOBASE_API_URL = "http://192.168.21.100:13000/api"
# API Token（在 NocoBase 后台 → 设置 → API keys 中生成）
NOCOBASE_API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGVOYW1lIjoicm9vdCIsImlhdCI6MTc3Nzk2NDY0NiwiZXhwIjoxODA5NTAwNjQ2LCJqdGkiOiIyMzhkYjk1Mi1hOWU0LTRjZmUtODM2NC05MTQzMDRhMDMzYzIifQ.CsK-Tj2kkfGr0DSR6QgcobwFJvy64s4fAYn3hEMjHS4"
# 批量写入时每批大小
BATCH_SIZE = 50
# 请求间隔（秒），避免压垮 NocoBase
REQUEST_DELAY = 0.1
# ================================================

# 数据库路径（自动检测本地或 NAS）
import os
if os.path.exists('/vol1/1000/Code/accounting-app'):
    DB_PATH = Path('/vol1/1000/Code/accounting-app/database/accounting.db')
else:
    DB_PATH = Path(__file__).parent.parent / "database" / "accounting.db"

try:
    import requests
except ImportError:
    print("❌ 缺少 requests 库，请先安装: pip3 install requests")
    sys.exit(1)


def get_headers():
    headers = {"Content-Type": "application/json"}
    if NOCOBASE_API_TOKEN:
        headers["Authorization"] = f"Bearer {NOCOBASE_API_TOKEN}"
    return headers


def nocobase_create(collection, data):
    """单条创建记录"""
    url = f"{NOCOBASE_API_URL}/{collection}"
    resp = requests.post(url, json=data, headers=get_headers(), timeout=30)
    if resp.status_code not in (200, 201):
        raise Exception(f"创建失败 ({resp.status_code}): {resp.text}")
    return resp.json()


def check_connection():
    """检查 NocoBase 连接"""
    try:
        resp = requests.get(f"{NOCOBASE_API_URL}/collections", headers=get_headers(), timeout=10)
        if resp.status_code == 200:
            print(f"✅ NocoBase 连接成功: {NOCOBASE_API_URL}")
            return True
        else:
            print(f"❌ NocoBase 连接失败 ({resp.status_code}): {resp.text}")
            return False
    except requests.ConnectionError:
        print(f"❌ 无法连接到 NocoBase: {NOCOBASE_API_URL}")
        print("   请检查地址是否正确、NocoBase 是否运行中")
        return False


def migrate_table(cursor, conn_sqlite, collection_name, table_name, exclude_fields=None, date_fields=None):
    """迁移单个表"""
    exclude_fields = exclude_fields or []
    date_fields = date_fields or []

    cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
    total = cursor.fetchone()[0]

    if total == 0:
        print(f"  ⏭️  {table_name}: 空表，跳过")
        return 0

    print(f"  📦 {table_name}: {total} 条记录 → {collection_name}")

    # 获取所有列名（不在此处排除，后续在 zip 后过滤）
    cursor.execute(f"PRAGMA table_info({table_name})")
    all_columns = [row[1] for row in cursor.fetchall()]

    cursor.execute(f"SELECT * FROM {table_name}")
    rows = cursor.fetchall()

    success = 0
    for i, row in enumerate(rows):
        # 正确做法：先 zip 所有列和值，再按列名过滤
        data = {}
        for col, val in zip(all_columns, row):
            if col not in exclude_fields and val is not None:
                data[col] = val

        # 日期字段规范化（datetime → date）
        for field in date_fields:
            if field in data and isinstance(data[field], str) and ' ' in data[field]:
                data[field] = data[field].split(' ')[0]

        try:
            nocobase_create(collection_name, data)
            success += 1
        except Exception as e:
            print(f"    ⚠️  第 {i+1} 条失败: {e}")

        if (i + 1) % 50 == 0:
            print(f"    ... 已迁移 {i+1}/{total}")

        time.sleep(REQUEST_DELAY)

    print(f"  ✅ {table_name}: 成功 {success}/{total}")
    return success


def main():
    print("=" * 60)
    print("🔄 SQLite → NocoBase 数据迁移")
    print("=" * 60)

    # 1. 检查连接
    print("\n1️⃣ 检查 NocoBase 连接...")
    if not check_connection():
        sys.exit(1)

    # 2. 连接 SQLite
    print(f"\n2️⃣ 连接 SQLite: {DB_PATH}")
    if not DB_PATH.exists():
        print(f"❌ 数据库文件不存在: {DB_PATH}")
        sys.exit(1)

    conn_sqlite = sqlite3.connect(DB_PATH)
    cursor = conn_sqlite.cursor()

    # 3. 迁移各表
    print("\n3️⃣ 开始迁移...")

    total_migrated = 0

    # records 表
    total_migrated += migrate_table(
        cursor, conn_sqlite,
        "records", "records",
        exclude_fields=["id", "created_at", "updated_at"]
    )

    # categories 表
    total_migrated += migrate_table(
        cursor, conn_sqlite,
        "categories", "categories",
        exclude_fields=["id"]
    )

    # accounts 表
    total_migrated += migrate_table(
        cursor, conn_sqlite,
        "accounts", "accounts",
        exclude_fields=["id"]
    )

    # payment_methods 表
    total_migrated += migrate_table(
        cursor, conn_sqlite,
        "payment_methods", "payment_methods",
        exclude_fields=["id"]
    )

    # budgets 表
    total_migrated += migrate_table(
        cursor, conn_sqlite,
        "budgets", "budgets",
        exclude_fields=["id", "created_at"]
    )

    # business_trip 表
    total_migrated += migrate_table(
        cursor, conn_sqlite,
        "business_trip", "business_trip",
        exclude_fields=["id", "synced_at"],
        date_fields=["start_date", "end_date", "paid_date"]
    )

    conn_sqlite.close()

    # 4. 完成
    print(f"\n{'=' * 60}")
    print(f"✅ 迁移完成！共迁移 {total_migrated} 条记录")
    print(f"{'=' * 60}")
    print("\n⚠️  注意:")
    print("  - 请在 NocoBase 后台确认数据完整性")
    print("  - 建议手动核对记录数量是否正确")


if __name__ == "__main__":
    main()
