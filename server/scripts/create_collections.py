#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
在目标 NocoBase 创建记账相关的 collections
"""

import json
import sys
import urllib.request
import urllib.error

# ==================== 配置区 ====================
TARGET_API_URL = "http://121.17.49.100:13000/api"
TARGET_API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGVOYW1lIjoicm9vdCIsImlhdCI6MTc3Nzk2NDY0NiwiZXhwIjoxODA5NTAwNjQ2LCJqdGkiOiIyMzhkYjk1Mi1hOWU0LTRjZmUtODM2NC05MTQzMDRhMDMzYzIifQ.CsK-Tj2kkfGr0DSR6QgcobwFJvy64s4fAYn3hEMjHS4"
# ================================================

COLLECTIONS_SCHEMA = [
    {
        "name": "records",
        "title": "记账记录",
        "fields": [
            {"name": "datetime", "type": "datetime", "title": "时间", "interface": "datetime"},
            {"name": "type", "type": "string", "title": "类型", "interface": "select", "uiSchema": {"enum": [{"value": "收入", "label": "收入"}, {"value": "支出", "label": "支出"}]}},
            {"name": "category", "type": "string", "title": "分类", "interface": "input"},
            {"name": "amount", "type": "float", "title": "金额", "interface": "number"},
            {"name": "account", "type": "string", "title": "账户", "interface": "input"},
            {"name": "note", "type": "text", "title": "备注", "interface": "textarea"},
            {"name": "payment_method", "type": "string", "title": "支付方式", "interface": "input"},
        ]
    },
    {
        "name": "categories",
        "title": "分类",
        "fields": [
            {"name": "name", "type": "string", "title": "名称", "interface": "input", "unique": True},
            {"name": "type", "type": "string", "title": "类型", "interface": "select", "uiSchema": {"enum": [{"value": "收入", "label": "收入"}, {"value": "支出", "label": "支出"}]}},
            {"name": "icon", "type": "string", "title": "图标", "interface": "input"},
            {"name": "color", "type": "string", "title": "颜色", "interface": "input"},
            {"name": "sort", "type": "integer", "title": "排序", "interface": "number"},
        ]
    },
    {
        "name": "accounts",
        "title": "账户",
        "fields": [
            {"name": "name", "type": "string", "title": "名称", "interface": "input", "unique": True},
            {"name": "type", "type": "string", "title": "类型", "interface": "input"},
            {"name": "balance", "type": "float", "title": "余额", "interface": "number"},
            {"name": "icon", "type": "string", "title": "图标", "interface": "input"},
            {"name": "color", "type": "string", "title": "颜色", "interface": "input"},
        ]
    },
    {
        "name": "payment_methods",
        "title": "支付方式",
        "fields": [
            {"name": "name", "type": "string", "title": "名称", "interface": "input", "unique": True},
            {"name": "icon", "type": "string", "title": "图标", "interface": "input"},
            {"name": "color", "type": "string", "title": "颜色", "interface": "input"},
            {"name": "sort", "type": "integer", "title": "排序", "interface": "number"},
        ]
    },
    {
        "name": "budgets",
        "title": "预算",
        "fields": [
            {"name": "category", "type": "string", "title": "分类", "interface": "input"},
            {"name": "amount", "type": "float", "title": "预算金额", "interface": "number"},
            {"name": "period", "type": "string", "title": "周期", "interface": "select", "uiSchema": {"enum": [{"value": "monthly", "label": "月度"}, {"value": "yearly", "label": "年度"}]}},
            {"name": "year", "type": "integer", "title": "年份", "interface": "number"},
            {"name": "month", "type": "integer", "title": "月份", "interface": "number"},
        ]
    },
    {
        "name": "business_trip",
        "title": "差旅补助",
        "fields": [
            {"name": "employee_name", "type": "string", "title": "姓名", "interface": "input"},
            {"name": "employee_id", "type": "string", "title": "工号", "interface": "input"},
            {"name": "department", "type": "string", "title": "部门", "interface": "input"},
            {"name": "start_date", "type": "date", "title": "开始日期", "interface": "date"},
            {"name": "end_date", "type": "date", "title": "结束日期", "interface": "date"},
            {"name": "destination", "type": "string", "title": "目的地", "interface": "input"},
            {"name": "days", "type": "float", "title": "天数", "interface": "number"},
            {"name": "daily_allowance", "type": "float", "title": "日补助标准", "interface": "number"},
            {"name": "total_allowance", "type": "float", "title": "补助总额", "interface": "number"},
            {"name": "status", "type": "string", "title": "状态", "interface": "select", "uiSchema": {"enum": [{"value": "pending", "label": "待审批"}, {"value": "approved", "label": "已审批"}, {"value": "paid", "label": "已发放"}]}},
            {"name": "paid_date", "type": "date", "title": "发放日期", "interface": "date"},
            {"name": "note", "type": "text", "title": "备注", "interface": "textarea"},
        ]
    },
]


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


def check_collection_exists(api_url, token, name):
    try:
        data = api_post(api_url, token, "/collections:list", {"filter": {"name": name}})
        return len(data.get("data", [])) > 0
    except:
        return False


def create_collection(api_url, token, schema):
    name = schema["name"]
    title = schema["title"]
    fields = schema["fields"]

    print(f"\n📦 创建 collection: {name} ({title})")

    # 1. 创建 collection
    try:
        api_post(api_url, token, "/collections", {
            "name": name,
            "title": title,
            "autoGenId": True,
            "createdBy": True,
            "updatedBy": True,
            "logging": True,
        })
        print(f"  ✅ Collection 创建成功")
    except Exception as e:
        if "already exists" in str(e) or "duplicate" in str(e).lower():
            print(f"  ⏭️  Collection 已存在，跳过")
        else:
            print(f"  ❌ 创建失败: {e}")
            return

    # 2. 创建 fields
    for field in fields:
        field_name = field["name"]
        field_type = field["type"]
        field_title = field["title"]
        interface = field.get("interface", "input")

        field_data = {
            "name": field_name,
            "type": field_type,
            "interface": interface,
            "uiSchema": {"title": field_title},
        }

        # 添加额外属性
        if "unique" in field and field["unique"]:
            field_data["unique"] = True
        if "uiSchema" in field:
            field_data["uiSchema"].update(field["uiSchema"])

        try:
            api_post(api_url, token, f"/collections/{name}/fields", field_data)
            print(f"  ✅ Field: {field_name} ({field_title})")
        except Exception as e:
            if "already exists" in str(e) or "duplicate" in str(e).lower():
                print(f"  ⏭️  Field {field_name} 已存在")
            else:
                print(f"  ⚠️  Field {field_name} 创建失败: {e}")


def main():
    print("=" * 60)
    print("📋 在目标 NocoBase 创建 Collections")
    print("=" * 60)

    for schema in COLLECTIONS_SCHEMA:
        create_collection(TARGET_API_URL, TARGET_API_TOKEN, schema)

    print(f"\n{'=' * 60}")
    print("✅ Collections 创建完成！")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
