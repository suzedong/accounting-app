# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ 当前状态：重构进行中（新旧架构并存）

项目正在从**旧架构**（纯前端 HTML/JS + Python server.py + NocoBase REST API）重构为**新架构**（Tauri 2 桌面应用 + Vue 3 + SQLite 本地数据库 + NocoBase 可选同步）。

- **旧架构代码**已全部删除（web/、server/、scripts/、.env 均不再保留）
- **新架构代码**在 `src/`（Vue 3 前端）和 `src-tauri/`（Rust 后端） — 持续开发中
- **开发命令**：`npm run dev`（启动 Tauri，前端 Vite + 后端 Rust）
- **旧架构文档**详见 `README.md`（面向旧架构的完整用户文档）

### 重构完成度

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 1: Tauri 骨架 + SQLite | ✅ 已完成 | 数据库（7 张表）、CRUD、前端基础 |
| Phase 2: 业务逻辑迁移 | ✅ 已完成 | Rust commands 齐全（记录/差旅/统计），Vue 6 个页面全部可用 |
| Phase 3: AI 聊天 + Agent | ✅ 已完成 | 百炼 API 直连、LLM dispatch、action handlers、ChatWidget、学习引擎、对话历史、OCR |
| Phase 4: 同步层 + 清理 | ✅ 进行中 | 旧架构代码已全部删除，push/pull/import 占位待实现 |

### 新架构目录

```
src/              # Vue 3 前端（TypeScript + Element Plus + Pinia）
├── main.ts       # 入口
├── App.vue       # 根组件（Navbar + Router + ChatWidget）
├── router/       # 路由：/ /records /budget /stats /trips /settings
├── stores/       # Pinia 状态管理（records、chat、learning）
├── api/          # Tauri invoke 封装（tauri.ts）
├── types/        # TypeScript 类型定义
├── utils/        # 工具函数（formatters, dateRange）
├── views/        # 页面组件（Home, Records, Budget, Stats, TripAllowance, Settings）
└── components/   # 共享组件
    ├── AppNavbar.vue           # 顶部导航栏
    ├── chat/                   # AI 对话组件（10 个）
    │   ├── ChatWidget.vue      # 悬浮对话面板
    │   ├── ChatMessage.vue     # 消息渲染
    │   ├── ChatInput.vue       # 输入框 + 图片上传
    │   ├── ChatThinking.vue    # 思考中状态
    │   ├── ConfirmCard.vue     # 确认卡片
    │   ├── DebugPanel.vue      # 调试面板
    │   ├── FollowUpCard.vue    # 追问卡片
    │   ├── ImagePreview.vue    # 图片预览
    │   ├── RecordCard.vue      # 记录卡片
    │   └── RulesPanel.vue      # 规则面板
    └── stats/                  # 统计图表
        ├── CategoryBarChart.vue
        ├── AccountPieChart.vue
        ├── MonthlyTrendChart.vue
        └── ComparisonChart.vue

src-tauri/        # Rust 后端（Tauri 2 + SQLite）
├── src/
│   ├── main.rs   # Tauri 入口，注册 commands
│   ├── commands/ # 模块（records/trips/stats/prompts/learning/chat/config/sync/ocr）
│   │   └── ocr.rs        # OCR：Python 子进程调用 PaddleOCR
│   ├── db/       # SQLite 数据库（schema, CRUD, 聚合查询）
│   └── models/   # 数据模型
├── capabilities/ # Tauri 权限配置
├── scripts/      # Python 脚本
│   ├── python_manager.sh  # Python 发现 + PaddleOCR 依赖管理
│   └── ocr_service.py     # PaddleOCR 识别服务
└── prompts/      # AI 系统 Prompt
    ├── dispatch.md
    └── preferences.md

docs/             # 设计文档
│   ├── 01-project-overview.md     # 需求 + 架构 + UI
│   ├── 02-development-roadmap.md  # 开发计划（含本地 LLM 方案）
│   └── 03-active-design-docs.md   # 进行中的设计（Agent 重构 + OCR）
```

### 新开发命令

```bash
npm run dev         # Tauri 开发模式（Vite + Rust，桌面窗口）
npm run build       # 构建生产产物（TypeScript 检查 + Vite 构建）
npm run tauri dev   # 同上（显式调用 tauri）
```

### 重要开发约定

#### Tauri 2 camelCase 序列化

Tauri 2 默认使用 camelCase 反序列化命令参数。所有 `invoke()` 调用必须使用 **camelCase** 键名，对应 Rust 端的 **snake_case** 参数：

```typescript
// ✅ 正确：前端用 camelCase
invoke('get_stats_summary', { datetimeGte: '2026-05-01 00:00:00' })

// ❌ 错误：snake_case 会导致参数丢失
invoke('get_stats_summary', { datetime_gte: '2026-05-01 00:00:00' })
```

**规则**：Rust 函数参数 `datetime_gte: String` ↔ 前端传 `{ datetimeGte: value }`。
**例外**：`Option<String>` 或 `Option<T>` 参数应使用条件展开 `...(value ? { key: value } : {})` 而非传 `null`。

#### SQLite 时间格式

SQLite 无原生 DATE/TIMESTAMP 类型，所有时间字段使用 **TEXT** 存储，格式为：

```
YYYY-MM-DD HH:MM:SS   (空格分隔，24 小时制)
```

- Rust 生成时间：`chrono::Local::now().naive_local().format("%Y-%m-%d %H:%M:%S")`
- 前端生成过滤条件：`dateRange.ts` 输出相同格式
- SQLite 内置函数：`datetime('now')` 默认返回此格式
- 比较规则：字符串字典序 = 时间顺序，可直接 `>=` 比较

#### 预算分析规则

预算执行只计算 `account = '个人'` 的支出。

---

## 项目概述（旧架构，保留作重构参考）

> 以下为旧架构文档，**仅供参考**。相关代码已删除：`server/`、`scripts/`、`web/`、`.env`。

基于 NocoBase 的纯前端记账应用，原生 HTML/CSS/JS 无框架。用户通过浏览器访问 HTML 页面，数据通过 NocoBase REST API 存取到 PostgreSQL。

## 旧架构开发命令（已废弃）

```bash
# 以下为旧架构命令，已不可用
# cd server && python3 server.py 18080
# npm run dev  # 旧版同时启动 Vite + server.py
```

## 旧架构目录结构（已废弃，保留作参考）

> 以下所有目录均已删除，不再存在于代码库中。

```
web/              # 旧前端 HTML/JS（已删除）
server/           # 旧 Python 代理 server.py（已删除）
scripts/          # 旧迁移脚本 dev.mjs、import_from_nocobase.py 等（已删除）
.env              # 旧 NocoBase/AI 凭证（已删除，配置存入 SQLite）
```

## 旧架构概览（已废弃，保留作参考）

> 以下为旧架构的代理链路和架构说明，**已不再适用**。

### 旧开发架构（双端口，统一走 server.py）

```
浏览器 → Vite dev server (localhost:5174) ──→ server.py (localhost:18080) ──→ 云端 NocoBase
                         │                        │
                         ├─ HMR + ESM 模块解析     ├─ 代理 /api/* 转发到 NocoBase
                         ├─ 静态文件服务            ├─ /api/ai/parse  → 阿里云百炼
                         └─ proxy /api/* ──────────┤─ /api/ai/dispatch → 阿里云百炼
                                                    └─ Prompt/Preference 文件管理
```

### 旧部署架构（单端口）

```
浏览器 → server.py (单端口) ──→ 云端 NocoBase
              │
              ├─ 服务 dist/ 静态构建产物
              ├─ 代理 /api/* 转发到 NocoBase
              ├─ /api/ai/parse  → 阿里云百炼
              └─ /api/ai/dispatch → 阿里云百炼
```

## Agent 架构（LLM 驱动 + Action 注册制）

### 核心设计

Agent 采用 **LLM 决策 + 前端 Action 注册** 的通用架构：

```
用户输入 → LLM dispatch → 返回 { action, params, render, title, confidence }
                              │
                              ▼
                       前端 actionHandlers 注册表
                              │
                              ▼
                       执行对应 handler → 返回结果
                              │
                              ▼
                       按 render 类型自动渲染
```

### Action 列表

| Action | 说明 | Handler |
|---|---|---|
| `create_record` | 创建记账记录 | `handleCreateRecord` |
| `correct_record` | 纠正上一条记录（自动搜索定位） | `handleCorrectRecord` |
| `update_record` | 修改指定记录 | （待实现） |
| `query_records` | 查询记录列表 | `handleQueryRecords` |
| `query_collection` | 查询任意 Collection | `handleQueryCollection` |
| `render_stats` | 渲染统计结果 | `handleRenderStats` |
| `render_budget` | 渲染预算状态 | `handleRenderBudget` |
| `save_preference` | 保存用户偏好 | `handleSavePreference` |
| `update_prompt` | 修改系统 prompt | `handleUpdatePrompt` |
| `ask_follow_up` | 追问补充信息 | `handleAskFollowUp` |
| `reply_text` | 纯文本回复 | `handleReplyText` |
| `create_skill` | 创建动态 Skill | `handleCreateSkill` |

### dispatch 返回格式

LLM 通过 `/api/ai/dispatch` 返回统一结构：

```json
{
  "action": "操作名",
  "params": { "操作参数" },
  "render": "text | table | card | list | chart",
  "title": "显示标题",
  "confidence": 0.0~1.0
}
```

### Prompt 系统

SYSTEM_PROMPT 存储在 `src-tauri/prompts/` 目录下（通过 SQLite `system_prompts` 表缓存）：

| 文件 | 用途 |
|---|---|
| `src-tauri/prompts/dispatch.md` | 能力清单 + 意图识别规则（Agent 可通过 `update_prompt` 修改） |
| `src-tauri/prompts/preferences.md` | 用户个性化偏好（Agent 可通过 `save_preference` 修改） |

### 旧架构前端模块加载（已废弃）

所有 JS 文件为 ESM 模块，通过 `globals.js` 桥接暴露到 `window.*`：

```
globals.js (type="module") ──导入──> modules/config.js, modules/utils.js,
                                     modules/nocobase-api.js, modules/parse.js,
                                     modules/ai-parser.js, modules/learning-engine.js,
                                     modules/agent-core.js, modules/chat-widget.js
                                      │
                                      └──> 挂载到 window.* 供页面 inline <script> 使用
```

**页面初始化模式**：

```html
<script type="module" src="../js/globals.js"></script>
<script>
whenGlobalsReady(() => {
  LearningEngine.init();
  ChatWidget.init();
  setActiveNav('./index.html');
});
</script>
```

### Agent 工作流程

1. 用户输入 → `AgentCore.dispatch(text)` 调用 `/api/ai/dispatch`（LLM 意图识别 + 参数提取）
2. LLM 返回 `{ action, params, render, title, confidence }`
3. 前端通过 `actionHandlers[action]` 查找对应 handler 并执行
4. Handler 调用 NocoBase API 或 AI API，返回结构化结果
5. `chat-widget.js` 按结果类型渲染 UI
6. 用户修正记录时触发 `AgentCore.learn()` 记录学习数据
7. 下次 LLM 调用时学习数据通过 `learning_context` 注入 SYSTEM_PROMPT

**解析策略**：主流程由 LLM 通过 `/api/ai/dispatch` 完成意图识别和参数提取。`parse.js` 和 `ai-parser.js` 作为 LLM 失败时的降级方案保留。

## 数据模型

### 旧架构：NocoBase Collections

| Collection | 说明 | 关键字段 |
|---|---|---|
| `records` | 收支记录 | datetime, type, category(自由文本), amount, account, note, payment_method(自由文本) |
| `accounts` | 账户 | name, balance, type, icon, color |
| `business_trip` | 差旅补助 | trip_id, start_date, end_date, days, trip_allowance, transport_allowance, status, paid_trip_allowance, paid_transport_allowance, paid_date |
| `budgets` | 预算 | month, amount, category |
| `learning_data` | AI 学习数据 | type, key, value(json), count, updated_at |

### 新架构：SQLite 表（7 张）

| 表名 | 说明 | 关键字段 |
|---|---|---|
| `records` | 收支记录 | uuid, datetime, type, category, amount, account, note, payment_method, synced, nocobase_id |
| `business_trip` | 差旅补助 | uuid, trip_id, start_date, end_date, days, trip_allowance, transport_allowance, status |
| `system_prompts` | AI 提示词 | name (dispatch/record), content, updated_at |
| `learning_data` | 学习数据 | uuid, type, key, value(json), count |
| `chat_history` | 对话历史 | uuid, role, content, data(json), skill, confidence |
| `sync_log` | 同步日志 | direction, collection, status, count, error |
| `app_config` | 应用配置 | key (ai_services), value(json) |

> 注意：新架构无 `accounts` 和 `budgets` 独立表，账户从 `records.account` 字段提取，预算在 Settings 中硬编码为 `budget_monthly` 配置项。

## 统计模式

新架构：SQLite 支持 GROUP BY，聚合直接在 SQL 中完成（`stats.rs` 6 个聚合查询命令）。
旧架构（NocoBase 无聚合）：通过 `getRecordsForStats()` 获取全量记录（`pageSize=10000`），在前端用 `utils.js` 聚合。

## 重要约定

- 所有 API 调用通过 Tauri `invoke()` 调用 Rust commands，不再依赖 HTTP 代理
- `AgentCore.dispatch()` 和 `AgentCore.execute()` 是 Agent 核心入口
- `LearningEngine.init()` 在每个页面加载时调用
- `ChatWidget.init()` 在页面加载时调用初始化 AI 对话悬浮窗
- 开发使用 `npm run dev`（Tauri 开发模式），构建使用 `npm run build` 输出到 `dist/`
- AI 配置（API Key、模型等）通过 Settings 页 UI 存入 SQLite `app_config` 表，不再使用 `.env` 文件
