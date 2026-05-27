# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ 当前状态：重构进行中（新旧架构并存）

项目正在从**旧架构**（纯前端 HTML/JS + Python server.py + NocoBase REST API）重构为**新架构**（Tauri 2 桌面应用 + Vue 3 + SQLite 本地数据库 + NocoBase 可选同步）。

- **旧架构代码**仍存在于 `web/`、`server/`、`.env`、`vite.config.js` — 仍在重构中，暂不删除
- **新架构代码**在 `src/`（Vue 3 前端）和 `src-tauri/`（Rust 后端） — 持续开发中
- **开发命令**：`npm run dev`（启动 Tauri，前端 Vite + 后端 Rust）
- **旧架构文档**详见 `README.md`（面向旧架构的完整用户文档）

### 重构完成度

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 1: Tauri 骨架 + SQLite | ✅ 已完成 | 数据库（7 张表）、CRUD、前端基础 |
| Phase 2: 业务逻辑迁移 | ✅ 已完成 | Rust commands 齐全（记录/差旅/统计），Vue 6 个页面全部可用 |
| Phase 3: AI 聊天 + Agent | ✅ 已完成 | 百炼 API 直连、LLM dispatch、action handlers、ChatWidget、学习引擎、对话历史、OCR |
| Phase 4: 同步层 + 清理 | ❌ 未开始 | push/pull/import 占位，server.py 待删除，文档待更新 |

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
│   ├── main.rs   # Tauri 入口，注册 33 个 commands
│   ├── commands/ # 7 个模块（records/trips/stats/prompts/learning/chat/config/sync/ocr）
│   │   └── ocr.rs        # OCR：Python 子进程调用 PaddleOCR（智能探测 + 自动安装依赖）
│   ├── db/       # SQLite 数据库（schema, CRUD, 聚合查询）
│   └── models/   # 数据模型
└── capabilities/ # Tauri 权限配置

web/              # 旧前端（HTML/JS，重构中保留，最终会删除）
server/           # 旧后端（Python server.py，重构中保留，最终会删除）
doc/              # 设计文档和开发计划
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

基于 NocoBase 的纯前端记账应用，原生 HTML/CSS/JS 无框架。用户通过浏览器访问 HTML 页面，数据通过 NocoBase REST API 存取到 PostgreSQL。

## 开发命令

```bash
# 开发模式（Vite HMR + API 代理，端口 5174）
npm run dev

# 构建生产产物（输出到 dist/）
npm run build

# 启动本地服务器（端口 18080，提供静态文件 + API 代理 + AI 解析/分发代理）
cd server && python3 server.py 18080

# 浏览器访问
# 开发模式: http://localhost:5174/（推荐，支持 HMR，自动重定向到 /pages/index.html）
# 服务器模式: http://localhost:18080/（自动重定向到 /pages/index.html）
# http://localhost:5174/pages/records.html      - 记录管理（增删改查 + 分页）
# http://localhost:5174/pages/budget.html       - 预算管理
# http://localhost:5174/pages/stats.html        - 统计分析（多维度图表）
# http://localhost:5174/pages/trip_allowance.html - 差旅补助
```

## 目录结构

```
.
├── web/                    # 前端
│   ├── pages/              # HTML 页面
│   │   ├── index.html      # 首页（AI 对话记账）
│   │   ├── records.html    # 记录管理
│   │   ├── budget.html     # 预算管理
│   │   ├── stats.html      # 统计分析
│   │   └── trip_allowance.html  # 差旅补助
│   ├── js/
│   │   ├── globals.js      # ESM 桥接：导入所有模块并挂载到 window.*
│   │   ├── modules/        # 自定义模块
│   │   │   ├── config.js         # 配置：Collections 列表、月度预算
│   │   │   ├── utils.js          # 工具函数 + 统计计算
│   │   │   ├── nocobase-api.js   # NocoBase API 客户端
│   │   │   ├── parse.js          # 规则解析器（降级方案）
│   │   │   ├── ai-parser.js      # AI 解析器（降级方案）
│   │   │   ├── learning-engine.js # 学习引擎
│   │   │   ├── agent-core.js     # Agent 核心
│   │   │   └── chat-widget.js    # AI 对话悬浮组件
│   │   └── vendor/         # 第三方库
│   │       └── (Vue Data UI via npm)
│   └── assets/             # 静态资源
│       ├── chat-widget.css       # 对话组件样式
│       └── favicon.svg           # 网站图标
├── server/                 # 后端
│   ├── server.py           # Python HTTP 服务器（代理 + AI 端点 + Prompt 管理）
│   ├── prompts/            # Prompt 文件
│   │   ├── dispatch.md           # 意图识别 + 能力清单（Agent 自修改）
│   │   ├── record.md             # 纯记账解析规则（降级方案）
│   │   ├── preferences.md        # 用户个性化偏好（Agent 自修改）
│   │   └── README.md             # Prompt 编写规范
│   └── scripts/            # 数据迁移脚本
│       ├── create_collections.py
│       ├── migrate_to_nocobase.py
│       └── migrate_nocobase_to_nocobase.py
├── dist/                   # Vite 构建产物（生产部署用）
├── dev.mjs                 # 开发环境进程管理器（同时启动 Vite + server.py）
├── vite.config.js          # Vite 配置
├── package.json
├── .env                    # 敏感配置（已加入 .gitignore）
└── CLAUDE.md
```

## 架构概览

### 开发架构（双端口，统一走 server.py）

```
浏览器 → Vite dev server (localhost:5174) ──→ server.py (localhost:18080) ──→ 云端 NocoBase
                         │                        │
                         ├─ HMR + ESM 模块解析     ├─ 代理 /api/* 转发到 NocoBase
                         ├─ 静态文件服务            ├─ /api/ai/parse  → 阿里云百炼
                         └─ proxy /api/* ──────────┤─ /api/ai/dispatch → 阿里云百炼
                                                    └─ Prompt/Preference 文件管理
```

**Vite dev server（5174）**: HMR 热更新 + ESM 模块解析 + 静态文件 + `/` 重定向到 `/pages/index.html` + `/api/*` 代理到 server.py
**server.py（18080）**: NocoBase API 代理 + AI 代理 + Prompt/Preference 管理
**npm run dev**: 通过 `dev.mjs` 同时启动 Vite 和 server.py，Ctrl+C 一并关闭

### 部署架构（单端口）

```
浏览器 → server.py (单端口) ──→ 云端 NocoBase
              │
              ├─ 服务 dist/ 静态构建产物
              ├─ 代理 /api/* 转发到 NocoBase
              ├─ /api/ai/parse  → 阿里云百炼
              └─ /api/ai/dispatch → 阿里云百炼
```

本地 `server.py` 提供：
1. 静态文件服务（HTML/CSS/JS 或 dist/ 构建产物）
2. NocoBase API 代理：`/api/*` 转发
3. AI 代理：`/api/ai/parse`（纯记账解析）、`/api/ai/dispatch`（意图识别+Skill路由）
4. Prompt 管理：`PUT /api/ai/prompt/:name`（Agent 自修改解析规则）
5. Preference 管理：`GET/PUT /api/ai/preference`（Agent 自修改用户偏好）

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

SYSTEM_PROMPT 存储在 `server/prompts/` 目录下，每次请求动态读取：

| 文件 | 用途 |
|---|---|
| `server/prompts/dispatch.md` | 能力清单 + 意图识别规则（Agent 可通过 `update_prompt` 修改） |
| `server/prompts/record.md` | 纯记账解析规则（降级方案） |
| `server/prompts/preferences.md` | 用户个性化偏好（Agent 可通过 `save_preference` 修改） |
| `server/prompts/README.md` | Prompt 编写规范 |

### 前端模块加载

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

- **敏感配置**：NocoBase JWT Token 和 AI API Key 仅存放在 `.env` 文件中，由 `server.py` 统一注入，前端不持有凭证
- JWT Token 有效期约 1 年，到期后更新 `.env` 即可
- 所有 API 调用通过相对路径 `/api/*`，由 Vite proxy 转发到 server.py，再由 server.py 代理到 NocoBase 或阿里云百炼
- `NocobaseAPI` 通过 `globals.js` 桥接挂载到 `window.NocobaseAPI`，通过 `NocobaseAPI.xxx()` 调用
- `AgentCore.dispatch()` 和 `AgentCore.execute()` 是 Agent 核心入口
- `LearningEngine.init()` 在每个页面加载时调用
- `ChatWidget.init()` 在页面加载时调用初始化 AI 对话悬浮窗
- HTML 页面通过 `<script type="module" src="../js/globals.js">` 加载所有 ESM 模块（注意相对路径是 `../js/`）
- 开发使用 `npm run dev`（同时启动 Vite + server.py），构建使用 `npm run build` 输出到 `dist/`
- 前端目录：`web/pages/`（HTML）、`web/js/modules/`（模块）、`web/js/vendor/`（第三方库）、`web/assets/`（资源）
- 后端目录：`server/server.py`（服务器）、`server/prompts/`（Prompt）、`server/scripts/`（迁移脚本）
