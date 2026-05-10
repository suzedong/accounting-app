#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
NocoBase → NocoBase 数据迁移脚本
将源 NocoBase 实例的数据迁移到目标 NocoBase 实例
仅使用标准库，无需额外安装依赖
"""

import json
import sys
import time
import urllib.request
import urllib.error
import urllib.parse

# ==================== 配置区 ====================
# 源 NocoBase API 地址
SOURCE_API_URL = "http://192.168.21.100:13000/api"
SOURCE_API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGVOYW1lIjoicm9vdCIsImlhdCI6MTc3Nzk2NDY0NiwiZXhwIjoxODA5NTAwNjQ2LCJqdGkiOiIyMzhkYjk1Mi1hOWU0LTRjZmUtODM2NC05MTQzMDRhMDMzYzIifQ.CsK-Tj2kkfGr0DSR6QgcobwFJvy64s4fAYn3hEMjHS4"

# 目标 NocoBase API 地址
TARGET_API_URL = "http://121.17.49.100:13000/api"
TARGET_API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGVOYW1lIjoicm9vdCIsImlhdCI6MTc3Nzk2NDY0NiwiZXhwIjoxODA5NTAwNjQ2LCJqdGkiOiIyMzhkYjk1Mi1hOWU0LTRjZmUtODM2NC05MTQzMDRhMDMzYzIifQ.CsK-Tj2kkfGr0DSR6QgcobwFJvy64s4fAYn3hEMjHS4"

# 请求间隔（秒）
REQUEST_DELAY = 0.1
# ================================================

# 需要迁移的 Collections
COLLECTIONS = [
    {"name": "records", "exclude": ["id", "created_at", "updated_at"]},
    {"name": "categories", "exclude": ["id"]},
    {"name": "accounts", "exclude": ["id"]},
    {"name": "payment_methods", "exclude": ["id"]},
    {"name": "budgets", "exclude": ["id", "created_at"]},
    {"name": "business_trip", "exclude": ["id", "synced_at"], "date_fields": ["start_date", "end_date", "paid_date"]},
]


def get_headers(token):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def api_get(api_url, token, path, params=None):
    """发送 GET 请求"""
    url = f"{api_url}{path}"
    if params:
        qs = urllib.parse.urlencode(params)
        url += ("&" if "?" in url else "?") + qs

    req = urllib.request.Request(url, headers=get_headers(token), method="GET")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def api_post(api_url, token, path, data):
    """发送 POST 请求"""
    url = f"{api_url}{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode("utf-8"),
        headers=get_headers(token),
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_all(api_url, token, collection):
    """从源 NocoBase 获取所有记录"""
    all_records = []
    page = 1
    page_size = 100

    while True:
        data = api_get(api_url, token, f"/{collection}", {"page": page, "pageSize": page_size})
        records = data.get("data", [])
        all_records.extend(records)

        if len(records) < page_size:
            break
        page += 1

    return all_records


def check_connection(api_url, token, name):
    """检查 NocoBase 连接"""
    try:
        api_get(api_url, token, "/collections")
        print(f"✅ {name} 连接成功: {api_url}")
        return True
    except Exception as e:
        print(f"❌ {name} 连接失败: {e}")
        return False


def migrate_collection(source_url, source_token, target_url, target_token, config):
    """迁移单个 Collection"""
    name = config["name"]
    exclude = config.get("exclude", [])
    date_fields = config.get("date_fields", [])

    print(f"\n📦 迁移 {name}...")

    records = fetch_all(source_url, source_token, name)
    total = len(records)

    if total == 0:
        print(f"  ⏭️  {name}: 空表，跳过")
        return 0

    print(f"  找到 {total} 条记录")

    success = 0
    for i, record in enumerate(records):
        # 过滤字段
        data = {}
        for key, val in record.items():
            if key not in exclude and val is not None:
                data[key] = val

        # 日期字段规范化
        for field in date_fields:
            if field in data and isinstance(data[field], str) and ' ' in data[field]:
                data[field] = data[field].split(' ')[0]

        try:
            api_post(target_url, target_token, f"/{name}", data)
            success += 1
        except Exception as e:
            print(f"    ⚠️  第 {i+1} 条失败: {e}")

        if (i + 1) % 50 == 0:
            print(f"    ... 已迁移 {i+1}/{total}")

        time.sleep(REQUEST_DELAY)

    print(f"  ✅ {name}: 成功 {success}/{total}")
    return success


def main():
    print("=" * 60)
    print("🔄 NocoBase → NocoBase 数据迁移")
    print("=" * 60)

    # 1. 检查连接
    print("\n1️⃣ 检查连接...")
    if not check_connection(SOURCE_API_URL, SOURCE_API_TOKEN, "源 NocoBase"):
        sys.exit(1)
    if not check_connection(TARGET_API_URL, TARGET_API_TOKEN, "目标 NocoBase"):
        sys.exit(1)

    # 2. 迁移各表
    print("\n2️⃣ 开始迁移...")
    total_migrated = 0

    for config in COLLECTIONS:
        total_migrated += migrate_collection(
            SOURCE_API_URL, SOURCE_API_TOKEN,
            TARGET_API_URL, TARGET_API_TOKEN,
            config
        )

    # 3. 完成
    print(f"\n{'=' * 60}")
    print(f"✅ 迁移完成！共迁移 {total_migrated} 条记录")
    print(f"{'=' * 60}")
    print("\n⚠️  注意:")
    print("  - 请在目标 NocoBase 后台确认数据完整性")
    print("  - 建议手动核对记录数量是否正确")


if __name__ == "__main__":
    main()
