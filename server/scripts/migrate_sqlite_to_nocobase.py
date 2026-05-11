#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 SQLite 迁移 business_trip 数据到 NocoBase
"""

import sqlite3
import json
import urllib.request
import urllib.error
import time

import os
from pathlib import Path

# ==================== 配置区 ====================
DB_PATH = os.environ.get(
    'DB_PATH',
    str(Path(__file__).parent.parent / 'database' / 'accounting.db')
)
TARGET_API_URL = "http://121.17.49.100:13000/api"
TARGET_API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGVOYW1lIjoicm9vdCIsImlhdCI6MTc3Nzk2NDY0NiwiZXhwIjoxODA5NTAwNjQ2LCJqdGkiOiIyMzhkYjk1Mi1hOWU0LTRjZmUtODM2NC05MTQzMDRhMDMzYzIifQ.CsK-Tj2kkfGr0DSR6QgcobwFJvy64s4fAYn3hEMjHS4"
# ================================================

def get_headers(token):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers

def api_post(api_url, token, path, data):
    url = f"{api_url}{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers=get_headers(token),
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        raise Exception(f"HTTP {e.code}: {error_body[:200]}")

def api_patch(api_url, token, path, data):
    url = f"{api_url}{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers=get_headers(token),
        method="PATCH"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        raise Exception(f"HTTP {e.code}: {error_body[:200]}")

def main():
    print("=" * 60)
    print("🔄 SQLite → NocoBase business_trip 数据迁移")
    print("=" * 60)

    # 连接 SQLite
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # 获取所有差旅记录
    cursor.execute("SELECT * FROM business_trip ORDER BY start_date")
    rows = cursor.fetchall()
    total = len(rows)

    print(f"\n📦 找到 {total} 条差旅记录")

    success = 0
    failed = 0

    for i, row in enumerate(rows):
        trip_id = row['trip_id']
        
        # 构建数据
        data = {
            'trip_id': trip_id,
            'start_date': row['start_date'].replace(' ', 'T') if row['start_date'] else None,
            'end_date': row['end_date'].replace(' ', 'T') if row['end_date'] else None,
            'days': row['days'],
            'trip_allowance': row['trip_allowance'],
            'transport_allowance': row['transport_allowance'],
            'total': row['total'],
            'status': row['status'],
            'paid_date': row['paid_date'].replace(' ', 'T') if row['paid_date'] else None,
            'notes': row['notes'],
        }

        try:
            # 先尝试查找是否已存在
            resp = urllib.request.Request(
                f"{TARGET_API_URL}/business_trip?filter%5Btrip_id%5D={trip_id}",
                headers=get_headers(TARGET_API_TOKEN),
                method="GET"
            )
            with urllib.request.urlopen(resp, timeout=30) as r:
                existing = json.loads(r.read().decode("utf-8"))
            
            if existing.get('data') and len(existing['data']) > 0:
                # 更新
                existing_id = existing['data'][0]['id']
                api_patch(TARGET_API_URL, TARGET_API_TOKEN, f"/business_trip/{existing_id}", data)
                print(f"  ✏️  更新: {trip_id} (¥{row['total']})")
            else:
                # 创建
                api_post(TARGET_API_URL, TARGET_API_TOKEN, "/business_trip", data)
                print(f"  ➕ 新增: {trip_id} (¥{row['total']})")
            
            success += 1
        except Exception as e:
            print(f"  ❌ 失败: {trip_id} - {e}")
            failed += 1

        time.sleep(0.1)

    conn.close()

    print(f"\n{'=' * 60}")
    print(f"✅ 迁移完成！成功 {success}/{total}，失败 {failed}")
    print(f"{'=' * 60}")

if __name__ == "__main__":
    main()
