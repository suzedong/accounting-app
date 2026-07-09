# 数据库脚本说明

本目录包含用于数据库维护和数据迁移的脚本。

## 📋 脚本列表

| 脚本文件 | 用途 | 适用场景 |
|---------|------|---------|
| `normalize_all_time_fields.sql` | 规范化所有时间字段 | 开发阶段修复历史数据 |
| `check_fields.py` | 检查 NocoBase 集合的字段结构 | 开发调试 |
| [`migrate-to-turso/`](./migrate-to-turso/) | 本地 SQLite → Turso 云端迁移 | 阶段 1：切换同步后端到 Turso 前的数据搬运 |

---

## 🚀 使用方法

### 1. 数据库路径

| 环境 | 数据库路径 |
|------|-----------|
| **macOS/Linux (生产)** | `~/Library/Application Support/accounting-app/app_data.db` |
| **Windows (生产)** | `%APPDATA%\accounting-app\app_data.db` |
| **开发环境** | `database/app_data.db` |

### 运行 SQL 脚本

#### macOS/Linux

```bash
# 生产环境
sqlite3 ~/Library/Application\ Support/accounting-app/app_data.db < normalize_all_time_fields.sql

# 开发环境
sqlite3 database/app_data.db < normalize_all_time_fields.sql
```

#### Windows (PowerShell)

```powershell
# 生产环境
sqlite3 "%APPDATA%\accounting-app\app_data.db" < normalize_all_time_fields.sql

# 开发环境
sqlite3 database\app_data.db < normalize_all_time_fields.sql
```

#### Windows (CMD)

```cmd
REM 生产环境
sqlite3 "%APPDATA%\accounting-app\app_data.db" < normalize_all_time_fields.sql

REM 开发环境
sqlite3 database\app_data.db < normalize_all_time_fields.sql
```

### 3. 运行 Python 脚本

```bash
# macOS/Linux/Windows
python3 scripts/check_fields.py
```

---

## ⚠️ 注意事项

1. **运行前备份数据库**
   ```bash
   # macOS/Linux
   cp ~/Library/Application\ Support/accounting-app/app_data.db ~/Library/Application\ Support/accounting-app/app_data.db.backup

   # Windows
   copy "%APPDATA%\accounting-app\app_data.db" "%APPDATA%\accounting-app\app_data.db.backup"
   ```

2. **脚本适用性**
   - 这些脚本仅用于开发阶段修复历史数据
   - 生产环境新数据已按正确格式写入，不需要运行

3. **跨平台兼容性**
   - 所有 SQL 脚本使用标准 SQLite 语法，跨平台兼容
   - Python 脚本使用 `#!/usr/bin/env python3` shebang，跨平台兼容

---

## 📝 脚本详细说明

### normalize_all_time_fields.sql

**用途**：将所有时间字段统一为标准格式

**影响字段**：
- `records.datetime` → `YYYY-MM-DD HH:MM:SS` 本地时间
- `records.local_updated_at` → `YYYY-MM-DD HH:MM:SS` 本地时间
- `records.created_at` → `YYYY-MM-DD HH:MM:SS` 本地时间
- `business_trip.paid_date` → `YYYY-MM-DD` 纯日期
- `business_trip.created_at` → `YYYY-MM-DD HH:MM:SS` 本地时间
- `learning_data.created_at` → `YYYY-MM-DD HH:MM:SS` 本地时间
- `system_prompts.updated_at` → `YYYY-MM-DD HH:MM:SS` 本地时间
- `chat_history.created_at` → `YYYY-MM-DD HH:MM:SS` 本地时间
- `sync_log.created_at` → `YYYY-MM-DD HH:MM:SS` 本地时间

**转换规则**：
- `2026-06-14T09:30:00.000Z` → `2026-06-14 17:30:00` (UTC 转本地时间)
- `2026-06-14T17:30:00` → `2026-06-14 17:30:00` (假设是本地时间)
- `2026-06-14 17:30:00` → 保持不变
- `paid_date` 字段：提取前 10 个字符（`YYYY-MM-DD`）

---

### check_fields.py

**用途**：检查 NocoBase 集合的字段结构

**功能**：
- 列出指定集合的所有字段
- 显示字段数量
- 显示请求状态

**配置**：
- 修改脚本中的 `BASE_URL` 和 `TOKEN` 变量
- 修改 `COLLECTIONS` 列表指定要检查的集合

---

## 🔧 故障排查

### SQLite 命令未找到

**macOS**：
```bash
brew install sqlite3
```

**Windows**：
1. 下载 SQLite：https://www.sqlite.org/download.html
2. 解压并将 `sqlite3.exe` 添加到 PATH

### Python 脚本运行失败

**macOS/Linux**：
```bash
# 检查 Python 版本
python3 --version

# 安装依赖（如有需要）
pip3 install requests
```

**Windows**：
```powershell
# 检查 Python 版本
python --version

# 安装依赖（如有需要）
pip install requests
```

---

## 📚 相关文档

- [SQLite 官方文档](https://www.sqlite.org/docs.html)
- [NocoBase API 文档](https://docs-cn.nocobase.com/)
- 项目主目录：`/Users/szd/Documents/Code/accounting-app`

---

## 📅 更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-06-15 | 创建脚本目录，规范化所有脚本格式，添加跨平台支持 |