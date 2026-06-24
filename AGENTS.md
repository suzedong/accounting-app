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
| 🔁 修改 NocoBase 同步 | `AGENTS.md`（硬性约束 - NocoBase） + `CODE_WIKI.md`（第 9 节） | - |
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
- **技术栈**：Vue 3 + TypeScript + Element Plus + Pinia | Rust + Tauri 2 + SQLite | 阿里云百炼 LLM | PaddleOCR
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
| 数据库表/列 | snake_case | `business_trip`, `local_updated_at` |
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

- `datetime` / `local_updated_at` / `created_at` / `updated_at`：本地时间 `YYYY-MM-DD HH:MM:SS`
- `paid_date` / `start_date` / `end_date`：纯日期 `YYYY-MM-DD`
- `nocobase_updated_at`：原始 ISO 8601 UTC（如 `2026-06-14T09:30:00.000Z`）
- 比较规则：字符串字典序 = 时间顺序，可直接 `>=` 比较

### 3.3 LLM 字段来源标注 `_source`

LLM 返回的每个字段必须附带 `_source`：

- `extracted` — 用户明确提到
- `inferred` — 上下文推断
- `default` — 系统默认填充

前端按此值标注字段来源（绿色提取 / 蓝色推断 / 灰色默认）。

### 3.4 UI 状态推导

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

### 4.2 NocoBase 同步

- 同步只处理 ISO 8601 时间戳；非法时间戳存为 NULL
- 过滤查询必须使用**数据库列名**（下划线），不要用 API 响应字段名（驼峰）
- `list_records` 必须用 POST + body 中的 filter，**禁止** GET + URL 编码
- 推送前必须**剔除本地专用字段**：`local_updated_at`、`synced`、`nocobase_id`、`nocobase_updated_at`
- update API 即使单条也返回数组形式；必须兼容对象与数组
- update 对不存在的 ID 仍返回 HTTP 200；必须检测空数据数组并回退为 create
- 当前 `sync_push` **不处理本地删除**；删除动作不会同步到 NocoBase

### 4.3 同步重试与并发

- 推送限制 3 次重试（`retry_count` 字段）；`retry_count >= 3` 跳过
- 用户编辑记录时必须重置 `retry_count = 0` 并清空 `last_error`
- 推送操作必须在 await 之前显式释放数据库锁
- 查询未同步记录时初次查询必须包含 `nocobase_id`，避免 N+1

### 4.4 时间字段比较

- 本地与 NocoBase 比较前，必须先把 ISO UTC 转为本地时间
- 增量同步过滤条件向 NocoBase 发送时，必须把本地时间转 ISO UTC

### 4.5 脚本与数据处理

- 数据库数据处理（含 NocoBase）**必须用独立脚本**，不要在应用代码中处理
- 脚本必须跨平台兼容（macOS / Linux / Windows）并配备标准化文档
- SQL 脚本必须包含标准化头部（目的、用法、注意事项、校验步骤）
- 数据归一化脚本应整合到单一文件中

### 4.6 安全

- API Key 等敏感信息存入 SQLite `app_config` 表，禁止硬编码
- Tauri capabilities 必须最小授权
- 跨平台特定的本地配置不要提交到 git

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

- 用 `now` 作为时间戳字段的回退值会导致 PostgreSQL 解析错误；应改用 NULL
- 已取消的记录需同时更新 UI 状态并持久化到数据库，刷新后才能保持一致
- NocoBase API 字段名（驼峰）与数据库列名（下划线）不同，同步逻辑必须兼容两种格式
- `business_trip` 的 NocoBase collection 响应可能缺失 `created_at` / `updated_at`，需要回填脚本
- 本地（空格分隔）与 NocoBase（ISO）时间戳格式不一致会导致同步比较错误
- 未验证记录存在性就让 update 回退为 create，会产生重复条目

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

**最后更新**：2026-06-24
