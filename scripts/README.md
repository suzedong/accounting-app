# scripts/ · 数据脚本目录

一次性的数据迁移/维护脚本存放于此。业务运行时代码不会依赖本目录。

## 当前脚本

| 目录 / 文件 | 用途 | 状态 |
|---|---|---|
| [`migrate-to-turso/`](./migrate-to-turso/README.md) | 一次性把本地 `app_data.db` 搬到 Turso 云端 libSQL（`--dry-run` / `--drop` / `--verify`） | ✅ 可用 |

历史归档脚本已按 [AGENTS.md §4.3](../AGENTS.md#43-脚本与数据处理) 规范清理：

- `cleanup-nocobase-legacy/` — 2026-07-09 执行完成后目录已删除。如需从零复现或回滚，可通过 git 历史找回（提交描述里包含 "cleanup nocobase legacy"）
- `check_fields.py` / `normalize_all_time_fields.sql` / `fix_local_updated_at.sql` — NocoBase 时代的一次性维护脚本，已废弃并删除

## 数据库路径速查

`db/connection.rs::db_path()` / `replica_db_path()` 决定实际路径：

| 场景 | macOS | Windows |
|---|---|---|
| 开发模式 · 本地库 | `<项目根>/database/app_data.db` | `<项目根>\database\app_data.db` |
| 开发模式 · Turso replica | `<项目根>/database/app_data_sync.db` | `<项目根>\database\app_data_sync.db` |
| 生产模式 · 本地库 | `~/Library/Application Support/accounting-app/app_data.db` | `%APPDATA%\accounting-app\app_data.db` |
| 生产模式 · Turso replica | `~/Library/Application Support/accounting-app/app_data_sync.db` | `%APPDATA%\accounting-app\app_data_sync.db` |

**关键区别**：`app_data.db` 是纯本地模式使用的独立库；启用 Turso 后应用改用 `app_data_sync.db`（Embedded Replica，libsql 内部管理，含 `.info` / `-wal` / `-shm` 等 sidecar 文件）。两者互不干扰。

## 手动查 SQLite

```bash
# 本地
sqlite3 database/app_data.db "SELECT COUNT(*) FROM records"

# Turso 云端（需先 turso auth login）
turso db shell accounting-app "SELECT COUNT(*) FROM records"
```

## 相关文档

- [scripts/migrate-to-turso/README.md](./migrate-to-turso/README.md) — 迁移脚本用法与 `app_config` 白名单说明
- [CODE_WIKI.md §9](../CODE_WIKI.md#9-turso-同步机制) - Turso 同步机制
- [AGENTS.md §4.2 / §4.3](../AGENTS.md#42-turso-同步) - Turso 与脚本相关的硬性约束
