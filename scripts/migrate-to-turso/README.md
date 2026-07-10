# 本地 SQLite → Turso 迁移脚本（一次性）

> 用途：把本地 `app_data.db` 里的历史数据一次性搬到 Turso 云端 libSQL。适合场景：
>
> 1. **首次启用 Turso 同步**：本地已经积累了很多记账数据，想把它作为云端"初始快照"
> 2. **换云端 database**：`turso db destroy` 老库 + `turso db create` 新库后，重新灌历史数据
> 3. **从其他设备"冷迁入"**：另一台电脑的 `app_data.db` 拷过来搬到 Turso

**不适用**：新设备想拉云端已有数据 —— 那不需要这个脚本，只要在应用里配 URL/Token + 打开开关 + 重启，`db.sync()` 自动拉全量。

---

## 前置准备

### 1. Node 环境

需要 Node 18+。macOS 用 Homebrew，Windows 用 [Node 官网](https://nodejs.org/) 安装包或 `winget install OpenJS.NodeJS`。

### 2. 安装 Turso CLI 并注册账号

- macOS：`brew install tursodatabase/tap/turso`
- Windows / Linux：见 https://docs.turso.tech/cli/installation

```bash
turso auth signup                        # 会弹浏览器
turso db create accounting-app           # 建库；免费计划落在默认区域
turso db show accounting-app --url       # 记下 libsql:// URL
turso db tokens create accounting-app    # 记下 auth token（JWT，只显示一次）
```

免费额度：500 数据库、9 GB 存储、每月 10 亿行读、100 万行写。个人记账绰绰有余。

### 3. 安装脚本依赖

```bash
cd scripts/migrate-to-turso
npm install
```

---

## 找到本地数据库路径

本项目实际的 SQLite 文件位置见 [`db/connection.rs::db_path()`](../../src-tauri/src/db/connection.rs)：

| 场景 | macOS | Windows |
|---|---|---|
| **开发模式**（`npm run tauri dev`） | `<项目根>/database/app_data.db` | `<项目根>\database\app_data.db` |
| **生产模式**（安装包运行） | `~/Library/Application Support/accounting-app/app_data.db` | `%APPDATA%\accounting-app\app_data.db` |

> ⚠️ **启用 Turso 后本地还会多一个 `app_data_sync.db`**（Turso Embedded Replica 用的独立副本）。这个文件**不要**作为脚本的 `--source`，那是 replica 缓存，跟云端已经是同步状态；只有 `app_data.db`（纯本地模式那份）才有独立数据。
>
> 如果你日常都在开发模式跑，`~/Library/Application Support/...` 下的库可能只是很久以前的旧数据，别搞错。用 `ls -lh` 对比两个文件大小/修改时间即可判断。

---

## 运行

**推荐流程：先干跑预演 → 正式迁移 → 加 `--verify` 校验。**

### 1. 只读预演（不写云端）

```bash
node migrate.mjs \
  --source /Users/szd/Documents/Code/accounting-app/database/app_data.db \
  --dry-run
```

会看到类似输出：

```
--- 本地行数快照 ---
  records              本地共    871 行
  business_trip        本地共     39 行
  learning_data        本地共      0 行
  system_prompts       本地共      2 行
  chat_history         本地共     40 行
  app_config           本地共      5 行，将迁移 2 行
```

`app_config` 里 "将迁移 X 行" 说明白名单过滤器只挑**共享性质**的业务 key，不迁移敏感/平台/环境相关 key。**详见下方"迁移策略"章节**。

### 2. 正式迁移

```bash
node migrate.mjs \
  --source /Users/szd/Documents/Code/accounting-app/database/app_data.db \
  --url "libsql://xxx-yourname.turso.io" \
  --token "eyJhbGciOi..." \
  --verify
```

首次 Turso 表为空，全部数据会被写入。第二次跑同一命令时，`INSERT OR IGNORE` 会按 `uuid`（或 `key/name`）跳过已存在的行 —— **幂等，可以放心多跑**。

### 3. 想推倒重来

```bash
node migrate.mjs \
  --source ... --url ... --token ... \
  --drop --verify
```

`--drop` 会先 `DROP TABLE` 云端已有表再重建；**会丢云端已有数据，慎用**。等价的另一种"清空云端"方式是 `turso db destroy accounting-app --yes` 然后重新 `turso db create`。

---

## 迁移策略

| 表 | 是否迁 | 备注 |
|---|---|---|
| `records` | ✅ | NocoBase 遗留列已从 schema 中删除，只写业务字段 |
| `business_trip` | ✅ | 同上 |
| `learning_data` | ✅ | 同上 |
| `system_prompts` | ✅ | 全字段保留 |
| `chat_history` | ✅ | 全字段保留 |
| `app_config` | ⚠️ 白名单 | 见下表 |

### `app_config` 迁移白名单

`app_config` 里的 key 属性千差万别，一律迁会导致敏感数据泄露 / 设备互相覆盖，所以采用**显式白名单**：

| Key | 迁 | 原因 |
|---|---|---|
| `budget_monthly` | ✅ | 用户偏好，两端一致 |
| `ai_services` | ✅ | 用户配置的 LLM 端点（**含 API Key**，可接受同步风险则勾选） |
| `active_ai_service` | ✅ | 当前使用的 LLM ID |
| `ocr_enabled` | ✅ | OCR 开关 |
| `force_confirm_corrections` | ✅ | 交互偏好 |
| `last_confirmed_ttl_minutes` | ✅ | 交互偏好 |
| `turso_sync_enabled` | ❌ | **同步开关本身不迁**，避免在新设备上"自动被开启" |
| `turso_url` / `turso_token` | ❌ | 连接凭证本地填即可，云端存了没意义 |
| `active_python_path_macos` | ❌ | **平台相关**，Windows 上无用；两端各自维护 |
| `active_python_path_windows` | ❌ | 同上 |
| `active_python_path_linux` | ❌ | 同上 |
| 旧 `active_python_path`（无后缀） | ❌ | 已废弃，`AppConfig::new()` 启动时自动迁移到平台后缀 key |

`sync_log` 表已从 schema 中删除（2026-07-09 NocoBase 清理任务），不涉及迁移。

云端表结构详见 [schema.sql](./schema.sql)。

---

## 验证

`--verify` 会自动做：

1. **每表行数对比**：云端行数 ≥ 本地待迁行数为通过（因为云端可能已经有其他设备写入的数据）
2. **records / business_trip 抽样**：打印本地和云端各自最近 3 条，肉眼对比 uuid / amount / note / datetime

也可以手动查：

```bash
turso db shell accounting-app "SELECT COUNT(*) FROM records"
turso db shell accounting-app "SELECT id, datetime, amount, note FROM records ORDER BY id DESC LIMIT 5"
turso db shell accounting-app "SELECT trip_id, start_date, end_date, days, total FROM business_trip ORDER BY id DESC LIMIT 3"
```

---

## 回退方案

- **云端有问题** → 直接 `turso db destroy accounting-app --yes` 干掉重建即可；本地库无损，随时可以重跑迁移
- **本地库有问题** → 脚本用 `readonly: true` 打开本地，物理上无法写坏；如果不放心，跑前手动 `cp app_data.db app_data.db.bak` 备份

---

## 常见问题

**Q: 云端 records 表已经有几条数据，我又跑了一次，会重复吗？**

不会。`INSERT OR IGNORE` 按 `uuid` 唯一约束跳过已存在的行。终端会显示 "读 X 行 → 写入 Y 行，跳过 X-Y"。

**Q: 我在两台电脑上各自的 `app_data.db` 都有数据，怎么合并？**

分别跑一次这个脚本即可。两端的 `uuid` 通常不重叠，两次迁移会各写各的；如果偶发重叠，会跳过后写入的。之后两台电脑打开应用启用同步，两端会各自 `db.sync()` 拉云端的合并结果到本地。

**Q: 我已经启用 Turso 一段时间了，现在想在新电脑上安装应用，需要跑这个脚本吗？**

**不需要**。新电脑上：

1. 装应用、进入 Settings → 数据同步
2. 填 `turso_url` + `turso_token`
3. 打开 "启用同步" → 重启应用
4. `Database::new_with_turso()` 会打开 Embedded Replica；主界面挂载后 3s 内静默同步，把云端数据拉到本地 `app_data_sync.db`

只有当**本地已经积攒了很多数据、想推到云端**时才用这个脚本。

**Q: 迁移过程中断了怎么办？**

`INSERT OR IGNORE` 幂等，直接重跑即可，已写入的行会自动跳过。
