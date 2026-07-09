# 本地 SQLite → Turso 迁移脚本

> 阶段 1：只搬数据，不动应用代码。跑完这个脚本，Turso 上会有一份"干净版"（不含 NocoBase 遗留列）的历史数据；本地应用照旧使用 rusqlite 运行。后续阶段 2 再切换 Rust 侧驱动。

## 前置准备

### 1. Node 环境

需要 Node 18+。macOS 用 Homebrew，Windows 用 [Node 官网](https://nodejs.org/) 安装包或 `winget install OpenJS.NodeJS`。

### 2. 安装 Turso CLI 并注册账号

- macOS：`brew install tursodatabase/tap/turso`
- Windows / Linux：见 https://docs.turso.tech/cli/installation

```bash
turso auth signup                        # 会弹浏览器
turso db create accounting-app           # 建库；默认落在离你最近的 region
turso db show accounting-app --url       # 记下 libsql:// URL
turso db tokens create accounting-app    # 记下 auth token（JWT）
```

免费额度：500 数据库、9 GB 存储、每月 10 亿行读、100 万行写。个人记账绰绰有余。

### 3. 安装脚本依赖

```bash
cd scripts/migrate-to-turso
npm install
```

## 找到本地数据库路径

- **开发模式**（`npm run tauri dev` 日常调试）：`<项目根>/database/app_data.db`
  - 例：`/Users/szd/Documents/Code/accounting-app/database/app_data.db`
- **生产模式**（安装的桌面应用）：
  - macOS：`~/Library/Application\ Support/accounting-app/app_data.db`
  - Windows：`%APPDATA%\accounting-app\app_data.db`

> 注意：如果你日常都用 `npm run tauri dev`，那 **生产路径的库通常是很久之前的旧数据**，别迁错了。用 `ls -lh` 对比两个文件的大小和修改时间就能判断。

数据库路径的实现见 [db/connection.rs](../../src-tauri/src/db/connection.rs) 的 `db_path()` 函数。

## 运行

**推荐流程：先干跑一次预演，观察行数与过滤情况；确认后再正式迁移；最后加 `--verify` 校验。**

### 1. 只读预演（不写云端）

```bash
node migrate.mjs \
  --source "$HOME/Library/Application Support/com.accounting.app/data/accounting.db" \
  --dry-run
```

会看到类似输出：

```
--- 本地行数快照 ---
  records              本地共    128 行
  business_trip        本地共     14 行
  learning_data        本地共     42 行
  system_prompts       本地共      2 行
  chat_history         本地共    301 行
  app_config           本地共     11 行，将迁移 6 行
```

`app_config` 里"将迁移 X 行"说明白名单过滤器只挑业务 key，`nocobase_url / *_token` 都被剔除，符合预期。

### 2. 正式迁移（首次）

```bash
node migrate.mjs \
  --source "$HOME/Library/Application Support/com.accounting.app/data/accounting.db" \
  --url "libsql://xxx-yourname.turso.io" \
  --token "eyJhbGciOi..." \
  --verify
```

首次 Turso 表为空，全部数据会被写入。第二次跑同一命令时，`INSERT OR IGNORE` 会按 `uuid`（或 `key/name`）跳过已存在的行——**幂等，可以放心多跑**。

### 3. 想推倒重来

```bash
node migrate.mjs --source ... --url ... --token ... --drop --verify
```

`--drop` 会先 `DROP TABLE` 云端已有表再重建；**会丢云端已有数据，慎用**。

## 迁移策略

| 表 | 是否迁 | 备注 |
|---|---|---|
| records | ✅ | 剔除 `synced / retry_count / last_error / nocobase_id / nocobase_updated_at` |
| business_trip | ✅ | 同上 |
| learning_data | ✅ | 同上 |
| system_prompts | ✅ | 全字段保留 |
| chat_history | ✅ | 全字段保留 |
| app_config | ⚠️ | 只迁业务 key（`budget_monthly / ai_services / active_ai_service / ocr_enabled / force_confirm_corrections / last_confirmed_ttl_minutes`）；`nocobase_url / nocobase_token / turso_url / turso_token` 不迁 |
| sync_log | ❌ | NocoBase 遗物，云端无意义 |

云端表结构详见 [schema.sql](./schema.sql)。

## 验证

`--verify` 会自动做：

1. **每表行数对比**：云端行数 ≥ 本地待迁行数为通过（因为可能已有其他数据）
2. **records / business_trip 抽样**：打印本地和云端各自最近 3 条，肉眼对比 uuid / amount / note / datetime

也可以手动查：

```bash
turso db shell accounting-app "SELECT COUNT(*) FROM records"
turso db shell accounting-app "SELECT * FROM records ORDER BY id DESC LIMIT 5"
turso db shell accounting-app "SELECT * FROM business_trip ORDER BY id DESC LIMIT 3"
```

## 回退方案

- 云端有问题 → 直接 `turso db destroy accounting-app --yes` 干掉重建即可；本地库无损，随时可以重跑迁移
- 本地库有问题 → 脚本用 `readonly: true` 打开，物理上无法写坏；如果不放心，跑前手动 cp 一份备份

## 常见问题

**Q: 云端 records 表已经有几条数据，我又跑了一次，会重复吗？**

不会。`INSERT OR IGNORE` 按 `uuid` 唯一约束跳过已存在的行。终端会显示"读 X 行 → 写入 Y 行，跳过 X-Y"。

**Q: chat_history 会不会太大导致 Turso 免费额度撑不住？**

不会。免费额度是每月 10 亿行读；即使把 1 万条 chat_history 都写上去也远远用不完。

**Q: 我在两台电脑上各自的 accounting.db 都有数据，怎么合并？**

分别跑一次这个脚本即可。两端的 uuid 通常不重叠，两次迁移会各写各的；如果偶发重叠（比如都手动加过同一条记录），会跳过后写入的。

**Q: 阶段 2 什么时候开始？**

等你在这里验证过数据完整后，我们再启动阶段 2：把 Rust 侧从 rusqlite 换成 libsql、删除 NocoBase 代码、Settings 加 Turso 配置面板。
