#!/usr/bin/env python3
"""
NocoBase 字段检查工具
用途：检查 NocoBase 集合的字段结构
跨平台：支持 macOS/Linux/Windows
"""

import json
import urllib.request
import urllib.error
from typing import Dict, List, Optional

# ============================================================================
# 配置
# ============================================================================
# NocoBase API 配置
BASE_URL = "http://121.17.49.100:13000"
TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInJvbGVOYW1lIjoiYWRtaW4iLCJpYXQiOjE3Nzg0MjM2MDUsImV4cCI6MzMzMzYwMjM2MDV9.3fK74khicVBCHBMNp1amZ-sE2ivPVvM86vx81CxoA0M"

# 要检查的集合
COLLECTIONS = ["records", "business_trip", "learning_data"]

# ============================================================================
# 工具函数
# ============================================================================
def get(url: str) -> Optional[Dict]:
    """发送 GET 请求并返回 JSON 响应"""
    try:
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {TOKEN}")
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read())
    except urllib.error.URLError as e:
        print(f"  网络错误: {e}")
        return None
    except json.JSONDecodeError as e:
        print(f"  JSON 解析错误: {e}")
        return None
    except Exception as e:
        print(f"  未知错误: {e}")
        return None

def check_collection(collection: str) -> None:
    """检查单个集合的字段"""
    url = f"{BASE_URL}/api/{collection}:list?page=1&pageSize=1"
    print(f"\n{collection}:")
    print(f"  URL: {url}")

    data = get(url)
    if data is None:
        print("  状态: 请求失败")
        return

    if data.get("data") and len(data["data"]) > 0:
        fields = sorted(data["data"][0].keys())
        print(f"  状态: 有数据")
        print(f"  字段数: {len(fields)}")
        print(f"  字段列表:")
        for field in fields:
            print(f"    - {field}")
    else:
        print("  状态: 无数据")

# ============================================================================
# 主程序
# ============================================================================
def main():
    """主程序"""
    print("=" * 60)
    print("NocoBase 字段检查工具")
    print("=" * 60)
    print(f"服务器: {BASE_URL}")
    print(f"集合数: {len(COLLECTIONS)}")

    for collection in COLLECTIONS:
        check_collection(collection)

    print("\n" + "=" * 60)
    print("检查完成")
    print("=" * 60)

if __name__ == "__main__":
    main()