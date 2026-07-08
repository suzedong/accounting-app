# Accounting-App Code Wiki

> 本地优先（Local-first）的 AI 桌面记账应用。基于 **Tauri 2 + Vue 3 + SQLite**，集成阿里云百炼 LLM Function Calling、PaddleOCR 票据识别，以及与 NocoBase 的双向同步能力。

---

## 目录

> **业务需求与设计蓝图**：[docs/01-项目概览.md](docs/01-项目概览.md)
> **设计决策与重构记录**：[docs/03-活跃设计文档.md](docs/03-活跃设计文档.md)

1. [项目概览](#1-项目概览)
2. [整体架构](#2-整体架构)
3. [技术栈与依赖](#3-技术栈与依赖)
4. [目录结构](#4-目录结构)
5. [前端模块详解](#5-前端模块详解)
6. [Rust 后端模块详解](#6-rust-后端模块详解)
7. [数据模型与数据库](#7-数据模型与数据库)
8. [核心数据流](#8-核心数据流)
9. [NocoBase 同步机制](#9-nocobase-同步机制)
10. [OCR 子系统](#10-ocr-子系统)
11. [运行与构建方式](#11-运行与构建方式)
12. [关键工程约定](#12-关键工程约定)

---

## 1. 项目概览

**业务需求与设计蓝图**请见 [docs/01-项目概览.md](docs/01-项目概览.md)。

| 维度 | 说明 |
|------|------|
| 定位 | 单用户桌面记账工具，强调本地隐私，可选云端同步 |
| 平台 | macOS / Windows（跨平台开发，需在两端均能构建） |
| 包名 | `accounting-app`（前端）、`accounting-app`（Rust crate）、Bundle id `com.accounting-app.app` |
| 版本 | 0.1.0 |

---

## 2. 整体架构

```
┌──────────────────────── Vue 3 Frontend (src/) ─────────────────────────┐
│                                                                         │
│   Views (Home/Records/Budget/Stats/Trips/Settings)                      │
│         │                                                               │
│         ├─ Pinia Stores (chat / records / learning)                     │
│         │                                                               │
│         ├─ AI 引擎层 (src/ai)                                            │
│         │     • AgentEngine   ← LLM 调用 + Function Calling 解析         │
│         │     • ToolRegistry  ← 20 个工具（Zod schema）                  │
│         │                                                               │
│         ├─ Chat 组件 (ChatWidget / ConfirmCard / StepList / …)           │
│         │                                                               │
│         └─ API 封装 src/api/tauri.ts ──────────┐                        │
│                                                ▼                        │
│                                       Tauri invoke() ipc                │
│                                                ▼                        │
├──────────────────────── Rust Backend (src-tauri/) ──────────────────────┤
│                                                                         │
│   commands/  ←  对外暴露的 Tauri commands                                │
│   (records / trips / stats / prompts / learning / chat /                │
│    config[LLM] / sync / ocr)                                            │
│         │                                                               │
│         ├──► db/ (rusqlite, WAL)                                        │
│         │       schema.rs · records.rs · trips.rs · prompts.rs ·        │
│         │       learning.rs · chat_history.rs · sync_log.rs             │
│         │                                                               │
│         ├──► db/nocobase/ (HTTP client + push/pull/全量同步/增量同步)    │
│         │                                                               │
│         ├──► HTTP → 阿里云百炼 / OpenAI 兼容 LLM (call_llm_with_tools)   │
│         │                                                               │
│         └──► Python 子进程 → PaddleOCR (ocr_recognize)                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                              ▲                         ▲
                              │                         │
                  SQLite 本地数据库            NocoBase REST API（远端）
                  app_data.db (WAL)            collections: records /
                                               business_trip / learning_data
```

**核心思想**：
- **数据持久化在 Rust + SQLite**：所有领域操作（CRUD、统计、同步、LLM 调用）都通过 Tauri `invoke()` 走 Rust。
- **AI 编排在前端**：`AgentEngine` 单例负责 prompt 组装、Function Calling、tool dispatch；`ToolRegistry` 用 Zod 定义工具 schema 并最终翻译为 LLM 的 JSON Schema。
- **三层记忆**：活跃上下文（最近 10 轮）+ 对话归档（`chat_history` 表）+ 持久记忆（`learning_data` + preferences markdown）。

---

## 3. 技术栈与依赖

### 前端（`package.json`）

| 依赖 | 用途 |
|---|---|
| `vue@^3.5`、`vue-router@^4.5`、`pinia@^2.3` | 核心框架 / 路由 / 状态管理 |
| `element-plus@^2.9` + Element Plus Icons | UI 组件库 |
| `echarts@^6` + `vue-echarts@^8` | 统计图表 |
| `zod@^4.4` | 工具参数 schema（驱动 Function Calling） |
| `@tauri-apps/api@^2.1`、`@tauri-apps/plugin-shell@^2.2` | 与 Rust 后端通信、Shell 插件 |
| 开发：`vite@^6`、`vue-tsc@^2.2`、`typescript@~5.7`、`@vitejs/plugin-vue` | 构建与类型检查 |

### Rust 后端（`src-tauri/Cargo.toml`）

| 依赖 | 用途 |
|---|---|
| `tauri@2`（启用 `devtools`）+ `tauri-plugin-shell` | 桌面外壳 |
| `rusqlite@0.32`（`bundled`、`chrono`） | SQLite，无需系统依赖 |
| `chrono@0.4` | 时间处理（本地时间 ↔ ISO UTC） |
| `serde` / `serde_json` | JSON 序列化 |
| `uuid@1`（v4） | 记录 UUID |
| `reqwest@0.12`（`json`） | 调用 LLM 与 NocoBase |
| `tokio@1`（`full`） | 异步运行时 |
| `dirs@5` | 用户数据目录 |
| `urlencoding@2` | NocoBase filter URL 编码 |
| `log@0.4` | 应用日志 |

### 外部服务/工具
- **阿里云百炼**（或任意 OpenAI 兼容 `/v1/chat/completions`）— Function Calling
- **NocoBase**（自托管） — REST 同步
- **Python 3.8–3.12 + PaddleOCR** — 票据识别子进程

---

## 4. 目录结构

```
accounting-app/
├── AGENTS.md                # 开发规范（唯一规范源）
├── CODE_WIKI.md             # 代码实现现状（本文件）
├── README.md                # 项目入口
├── package.json             # 前端依赖
├── vite.config.ts           # Vite，dev 端口 5174
├── tsconfig.json
├── index.html
│
├── docs/                    # 设计蓝图（项目概览/路线图/活跃设计）
│   ├── 01-项目概览.md
│   ├── 02-开发路线图.md
│   └── 03-活跃设计文档.md
│
├── scripts/                 # 数据库维护脚本（跨平台 SQL/Python）
│
├── src/                     # Vue 3 前端
│   ├── main.ts              # 入口：Pinia + Router + Element Plus + Icons
│   ├── App.vue              # 根：Navbar + RouterView + ChatWidget + DevConsole
│   ├── env.d.ts
│   │
│   ├── router/index.ts      # 6 个懒加载路由，beforeEach 更新 title
│   ├── ai/                  # AI 引擎层
│   │   ├── agent-engine.ts  # AgentEngine 单例：流水线 + LLM 调用
│   │   └── tool-registry.ts # ToolRegistry：Zod → JSON Schema、工具执行
│   ├── api/tauri.ts         # invoke() 封装（按域分组）
│   ├── stores/              # Pinia
│   │   ├── chat.ts          # 对话状态机
│   │   ├── records.ts       # 列表/筛选/分页
│   │   └── learning.ts      # 纠错学习数据
│   ├── components/
│   │   ├── chat/            # ChatWidget/ConfirmCard/StepList/...
│   │   ├── stats/           # 4 个 ECharts 图表组件
│   │   ├── layout/AppNavbar.vue
│   │   └── ErrorBoundary.vue
│   ├── composables/         # useOCR、useParse
│   ├── views/               # Home/Records/Budget/Stats/TripAllowance/Settings
│   ├── types/               # chat.ts、index.ts
│   └── utils/               # formatters/dateRange/invoke-logger/keywords/stats
│
└── src-tauri/               # Rust 后端
    ├── tauri.conf.json      # productName、dev/build 命令、CSP、窗口尺寸
    ├── capabilities/default.json   # shell:open + core:event
    ├── Cargo.toml
    ├── build.rs
    ├── prompts/             # AI Prompt 静态资源
    │   ├── dispatch.md      # 启动时强制覆盖 system_prompts.dispatch
    │   └── preferences.md   # 首次启动 seed，用户可编辑
    ├── scripts/             # OCR 相关脚本
    │   ├── ocr_service.py
    │   ├── python_manager.sh / .ps1
    │   └── download_models.sh
    └── src/
        ├── main.rs          # invoke_handler! 注册所有命令；启动初始化
        ├── logger.rs
        ├── commands/        # 9 个命令模块（薄包装层）
        ├── db/              # rusqlite 业务逻辑 + NocoBase 同步子模块
        └── models/mod.rs    # AiService（跨域共享）
```

---

## 5. 前端模块详解

### 5.1 入口与全局壳

| 文件 | 关键点 |
|---|---|
| [main.ts](file:///Users/szd/Documents/Code/accounting-app/src/main.ts) | `createApp(App).use(pinia).use(router).use(ElementPlus)`，注册全部 Element Plus 图标 |
| [App.vue](file:///Users/szd/Documents/Code/accounting-app/src/App.vue) | `<AppNavbar/>` + `<ErrorBoundary><RouterView/></ErrorBoundary>` + 全局 `<ChatWidget/>` + `<DevConsole/>`；`Ctrl+`` 切换 DevConsole；启动时调用 `checkOcrStatus()`，未就绪则提示跳转 `/settings` |
| [router/index.ts](file:///Users/szd/Documents/Code/accounting-app/src/router/index.ts) | `createWebHistory` + 6 个懒加载路由：`/`、`/records`、`/budget`、`/stats`、`/trips`、`/settings`，`beforeEach` 根据 `meta.title` 更新文档标题 |

### 5.2 AI 引擎层

**设计决策与架构说明**请见 [docs/03-活跃设计文档.md §1 AI Agent 架构重构](docs/03-活跃设计文档.md#1-ai-agent-架构重构)。

#### `src/ai/agent-engine.ts` — `AgentEngine`（全局单例）

负责"理解用户意图 → 调用工具"的两阶段流水线。

私有状态：`conversationHistory`、`maxRounds = 10`、`systemPrompt`、`preferenceText`、`learningText`、`contextLoaded`、`llmLogs`、`llmLogListeners`、`lastConfirmedRecordContext`。

核心方法：

| 方法 | 说明 |
|---|---|
| `loadContext()` | 并行加载 dispatch prompt、preferences、learning corrections |
| `processMessage(text, _imageBase64, onStep, runtimeContext)` | 主流程：构建 systemMessage（含当前时间 + 偏好 + 学习数据）→ Step1 LLM 意图识别 → 字段清洗（`removeOrphanSourceFields`、`removeInventedPaymentFields`）→ Step2 `ToolRegistry.execute()` → 返回 `{steps, toolResult, finalReply, action}` |
| `_callLLMWithTools()` | 调 `callLLMWithTools`；`needsHistoryContext` 检测"上面/改成/不对/应该是"等修正意图，按需注入对话历史摘要 |
| `parseFunctionCallResponse()` | 兼容 `tool_calls` 与降级的 JSON 文本 |
| `getFieldSource()` / `removeInventedPaymentFields()` | 字段来源标注（extracted / inferred / default）；用户未提支付方式时删除 `payment` |
| `setLastConfirmedRecordContext()` | 维护"上一条已确认记录"摘要，用于修正定位 |
| `getLLMLogs / addLLMListener / pushLLMLog / clearLLMLogs` | LLM 调用日志（DevConsole） |
| `getHistory / clearHistory / restoreContext(maxRounds=10) / resetContext` | 活跃上下文管理 |

#### `src/ai/tool-registry.ts` — `ToolRegistry`

| 方法 | 说明 |
|---|---|
| `register<Args>(tool)` | 用 `{name, description, schema(Zod), execute}` 注册工具 |
| `getTools()` | 将所有工具映射为 LLM Function Calling 的 JSON Schema 数组（含 `_zodToJsonSchema` 适配 Zod v4 内部结构） |
| `execute(name, args, context)` | 查工具 → Zod `safeParse` 校验 → 调 `execute` → 统一捕获异常包装为 `ToolResult` |
| `getNames / has` | 辅助 |

**注册的工具**（按域分组）：

| 域 | 工具 |
|---|---|
| 记账（创建） | `create_record`、`confirm_record` |
| 记账（修正） | `correct_record`（含 `resolveCorrectionTarget` + `classifyCorrectionRisk`，按 `LOW/HIGH_RISK_FIELDS` 风险分级，低风险直接执行 / 高风险生成 `CorrectionConfirmCard`）、`confirm_correction`、`update_record`、`select_record`（候选卡选中后由 UI 调用） |
| 记账（删除） | `delete_record`（复用 `resolveCorrectionTarget` + `classifyDeleteRisk`：低风险直接删 / 高风险生成 `DeleteConfirmCard` / 多命中走 `CandidateSelectCard`，选中后 UI 携 `followUpAction=confirm_delete` 派发确认）、`confirm_delete` |
| 查询/统计 | `query_records`、`render_stats`、`render_budget`、`query_collection` |
| 偏好/系统 | `save_preference`、`update_prompt`、`clear_chat` |
| 交互 | `ask_follow_up`、`reply_text` |
| 差旅（创建） | `create_trip_record`、`confirm_trip_record` |
| 差旅（发放） | `record_trip_payment`（按金额匹配 trip/transport/full、end_date+10 天窗口；单命中直接生成发放卡，多命中返回 `candidateSelect`+`followUpAction=confirm_trip_payment_selected`）、`confirm_trip_payment_selected`（候选选中后由 UI 调用，生成待确认发放卡）、`confirm_trip_payment` |
| 差旅（修正） | `update_trip_record`（含 `resolveTripTarget` + `classifyTripCorrectionRisk`，按 `LOW/HIGH_RISK_FIELDS_TRIP` 风险分级，低风险直接更新 / 高风险生成 `CorrectionConfirmCard[domain=trip]` / 多命中弹候选）、`confirm_trip_correction` |
| 差旅（删除） | `delete_trip_record`（含 `classifyTripDeleteRisk`：低风险直接删除 / 高风险生成 `DeleteConfirmCard[domain=trip]` / 多命中弹候选）、`confirm_trip_delete`、`select_trip_record`（候选卡选中后由 UI 调用） |

辅助：`normalizeRecordFields`、`buildCorrectionChanges`、`hasContextConflict`、`recordToCorrectionTarget`、`classifyDeleteRisk`、`resolveTripTarget`、`classifyTripCorrectionRisk`、`classifyTripDeleteRisk`、`buildTripCorrectionChanges`、`hasTripContextConflict`、`tripToCorrectionTarget`，常量 `FIELD_LABELS` / `FIELD_LABELS_TRIP` / `LOW_RISK_FIELDS_TRIP` / `HIGH_RISK_FIELDS_TRIP` / `RECENT_RECORD_KEYWORDS`。

**候选卡闭环**：`correct_record` / `delete_record` / `update_trip_record` / `delete_trip_record` / `record_trip_payment` 命中多条时返回 `render:'candidateSelect'` + `data.followUpAction`（`confirm_correction` / `confirm_delete` / `confirm_trip_correction` / `confirm_trip_delete` / `confirm_trip_payment_selected`）+ 视情况附 `data.pendingFields` 或 `data.paymentAmount`。`ChatWidget.handleCandidateSelect` 依 `followUpAction` 就地把当前 AI 消息切换为 `correctionCard` / `deleteCard`（含 `domain='trip'` 分支）或发放确认卡，用户再点确认即触发对应 tool 落库。

**风险分级复用**：`ToolRuntimeContext` 同时携带 `lastConfirmedRecord`（记账域）与 `lastConfirmedTrip`（差旅域），`chat` store 在成功创建 / 修正 / 发放 trip 后写回 `lastConfirmedTrip`，删除后清空。Rust `update_trip` 在 `days` 变化时自动重算 `trip_allowance = days*100 / transport_allowance = days*30 / total = days*130`，避免前端遗漏产生金额与天数不一致的记录。

**跨会话"上一条"过期保护**：`chat` store 内部为 `lastConfirmedRecord` / `lastConfirmedTrip` 各维护 `savedAt` 时间戳，TTL 从 `app_config.last_confirmed_ttl_minutes` 读取（默认 30 分钟，可在 Settings › AI 服务 › "上一条"引用时效 中调整）。`loadHistory` 遍历持久化消息按成功的 `confirm_record` / `confirm_correction` / `confirm_trip_*` / `record_trip_payment` / `confirm_trip_payment` 类事件回填两个引用，并以消息 `created_at` 作为 `savedAt`。所有向工具透传的位置改用 `getFreshLastConfirmedRecord()` / `getFreshLastConfirmedTrip()`：读取时若超 TTL 会自动清空并返回 null，从而强制"上一条"关键词降级为"最新一条 + 高风险确认"或候选选择流程。

**强制确认修正开关**：`app_config.force_confirm_corrections`（"1"/"0"，默认关闭）控制记账 / 差旅修正是否忽略低风险直更路径。开启后 `classifyCorrectionRisk` / `classifyTripCorrectionRisk` 会短路返回 `high`，任何 `correct_record` / `update_trip_record` 都会走 `CorrectionConfirmCard` 二次确认。Settings › AI 服务 › 强制确认修正 提供开关；保存后通过 `chatStore.setForceConfirmCorrections()` 热更新，无需重启。

### 5.3 Pinia Stores

| Store | State | 主要 Actions |
|---|---|---|
| [`chat.ts`](file:///Users/szd/Documents/Code/accounting-app/src/stores/chat.ts) | `messages`, `isOpen`, `sending`, `ocrLoading`, `pendingRecord`, `pendingAction`, `lastConfirmedRecord`, `awaitingFollowUp`, `pendingFollowUp`, `editingField`, `recordUpdated`；`sessionId` 每次启动生成 | `loadHistory(limit)`、`persistMessage(msg, llmMessages)`、`sendMessage(text, ref, imageBase64?, imageFullSrc?)`、`confirmRecord(msg)`、`cancelRecord(msg)`（写入 `_cancelled` 持久化）、`startEditField / applyFieldEdit`、`answerFollowUp`、`clearMessages / clearHistory`；内部：`checkDuplicate`（amount + type + 精确秒 datetime）、`saveLearningIfNeeded`、`buildSynthesizedInput`、`deriveRenderType / deriveUIStatus` |
| [`records.ts`](file:///Users/szd/Documents/Code/accounting-app/src/stores/records.ts) | `records, total, page, pageSize=20, loading, filters{type,category,account,datetimeGte,datetimeLte,sort='datetime_desc'}`；computed `totalPages` | `fetchRecords`、`createRecord`、`updateRecord`、`deleteRecord`（CRUD 后自动 `fetchRecords`） |
| [`learning.ts`](file:///Users/szd/Documents/Code/accounting-app/src/stores/learning.ts) | `corrections[], loading`；computed `correctionsByField`、`promptInjection`（top 10 注入 prompt） | `loadCorrections`、`addCorrection`、`learnFromCorrection(original, corrected)`、`getCorrectionForField(field, keyword)` |

### 5.4 Tauri API 封装（`src/api/tauri.ts`）

按域分组：

```
Records     getRecords / getRecord / createRecord / updateRecord / deleteRecord
            getCategories / getPaymentMethods
Trips       getTrips / createTrip / updateTrip / deleteTrip
Stats       getStatsSummary / getStatsByCategory / getStatsByAccount
            getMonthlyTrend / getComparison / getBudgetAnalysis
Config      getConfig / setConfig / getAllConfig
Prompts     getSystemPrompt / updateSystemPrompt / refreshPromptFromFile / updatePreference
Learning    getLearningCorrections / saveCorrection / deleteCorrection / clearCorrections
Chat        getChatHistory / saveChatMessage / clearChatHistory / getChatSessions
LLM         callLLM / callLLMWithTools
AI Service  getAiServices / saveAiServices / activateAiService / testAiConnection
OCR         checkOcrStatusFast / startOcrDiscover / checkOcrStatus / selectPython
            installOcrDependencies / install|uninstall|reinstallPaddleocrForPython
            setOcrEnabled / install|uninstall|reinstallBundledPython / ocrRecognize
Sync        syncFull / syncPush / syncPull / getSyncLogs
```

### 5.5 Views

| 文件 | 职责 |
|---|---|
| [Home.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/Home.vue) | 首页仪表盘：本月支出/收入/结余三卡 + 类别 / 账户分析格栅 |
| [Records.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/Records.vue) | 记录列表：筛选（类型/账户/日期） + 新增/编辑对话框；监听 `records:highlight-duplicate` 高亮闪烁重复记录 |
| [Budget.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/Budget.vue) | 预算管理：月度预算进度条（超支/紧张/正常），可修改月度预算（`account='个人'` 口径） |
| [Stats.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/Stats.vue) | 统计：周期切换 + 4 个图表（分类排行 / 账户 / 趋势 / 对比） |
| [TripAllowance.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/TripAllowance.vue) | 差旅补助：状态筛选、补助总额/已发/待发/记录数 + CRUD + 发放 |
| [Settings.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/Settings.vue) | 设置：AI 服务多实例（激活、连接测试） + Prompt 编辑 + NocoBase 同步 + OCR/Python 管理 + 数据库路径 |

### 5.6 Chat 组件清单

| 组件 | 作用 |
|---|---|
| `ChatWidget.vue` | 主容器：悬浮按钮 + 侧边面板 + 消息列表 + 设置入口；自动滚动 |
| `ChatInput.vue` | 文本 + 图片上传/粘贴；发送时触发 OCR；`@send(text, imageBase64, imageFullSrc)` |
| `ConfirmCard.vue` | 确认卡：识别普通记账 / 差旅创建 / 差旅发放三态；按 `_cancelled` 和 `data.result.success` 推导"待确认 / 已保存 / 已取消"标题；支持字段编辑 |
| `FollowUpCard.vue` | 追问卡：缺失字段时列出按钮供用户选择 |
| `RecordCard.vue` | 已创建记录卡片：含修正/删除按钮 |
| `CorrectionConfirmCard.vue` | 高风险修正确认卡：target + diff + 风险原因 |
| `StepList.vue` | 推理链：OCR → 意图识别 → 执行操作，字段来源彩色标签 |
| `ImagePreview.vue` | 图片缩略预览 + OCR loading 覆盖层 |
| `SettingsPanel.vue` | 4 Tab：Dispatch Prompt / 偏好 / 学习数据 / 系统诊断 |
| `DevConsole.vue` | 3 Tab：IPC 日志 / LLM 日志 / Rust 日志（监听 `app_log` 事件） |

---

## 6. Rust 后端模块详解

### 6.1 入口（`src-tauri/src/main.rs`）

`#[tokio::main]` 启动 Tauri Builder：
1. 构造 `Database`（打开 SQLite，启用 WAL，调用 `schema::init` 创建/迁移表，覆盖 dispatch prompt）。
2. 构造 `AppConfig`（启动时从 `app_config` 表载入到内存 `Mutex<HashMap>`）。
3. 注入 `Database` 与 `AppConfig` 为 `State`。
4. 初始化日志文件 + emit 启动 `app_log` 事件。
5. 启用 `tauri_plugin_shell`。
6. `invoke_handler!` 注册全部命令。

### 6.2 Tauri Commands 一览

| 域 | 命令 |
|---|---|
| Records | `get_records` `get_record` `create_record` `update_record` `delete_record` `get_categories` `get_payment_methods` |
| Trips | `get_business_trips` `create_business_trip` `update_business_trip` `delete_business_trip` |
| Stats | `get_stats_summary` `get_stats_by_category` `get_stats_by_account` `get_monthly_trend` `get_comparison` `get_budget_analysis` |
| Prompts | `get_system_prompt` `update_system_prompt` `update_preference` `refresh_prompt_from_file` |
| Learning | `get_learning_corrections` `save_correction` `delete_correction` `clear_corrections` |
| Chat | `get_chat_history` `save_chat_message` `clear_chat_history` `get_chat_sessions` |
| Config / LLM | `get_config` `set_config` `get_all_config` `test_ai_connection` `call_llm` `call_llm_with_tools` `get_ai_services` `save_ai_services` `activate_ai_service` `open_folder` |
| Sync | `nocobase_test_connection` `sync_push` `sync_pull` `sync_full` `get_sync_logs` |
| OCR | `check_ocr_status` `check_ocr_status_fast` `start_ocr_discover` `select_python` `install_ocr_dependencies` `install_paddleocr_for_python` `uninstall_paddleocr_for_python` `reinstall_paddleocr_for_python` `set_ocr_enabled` `ocr_recognize` `install_bundled_python` `uninstall_bundled_python` `reinstall_bundled_python` |

### 6.3 commands 模块要点

#### `records.rs` / `trips.rs`
薄包装层，直接转发到 `db::records` / `db::trips`。

#### `stats.rs`
聚合查询，定义统计结构体：

```rust
struct StatsSummary { expense_total, expense_count, income_total, income_count, balance }
struct CategoryStat { category, total, count }
struct AccountStat  { account, total, count }
struct MonthTrend   { month, income, expense }
struct ComparisonPeriod  { label, income, expense, balance }
struct ComparisonResult  { current, previous }
struct BudgetAnalysis    { budget_monthly, actual_expense, usage_rate, remaining,
                           days, remaining_days, daily_avg, daily_remaining, status }
```

> 预算口径**固定为 `account='个人' AND type='支出'`**（[stats.rs#L237](file:///Users/szd/Documents/Code/accounting-app/src-tauri/src/commands/stats.rs#L237)）。

#### `prompts.rs`
读写 `system_prompts` 表 + 偏好 markdown 行级编辑（`update_preference_in_doc` 替换 `- key：value` 行，兼容半/全角冒号，找不到则追加）。

#### `learning.rs`
对 `learning_data` 中 `type='correction'` 的条目管理。Key 采用 `keyword|field` 组合键，兼容旧无 `|` 格式。

#### `chat.rs`
聊天历史读写。`save_message` 内含**取消态合并逻辑**：当新消息 `data` 含 `_cancelled` 时 UPDATE 该 UUID 而非 INSERT，确保已取消状态在刷新后保留（[chat_history.rs#L68-L77](file:///Users/szd/Documents/Code/accounting-app/src-tauri/src/db/chat_history.rs#L68-L77)）。

#### `config.rs`
- 内存 KV：`AppConfig { data: Mutex<HashMap<String,String>> }`，启动从 `app_config` 表载入。
- LLM：`call_llm_with_tools(system_message, user_message?, tools_json?, include_tool_calls)` 是 Function Calling 主入口。构建 OpenAI 兼容 `/v1/chat/completions` 请求（`tool_choice:"auto"`），`include_tool_calls=true` 时返回 `{content, tool_calls}` 序列化字符串。
- AI 多实例：`AiService { id, name, api_url, api_key, model, active }`，保存时确保唯一 active。
- `open_folder` 跨平台调用 `explorer/open/xdg-open`。

#### `ocr.rs`
管理 OCR 子进程：
- 探测 Python（`SystemPython`：path、version、is_compatible 3.8–3.12、has_paddleocr）。
- `start_ocr_discover` 异步线程发出 `ocr_discover_result` 事件。
- 安装/卸载/重装 PaddleOCR：逐行流式输出 `ocr_install_log` 事件，含心跳。
- 内置 Python：`install/uninstall/reinstall_bundled_python` 调用 `scripts/python_manager.{sh,ps1}`。
- 识别：`ocr_recognize(image_base64)` 写临时 base64 文件，调 `import ocr_service; recognize_image(b64)`，60s 超时。

#### `sync.rs`
NocoBase 同步入口，对 `records / business_trip / learning_data` 三表统一编排：

```rust
struct TableSyncResult { records_pushed, records_pulled, records_deleted,
                         records_conflicts, trips_pushed, trips_pulled,
                         learning_pushed, learning_pulled,
                         total_pushed, total_pulled, total_deleted,
                         total_conflicts, errors: Vec<String> }
```

- `sync_push`：顺序 `push_records → push_trips → push_learning`
- `sync_pull`：`pull_records_only → pull_trips → pull_learning`
- `sync_full`：records 走**全量对比 + 删除策略 + 5 分钟阈值**；trips/learning 走 pull + push 增量
- `get_sync_logs(limit?)` 读 `sync_log`

### 6.4 db 模块要点

| 文件 | 职责 |
|---|---|
| `connection.rs` | `Database { conn: Arc<Mutex<Connection>> }`；debug 模式数据库存 `<project>/database/app_data.db`，release 存 `~/Library/Application Support/accounting-app/app_data.db`；启用 WAL + 外键 |
| `schema.rs` | 创建 7 张表 + 内置迁移（`migrate_chat_history`、各表 `local_updated_at`、`retry_count`、`last_error` 两步迁移）；启动时用 `include_str!("../../prompts/dispatch.md")` **强制覆盖** dispatch prompt；首次启动 seed preferences；清理废弃 `user_preferences`、`record` prompt、旧版 correction；`seed_default_config` 写入 `ocr_enabled=true`、`budget_monthly=3500.0` |
| `records.rs` | `RecordInput / RecordUpdateInput / RecordRow`；`get_records`（分页 + 过滤 + 排序 + COUNT(*)）、`create/update/delete`（更新后强制 `synced=0, retry_count=0, last_error=NULL`） |
| `trips.rs` | `TripInput / TripUpdateInput / TripRow`；`create_trip` 自动计算 `trip_allowance=days*100`、`transport_allowance=days*30`、`total` |
| `prompts.rs` | `PromptRow`；`get_prompt / update_prompt`（UPSERT）；`update_preference_in_doc` 行级替换 |
| `learning.rs` | `LearningCorrection { id, keyword, field, value }`，key 拆 `keyword|field`，兼容旧无 `|` 格式 |
| `preferences.rs` | **已废弃**，仅 `#[allow(dead_code)]` 保留；schema.rs 启动时 DROP `user_preferences` 表 |
| `chat_history.rs` | `ChatMessageRow / ChatMessageInput`；`save_message` 含取消态合并；`get_history(limit)` 按 `created_at DESC`；`get_sessions(limit)` 按 session 聚合 |
| `sync_log.rs` | `SyncLogRow`；`log_sync(direction, collection, status, count, error?)` + `get_logs(limit)` |

### 6.5 NocoBase 同步子模块（`db/nocobase/`）

| 文件 | 职责 |
|---|---|
| `client.rs` | `NocoBaseClient { base_url, token, http: reqwest::Client }`，方法 `create_record / update_record / list_records / delete_record / test_connection`；时间工具：`parse_local_naive`、`parse_iso_utc`、`iso_utc_to_local_db`、`local_db_to_iso_utc`、`normalize_to_date`（取前 10 位日期）、`diff_seconds_remote_minus_local`、`extract_record_object`（兼容 update 返回数组、create 返回对象） |
| `push.rs` | records 推送：`SELECT ... WHERE synced=0 AND retry_count<3`；有 `nocobase_id` 走 update，update 返回空数据时按 UUID 查 list 再决定是否回退 create；无 `nocobase_id` 直接 create；成功后 `update_record_synced_status`（`synced=1`、保存 `nocobase_id`、`nocobase_updated_at` 转本地空格写入 `local_updated_at`）；失败 `mark_push_failure`（`retry_count++`、`last_error`） |
| `pull.rs` | records 全量同步：拉云端 UUID/updated_at/id + 本地全量 → 双 HashMap 比对：云有本无 → pull；本有云无 → `synced=0 retry_count<3` push、`synced=1` delete、超限跳过；双有 → `diff > 300s` 判定冲突方向 |
| `trip_sync.rs` | trips **增量**同步：`MAX(nocobase_updated_at)` 作为 `$gt` 过滤；同样 5 分钟阈值；推送时空响应回退 create；`paid_date` 用 `normalize_to_date` 截 10 位 |
| `learning_sync.rs` | learning_data 增量同步，结构与 trip_sync 完全对称；推送字段 `{uuid, type, key, value, count}` |

### 6.6 models（`src-tauri/src/models/mod.rs`）

仅一个跨域共享模型：

```rust
pub struct AiService { id, name, api_url, api_key, model, active }
```

其余领域模型分散在各 `db/*.rs`、`commands/*.rs` 内。

### 6.7 Tauri 配置

[tauri.conf.json](file:///Users/szd/Documents/Code/accounting-app/src-tauri/tauri.conf.json)：
- `productName = "AI 记账"`，`identifier = "com.accounting-app.app"`
- `devUrl = http://localhost:5174`，`frontendDist = ../dist`
- `beforeDevCommand = npm run dev:frontend`、`beforeBuildCommand = npm run build`
- 窗口 1200×800，最小 900×600
- CSP：`default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self'; connect-src 'self' https: http:; font-src 'self' https:;`（允许 LLM 与 NocoBase 直连，可为 http 局域网）
- `tauri-plugin-shell`：`"open": true`

[capabilities/default.json](file:///Users/szd/Documents/Code/accounting-app/src-tauri/capabilities/default.json)：仅 `main` 窗口、`local=true`，授予 `shell:allow-open` + `core:event:default`（前端订阅 `app_log` / `ocr_install_log` / `ocr_discover_result` 事件必需）。

---

## 7. 数据模型与数据库

### 7.1 7 张 SQLite 表

| 表 | 说明 | 关键字段 |
|---|---|---|
| `records` | 收支记录 | `uuid`, `datetime`, `type`, `category`, `amount`, `account`, `note`, `payment_method`, `synced`, `nocobase_id`, `nocobase_updated_at`, `local_updated_at`, `retry_count`, `last_error`, `created_at` |
| `business_trip` | 差旅补助 | `uuid`, `trip_id`, `start_date`, `end_date`, `days`, `trip_allowance`, `transport_allowance`, `total`, `status`, `paid_trip_allowance`, `paid_transport_allowance`, `paid_date`, `notes`, `synced`, `nocobase_id`, `nocobase_updated_at`, `local_updated_at`, `retry_count`, `last_error`, `created_at` |
| `system_prompts` | AI Prompt | `name`（dispatch / preferences）, `content`, `updated_at` |
| `learning_data` | 学习/纠错数据 | `uuid`, `type`（'correction'）, `key`（`keyword\|field`）, `value`(json), `count`, 同步字段 |
| `chat_history` | 对话历史 | `uuid`, `session_id`, `role`, `content`, `data`(json: `llmMessages` / `_steps` / `record` / `result` / `_cancelled`), `created_at` |
| `sync_log` | 同步日志 | `direction`, `collection`, `status`, `count`, `error`, `created_at` |
| `app_config` | 应用配置 | `key`（`ai_services` / `nocobase_url` / `budget_monthly` / `ocr_enabled` / `active_python_path` …）, `value`(json) |

> **不存在**独立的 `accounts`、`budgets`、`categories`、`payment_methods` 表，均作为记录的自由文本字段使用。

### 7.2 时间字段格式约定

| 字段 | 格式 | 说明 |
|---|---|---|
| `datetime`、`local_updated_at`、`created_at`、`updated_at` | `YYYY-MM-DD HH:MM:SS`（**本地时区**，空格分隔） | SQLite TEXT 存储；字符串字典序 = 时间顺序，可直接 `>=` 比较 |
| `paid_date`、`start_date`、`end_date` | `YYYY-MM-DD` | 纯日期 |
| `nocobase_updated_at` | RFC3339 ISO 8601 UTC（如 `2026-06-14T09:30:00.000Z`） | 与 NocoBase 通信前后用 `iso_utc_to_local_db` / `local_db_to_iso_utc` 转换 |

### 7.3 LLM 字段来源标注 `_source`

LLM 返回的每个字段必须附带 `_source`：

| 值 | 含义 | 示例 |
|---|---|---|
| `extracted` | 用户输入中明确提到 | "花了 35 元" → `amount_source: extracted` |
| `inferred` | 根据上下文推断 | "吃饭" → `category_source: inferred` |
| `default` | 系统默认填充 | 未提账户 → `account_source: default` |

前端 `StepList` 据此用绿/蓝/灰三色标注。

---

## 8. 核心数据流

### 8.1 AI 对话记账流水线

```
用户输入(text+image?)
        │
        ▼
  ChatInput.vue（粘贴/上传图片即触发前端 OCR）
        │
        ▼
  ChatStore.sendMessage()
        │
        ▼
  AgentEngine.processMessage()
        │
        ├── loadContext()  dispatch.md + preferences.md + learning_data
        │
        ├── 构建 systemMessage（当前时间 + 偏好 + 学习上下文 [+ 修正历史摘要]）
        │
        ├── Step1: callLLMWithTools()  →  解析 tool_calls
        │
        ├── 字段清洗：removeOrphanSourceFields / removeInventedPaymentFields
        │
        └── Step2: ToolRegistry.execute(tool, args)
                 │
                 ├── create_record / create_trip_record → 生成 ConfirmCard
                 ├── ask_follow_up                       → 生成 FollowUpCard
                 ├── correct_record                      → 低风险直接 update
                 │                                        / 高风险 CorrectionConfirmCard
                 └── render_stats / render_budget / query_records ...
        │
        ▼
  ChatStore：persistMessage()（持久化 _steps、llmMessages、record、result）
        │
        ▼
  用户操作：
        confirmRecord  → toolRegistry.execute('confirm_*') → invoke('create_record')
                         → 写入 SQLite → saveLearningIfNeeded
        cancelRecord   → message.data._cancelled = true → 持久化（写入"已取消"状态）
        editField      → 触发 applyFieldEdit
```

### 8.2 三层记忆

```
活跃上下文：AgentEngine.conversationHistory（最近 10 轮，刷新时从 chat_history 恢复）
        ↓
对话归档：chat_history 表（带 session_id，每次启动新 session）
        ↓
持久记忆：learning_data 表 + preferences markdown 文档
```

### 8.3 修正意图识别

`AgentEngine.needsHistoryContext` 检测关键词："上面"、"刚刚"、"那个"、"改成"、"不对"、"应该是"、"换成" 等，触发时注入对话历史摘要（优先使用 `lastConfirmedRecordContext` 结构化摘要，降级使用对话历史）。

---

## 9. NocoBase 同步机制

**设计决策与同步策略**请见 [docs/03-活跃设计文档.md §3 NocoBase 全量对比同步](docs/03-活跃设计文档.md#3-nocobase-全量对比同步)。

### 9.1 整体策略

| 操作 | records | business_trip | learning_data |
|---|---|---|---|
| `sync_full` | **全量对比**（双 HashMap）+ **删除策略** + 5 分钟冲突阈值 | 增量 pull + push | 增量 pull + push |
| `sync_push` | push_records | push_trips | push_learning |
| `sync_pull` | pull_records_only | pull_trips | pull_learning |

### 9.2 关键约束

- **重试上限**：所有 push 路径检查 `retry_count < 3`，失败 `mark_push_failure` 递增；用户编辑（`update_record` / `update_trip`）显式 `retry_count=0, last_error=NULL`。
- **删除策略**：`sync_full` 中本地有云端无的记录，若 `synced=1` 则**本地硬删**（认为云端被删除）；若 `synced=0 retry_count<3` 则 push；超限跳过。
- **冲突判定**：双 HashMap 比对时 `diff_seconds_remote_minus_local > 300s` → 用更新方覆盖另一侧。
- **空响应回退**：NocoBase update 对不存在 ID 仍返回 HTTP 200 但 `data: []`；同步逻辑检测空数组后回退为 create。
- **时间格式归一化**：所有比较前统一为 `YYYY-MM-DD HH:MM:SS` 本地时间。
- **过滤字段名**：发送给 NocoBase 的 filter 用数据库列名（下划线），不用 API 响应字段名（驼峰）。
- **业务字段剔除**：推送 `business_trip` 时剔除 `local_updated_at` / `synced` / `nocobase_id` / `nocobase_updated_at` 等本地专用字段。

### 9.3 本地删除

当前 `sync_push` **不处理**本地删除（硬删）的记录推送到 NocoBase，云端不会感知本地删除（除非走 `sync_full` 中的反向"云端被删→本地删"分支）。

---

## 10. OCR 子系统

**设计决策与 Python 管理**请见 [docs/03-活跃设计文档.md §2 OCR Python 管理重设计](docs/03-活跃设计文档.md#2-ocr-python-管理重设计)。

### 10.1 Python 探测与依赖

- 启动后调用 `check_ocr_status_fast`（不跑脚本，仅读配置）。
- 用户在 Settings 触发 `start_ocr_discover`：异步线程扫描系统 Python，emit `ocr_discover_result` 事件，前端展示候选列表。
- `select_python(path)` 校验版本 3.8–3.12 后将路径写入 `app_config.active_python_path`。
- 安装 PaddleOCR：`install_paddleocr_for_python` 流式 `ocr_install_log` 事件输出 pip 日志。
- 内置 Python：`install_bundled_python` 调用 `python_manager.{sh,ps1}`，下载/解压自带 Python。

### 10.2 识别流程

```
ChatInput 接收图片 →
  ocrRecognize(imageBase64) → invoke('ocr_recognize')
    → Rust 写临时 base64 文件
    → spawn(activePython, "-c", "import ocr_service; recognize_image(b64)")
    → 60s 超时
    → 返回 OCR 文本
  → 注入 AgentEngine.processMessage 的 input 拼接（text + OCR 文本）
```

---

## 11. 运行与构建方式

### 11.1 前置环境

- Node.js（package.json 兼容现代版本，推荐 ≥ 18）
- Rust 工具链（推荐 stable 最新版本，含 `cargo`）
- macOS：Xcode Command Line Tools；Windows：Visual Studio Build Tools
- 可选：Python 3.8–3.12（OCR 功能）；NocoBase 服务（同步功能）

### 11.2 开发命令

```bash
# 安装依赖
npm install

# 启动桌面应用（自动启动 Vite + Rust）
npm run dev          # = tauri dev，Tauri 会先运行 npm run dev:frontend (vite, 端口 5174)

# 仅启动前端 Vite（不打开桌面窗口，仅用于纯前端调试）
npm run dev:frontend

# 生产构建（先 vue-tsc 类型检查 + Vite 构建，再用 Tauri 打包）
npm run build        # 仅前端构建
npm run tauri build  # 完整桌面应用打包
```

### 11.3 首次运行配置

1. 在 Settings 页：
   - **AI 服务**：配置百炼或 OpenAI 兼容服务（`api_url` / `api_key` / `model`），点击「激活」+「测试连接」。
   - **NocoBase**（可选）：填入 `nocobase_url`、`nocobase_token`，触发 `nocobase_test_connection` 验证。
   - **OCR**（可选）：选择系统 Python 或安装内置 Python，安装 PaddleOCR，然后开启 `ocr_enabled`。
   - **预算**：设置 `budget_monthly`（默认 3500）。
2. 数据库位置：
   - **debug**：`<project>/database/app_data.db`
   - **release**：`~/Library/Application Support/accounting-app/app_data.db`（macOS） / 对应平台用户数据目录

### 11.4 测试与质量

- 类型检查：`npm run build` 中 `vue-tsc --noEmit` 会校验整个前端类型。
- Rust 端：可使用 `cargo check`、`cargo clippy`（无内置统一脚本，按需自行运行）。
- 跨平台验证：两端（macOS + Windows）均需 smoke test。

---

## 12. 关键工程约定

> 以下为 [AGENTS.md](file:///Users/szd/Documents/Code/accounting-app/AGENTS.md) 中的硬性约束摘要，开发与重构均需遵守。

### 12.1 Tauri 2 camelCase 序列化

Rust 函数 `datetime_gte: String` ↔ 前端 invoke 传 `{ datetimeGte: value }`。**绝不**使用 `snake_case` 键。`Option<T>` 参数用条件展开 `...(value ? { key: value } : {})`，不要传 `null`。

### 12.2 SQLite 时间格式

所有 TEXT 时间字段使用 `YYYY-MM-DD HH:MM:SS`（空格分隔、本地时区）；Rust 用 `chrono::Local::now().naive_local().format("%Y-%m-%d %H:%M:%S")` 生成；前端 `utils/dateRange.ts` 输出同格式。字符串字典序 = 时间顺序，可直接 `>=` 比较。

### 12.3 数据库与迁移

- 结构变更必须使用增量迁移（ALTER TABLE），**禁止** DROP TABLE 保留数据。
- SQLite ADD COLUMN 不支持非常量默认值，需两步迁移（先加列再 UPDATE）。
- 记录删除采用硬删除（无软删除标记）。
- 重复判定：`amount + type + datetime(精确到秒)` 完全一致。

### 12.4 同步与重试

- 推送须 `retry_count < 3`，超限跳过。
- 用户编辑记录时 `retry_count=0, last_error=NULL` 重置。
- 推送操作必须在 await 前显式释放数据库锁，防止阻塞。
- 查询未同步记录时必须把 `nocobase_id` 一并取出，减少 N+1。

### 12.5 NocoBase

- 时间戳归一化为 `YYYY-MM-DD HH:MM:SS` 后再比较。
- Filter 字段名使用数据库列名（下划线）。
- `business_trip` 推送必须剔除 `local_updated_at` / `synced` / `nocobase_id` / `nocobase_updated_at`。
- `local_updated_at` 是纯本地字段，禁止推送。
- update 响应可能是数组形式，需兼容解析。
- 对不存在 ID 的 update 返回 HTTP 200 + 空数据，必须检测后回退为 create。

### 12.6 LLM 字段来源 `_source`

每个字段必须附 `_source: extracted | inferred | default`，由 `AgentEngine.getFieldSource` 判定，`StepList` 据此显示。

### 12.7 UI 状态推导

- 已确认/已取消的记录消息均持久化到 `chat_history.data`，刷新后由 `data.result.success` 与 `data._cancelled` 推导显示状态。
- `ConfirmCard` 必须根据状态显示「已保存 / 已取消 / 请确认」标签。

### 12.8 文档先行

任何需求变更、架构调整、界面改动或代码修改，需先讨论确认并同步更新文档：
- 需求/架构 → `docs/01-项目概览.md`
- 开发计划 → `docs/02-开发路线图.md`
- 重构方案 → `docs/03-活跃设计文档.md`
- Agent 协作规范 → `AGENTS.md`

---

## 附录 A：典型调用链示例（"花了 35 块吃饭"）

```
1. ChatInput.vue
   .emit('send', '花了35块吃饭', undefined, undefined)
2. ChatStore.sendMessage('花了35块吃饭', ref)
3. AgentEngine.processMessage(text, undefined, onStep, { lastConfirmedRecord })
   a. loadContext() → 拼接 dispatch.md + preferences.md + learning_data
   b. callLLMWithTools(system, user, ToolRegistry.getTools())
   c. tool_calls = [{ name: 'create_record',
                       args: { amount: 35, amount_source: 'extracted',
                               category: '餐饮', category_source: 'inferred',
                               type: '支出', type_source: 'inferred',
                               account: '个人', account_source: 'default',
                               payment_method: '现金', payment_method_source: 'default',
                               datetime: '2026-06-24 12:34:56', datetime_source: 'default'
                             }}]
   d. ToolRegistry.execute('create_record', args)
      → ToolResult { action: 'confirm', render: 'confirmCard',
                      record: {...}, message: '请确认...' }
4. ChatStore 推送 ConfirmCard 到 messages, persistMessage()
5. 用户点击「确认」
   → ChatStore.confirmRecord(msg)
   → ToolRegistry.execute('confirm_record', record)
   → invoke('create_record', { fields: {...} })
   → Rust db::records::create_record → SQLite INSERT
   → 返回 RecordRow
   → saveLearningIfNeeded(原始, 修改后) 写入 learning_data
   → 持久化 message.data.result = { success: true, action: 'create_record' }
6. UI：ConfirmCard 切到「已保存」折叠态
```

---

## 附录 B：4 个事件名（前端 listen）

| 事件 | 来源 | 用途 |
|---|---|---|
| `app_log` | Rust `logger.rs` / 各命令 | DevConsole Rust 日志 tab |
| `ocr_install_log` | `ocr.rs` 安装/卸载/重装 PaddleOCR | Settings 流式日志显示 |
| `ocr_discover_result` | `ocr.rs::start_ocr_discover` 异步线程 | Settings 候选 Python 列表 |
| `records:highlight-duplicate` | `chat.ts::checkDuplicate` | `Records.vue` 闪烁高亮重复记录 |

---

## 附录 C：已知的潜在改进点

- `sync_push` 不会推送本地删除（硬删的记录无法通知云端），仅靠 `sync_full` 的反向同步策略可能造成不一致。

---

_文档版本：v1.0 ｜ 生成日期：2026-06-24 ｜ 基于代码状态：commit 当前 workspace_
