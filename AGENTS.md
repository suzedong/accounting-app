# AGENTS.md - Accounting-App 开发规范

> 本文档是 Accounting-App 项目的**唯一开发规范源**，所有开发者和 AI 助手在编写代码前必须先阅读本文档。

---

## 🤖 AI 助手指引（阅读顺序：必读 → 按需）

### Step 1 - 入口约定

不同 AI 工具默认读取的入口文件：

| AI 工具 | 默认入口 | 本项目处理 |
|---|---|---|
| Trae | `AGENTS.md` + `.trae/rules/` | ✅ 直接读本文件 |
| Claude Code | `CLAUDE.md` | 未配置时请读 `AGENTS.md` |
| Cursor | `.cursorrules` / `.cursor/rules/` | 未配置时请读 `AGENTS.md` |
| GitHub Copilot | `.github/copilot-instructions.md` | 未配置时请读 `AGENTS.md` |
| OpenAI Codex / 其他 | `AGENTS.md` | ✅ 统一以本文件为准 |

### Step 2 - 文档读取优先级

| 优先级 | 文档 | 何时必读 |
|---|---|---|
| 🔴 P0 必读 | `AGENTS.md`（本文档） | 任何任务开始前 |
| 🟠 P1 强烈推荐 | `CODE_WIKI.md` | 涉及代码改动、API 调用、数据库操作前 |
| 🟡 P2 按需 | `docs/01-项目概览.md` | 实现新业务功能或修改 UI 前 |
| 🟡 P2 按需 | `docs/02-开发路线图.md` | 调整开发计划前 |
| 🟡 P2 按需 | `docs/03-活跃设计文档.md` | 参与进行中的设计/重构前 |

### Step 3 - 任务类型 → 文档映射

| 任务类型 | 必读文档 | 参考文档 |
|---|---|---|
| 🐛 修复 Bug | `AGENTS.md` + `CODE_WIKI.md` | - |
| ✨ 新增业务功能 | `AGENTS.md` + `CODE_WIKI.md` | `docs/01-项目概览.md` |
| 🎨 修改 UI / 聊天交互 | `AGENTS.md` + `CODE_WIKI.md`（第 5 节 Chat 组件） | `docs/01-项目概览.md`（界面设计） |
| 🗃️ 修改数据库 schema | `AGENTS.md`（硬性约束 - 数据库与迁移） + `CODE_WIKI.md`（第 7 节） | - |
| 🔁 修改 Turso 同步 | `AGENTS.md`（硬性约束 - Turso） + `CODE_WIKI.md`（第 9 节） | - |
| 🧠 修改 AI Agent 逻辑 | `AGENTS.md` + `CODE_WIKI.md`（第 5.2、8 节） | `docs/03-活跃设计文档.md` |
| 🔧 重构 | `AGENTS.md` + `CODE_WIKI.md` | `docs/03-活跃设计文档.md` |
| 📝 文档更新 | `AGENTS.md`（开发流程章节） | - |

### Step 4 - 关键规则（最重要 ⚠️）

#### 规则 1：现状 vs 蓝图，以现状为准

- `CODE_WIKI.md` 描述**代码现状**（实际已实现的表、API、组件、Tauri commands）
- `docs/` 描述**设计蓝图**（理想形态，可能未实现）
- **当两者冲突时，以 `CODE_WIKI.md` 为准**
- 如需实现 `docs/` 中的新设计，需先确认范围，再同步更新 `CODE_WIKI.md`

#### 规则 2：代码变更必须同步文档

| 代码变更 | 必须同步更新 |
|---|---|
| 新增/修改数据表 | `CODE_WIKI.md`（§7） |
| 新增/修改 Tauri command | `CODE_WIKI.md`（§6.2） |
| 新增/修改 LLM 工具（ToolRegistry） | `CODE_WIKI.md`（§5.2） |
| 新增/修改路由 / Pinia store | `CODE_WIKI.md`（§5.3 / §5.5） |
| 修改规范 | 仅修改 `AGENTS.md`（唯一规范源） |

#### 规则 3：禁止重复定义规范

- 所有开发规范**仅在 `AGENTS.md` 中定义**
- 其他文档若需引用规范，使用链接而非复制
- 发现规范在其他文档中被重复时，应清理并改为链接

#### 规则 4：文档先行 + 架构变更需讨论

1. 任何需求变更、架构调整、界面改动或代码修改，都需先讨论确认，然后同步更新相关文档
2. 涉及架构调整（删除/新增模块、重构目录结构、替换技术方案）时，先停下来提供修改方案（为什么改、怎么改、影响范围），等待用户确认
3. 小范围的 bug 修复、代码补全、UI 微调不需要确认

#### 规则 5：跨平台兼容

- 项目在 macOS 与 Windows 两台电脑上开发，必须同时考虑两端
- 避免硬编码绝对路径或系统特定的路径分隔符
- 涉及系统特定命令（如 macOS 的 `open` vs Windows 的 `start`）时需考虑跨平台
- 跨平台特定的配置应放在本地文件中，避免污染共享配置
- Tauri 构建和测试应在两个平台上验证

### Step 5 - 快速命令参考

```bash
npm run dev         # Tauri 开发模式（Vite + Rust，桌面窗口）
npm run build       # 构建生产产物（TypeScript 检查 + Vite 构建）
npm run tauri dev   # 同上（显式调用 tauri）
npm run tauri build # 打包生成桌面安装包（macOS .dmg / Windows .exe）
```

---

## 1. 项目基本信息

- **项目名称**：Accounting-App（本地优先桌面记账应用）
- **技术栈**：Vue 3 + TypeScript + Element Plus + Pinia | Rust + Tauri 2 + **libSQL 0.9** | 阿里云百炼 LLM | PaddleOCR
- **同步方案**：Turso Embedded Replica（libSQL 内建双向同步，取代原 NocoBase REST 同步）
- **平台**：macOS、Windows
- **详细代码文档**：[CODE_WIKI.md](CODE_WIKI.md)
- **设计文档目录**：[docs/](docs/)

---

## 2. 代码风格与命名

| 类型 | 规则 | 示例 |
|---|---|---|
| Vue 组件 | PascalCase | `ChatWidget.vue` |
| TypeScript 模块/工具函数 | camelCase | `agentEngine`, `dateRange.ts` |
| Rust 文件/函数/字段 | snake_case | `chat_history.rs`, `get_record` |
| 数据库表/列 | snake_case | `business_trip`, `paid_date` |
| Tauri command 名 | snake_case | `get_stats_summary` |
| **前端调用 Tauri 时的参数键** | **camelCase** | `{ datetimeGte: '...' }`（详见 §3.1） |
| 常量 | 大写下划线 | `SYNC_INTERVAL_MS` |

**格式**：缩进 2 空格；LF 换行；文件末尾保留空行；Markdown 有序列表项前需有空行。

---

## 3. 关键开发约定

> 详细代码示例与背景说明见 [CODE_WIKI.md §12 关键工程约定](CODE_WIKI.md#12-关键工程约定)。

### 3.1 Tauri 2 参数序列化

- 前端 `invoke()` 必须使用 **camelCase** 键名，Rust 端定义 **snake_case** 参数
- `Option<T>` 参数使用条件展开 `...(value ? { key: value } : {})`，不要传 `null`

### 3.2 SQLite 时间格式（统一约定）

- `datetime` / `created_at` / `updated_at`：本地时间 `YYYY-MM-DD HH:MM:SS`
- `paid_date` / `start_date` / `end_date`：纯日期 `YYYY-MM-DD`
- 比较规则：字符串字典序 = 时间顺序，可直接 `>=` 比较
- **写入方式**：Rust 侧 `INSERT` / `UPDATE` 生成时间时**必须**用 `chrono::Local::now().naive_local().format("%Y-%m-%d %H:%M:%S")` 作为参数传入；`CREATE TABLE` 中保留的 `DEFAULT (datetime('now', 'localtime'))` 仅作为兜底

### 3.3 libSQL 异步 API

- 数据库层基于 `libsql@0.9`，所有 `conn.execute` / `conn.query` 均为 `async`
- Tauri commands 必须是 `async fn`，返回 `Result<T, String>`
- 从 `Rows` 取列用 `row.get::<T>(idx)?`，不再有 rusqlite 的 `column_index`
- 无需再手动 `Arc<Mutex<Connection>>`：libsql 连接自身 `Clone + Send + Sync`，`Database::get_conn()` 每次返回新句柄
- 应用启动在 `main.rs` 中通过 `tauri::async_runtime::block_on(...)` 完成 `Database::new()` 或 `Database::new_with_turso(url, token)` 初始化

### 3.4 LLM 字段来源标注 `_source`

LLM 返回的每个字段必须附带 `_source`：

- `extracted` — 用户明确提到
- `inferred` — 上下文推断
- `default` — 系统默认填充

前端按此值标注字段来源（绿色提取 / 蓝色推断 / 灰色默认）。

### 3.5 UI 状态推导

- 存储事实，UI 状态从事实推导
- 对话消息状态由 `data.result.success` 和 `_cancelled` 标志推导
- ConfirmCard 根据状态显示标签（「已保存」「已取消」「记录详情」）
- 已取消的记录必须持久化状态，刷新后保持

---

## 4. 硬性约束

### 4.1 数据库与迁移

- 数据库结构变更**必须**使用增量迁移脚本（ALTER TABLE），**禁止** DROP TABLE
- SQLite `ALTER TABLE ADD COLUMN` 不支持非常量默认值（如 `datetime('now')`），需两步迁移（先加列再更新）
- 本地记录采用**硬删除**（直接从数据库移除，不使用软删除标记）
- 重复记录判定：amount、type、datetime 完全一致
- **NocoBase 遗留结构已清理**（2026-07-09）：`records / business_trip / learning_data` 三张表中的 `synced / nocobase_id / nocobase_updated_at / retry_count / last_error / local_updated_at`（共 6 列）以及 `sync_log` 表已通过一次性清理脚本（`scripts/cleanup-nocobase-legacy/`，任务完成后目录已删除，可从 git 历史找回）从本地 SQLite 和 Turso 云端彻底移除；业务代码与 schema 均不再引用。

### 4.2 Turso 同步

- 同步机制由 `libsql` Embedded Replica 提供：本地保留完整 SQLite 副本，`db.sync()` 触发双向增量同步
- 开关配置存于 `app_config` 表，三个 key：`turso_sync_enabled`（`"true"` / `"false"`，默认 `"false"`）、`turso_url`、`turso_token`
- 应用启动时 `main.rs` 读取上述配置：若 `enabled && url && token` 均满足则以 Embedded Replica 打开数据库，否则退回纯本地模式
- **启动不做同步**（本地优先）：`Database::new_with_turso()` 只 open replica，不调用 `db.sync()`；主界面挂载后由前端延迟 3s 静默调用 `sync_turso`，同步完成 toast 提示并静默刷新首页数据。这样既避免了启动阻塞，也避免了 schema init + 后台 sync worker + 前端并发查询之间的 `database is locked`
- **Turso 配置只在启动时生效**：修改 URL / Token / 开关后必须重启应用
- 触发同步只走 `sync_turso` Tauri command（内部调用 `Database::sync()`）；**禁止**在业务 CRUD 命令内隐式触发同步
- 连接测试走 `test_turso_connection`：把 `libsql://` 替换为 `https://` 后 GET `/health` 端点（带 Bearer Token）；不打开 replica、不改动本地数据库文件
- **禁止**新增基于 HTTP 的手写同步逻辑；如有需求先在 [docs/03-活跃设计文档.md](docs/03-活跃设计文档.md) 提案

### 4.3 脚本与数据处理

- 数据库数据处理（含 Turso 云端）**必须用独立脚本**，不要在应用代码中处理
- 一次性数据搬运脚本存放于 [`scripts/migrate-to-turso/`](scripts/migrate-to-turso/README.md)
- 脚本必须跨平台兼容（macOS / Linux / Windows）并配备标准化文档
- SQL 脚本必须包含标准化头部（目的、用法、注意事项、校验步骤）

### 4.4 安全

- API Key / Turso Token 等敏感信息存入 SQLite `app_config` 表，禁止硬编码
- Tauri capabilities 必须最小授权
- 跨平台特定的本地配置不要提交到 git
- 日志（Rust `app_log` / LLM 日志）严禁输出 API Key、Turso Token 等敏感字段

---

## 5. 开发流程

1. **需求/架构变更** → 先讨论 → 更新 [docs/01-项目概览.md](docs/01-项目概览.md)
2. **开发计划调整** → 更新 [docs/02-开发路线图.md](docs/02-开发路线图.md)
3. **重构方案** → 更新 [docs/03-活跃设计文档.md](docs/03-活跃设计文档.md)
4. **代码实现** → 遵循本文档规范
5. **代码现状变更**（表/API/组件）→ 同步更新 [CODE_WIKI.md](CODE_WIKI.md)
6. **规范本身变更** → 仅修改本文档

---

## 6. 版本控制

### 6.1 提交规范

参考 Conventional Commits：

```
[类型]: [简短描述]

[详细描述，可选]
```

类型：`feat`(新功能) / `fix`(修复) / `docs`(文档) / `style`(样式) / `refactor`(重构) / `perf`(性能) / `test`(测试) / `chore`(构建)

### 6.2 分支命名

- 主分支：`main`
- 功能分支：`feature/[功能名]`
- 修复分支：`fix/[问题描述]`

---

## 7. 经验教训（避坑清单）

- **平台相关配置必须用平台后缀 key**：`active_python_path_macos` / `active_python_path_windows` 分别存储，避免 Turso 同步时互相覆盖（macOS 上的 `/opt/homebrew/...` 会覆盖 Windows 上的 `C:\...\python.exe`）。旧的单 key `active_python_path` 由 `AppConfig::new()` 启动时自动迁移并删除。类似场景（本地文件路径、系统命令路径）都遵循此约定。
- 其他经验（已取消记录持久化、libsql 异步 API 要点、Turso 启动不做同步、时间戳用 chrono::Local）已在 §3 / §4 中定义，不再重复。

---

## 8. 文档导航

| 文档 | 用途 |
|---|---|
| [README.md](README.md) | 项目入口，快速开始 |
| [AGENTS.md](AGENTS.md)（本文档） | 开发规则与规范（开发前必读） |
| [CODE_WIKI.md](CODE_WIKI.md) | 代码实现现状（架构、模块、API、数据库、数据流） |
| [docs/01-项目概览.md](docs/01-项目概览.md) | 业务需求 + 界面设计蓝图 |
| [docs/02-开发路线图.md](docs/02-开发路线图.md) | 开发计划与里程碑 |
| [docs/03-活跃设计文档.md](docs/03-活跃设计文档.md) | 进行中的设计与重构 |

---

**最后更新**：2026-07-09
