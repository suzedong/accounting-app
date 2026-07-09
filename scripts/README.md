# 数据库脚本说明

本目录包含用于数据库维护和数据迁移的脚本。

> **当前主流方向**：应用后端已从 rusqlite 切换到 libSQL 0.9，同步方案从 NocoBase 迁移到 Turso Embedded Replica。若需要把本地 `app_data.db` 搬到 Turso 云端，请直接使用 [`migrate-to-turso/`](./migrate-to-turso/)。
>
> 本目录下的 `check_fields.py` 与部分 SQL 脚本仍保留作为 **历史归档**，仅在需要修复历史遗留数据时才用。NocoBase 相关命令、API 与前端 UI 均已从代码库中移除。

## 📋 脚本列表

| 脚本文件 | 用途 | 状态 |
|---------|------|------|
| [`migrate-to-turso/`](./migrate-to-turso/) | 本地 SQLite → Turso 云端一次性迁移（better-sqlite3 + @libsql/client，支持 `--dry-run / --drop / --verify`） | ✅ 主流方向 |
| [`cleanup-nocobase-legacy/`](./cleanup-nocobase-legacy/) | 一次性删除 NocoBase 遗留列（6 列）与 `sync_log` 表，同时清理本地与 Turso 云端 | 🛠️ 一次性维护脚本（2026-07-09 已执行） |
| `normalize_all_time_fields.sql` | 规范化所有时间字段 | 🗄️ 历史归档 |
| `fix_local_updated_at.sql` | 回填 `local_updated_at` 字段 | 🗄️ 历史归档 |
| `check_fields.py` | 检查 NocoBase 集合字段结构（NocoBase 同步已废弃） | ⛔ 已废弃 |

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

**状态**：⛔ 已废弃。NocoBase 同步已于 2026-07-09 从项目中整体移除（阶段 4.6），此脚本仅作为历史归档保留。

**用途（历史）**：检查 NocoBase 集合的字段结构

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
- [libSQL 项目](https://github.com/tursodatabase/libsql)
- [Turso 文档](https://docs.turso.tech/)
- 项目主目录：`/Users/szd/Documents/Code/accounting-app`

---

## 📅 更新记录

| 日期 | 更新内容 |
|------|---------|
| 2026-07-09 | 新增 `cleanup-nocobase-legacy/` 一次性清理脚本；NocoBase 同步废弃，标记 `check_fields.py` 为已废弃；`migrate-to-turso/` 明确为主流方向 |
| 2026-06-15 | 创建脚本目录，规范化所有脚本格式，添加跨平台支持 |