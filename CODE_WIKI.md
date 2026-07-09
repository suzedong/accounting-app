# Accounting-App Code Wiki

> 本地优先（Local-first）的 AI 桌面记账应用。基于 **Tauri 2 + Vue 3 + libSQL (SQLite)**，集成阿里云百炼 LLM Function Calling、PaddleOCR 票据识别；数据同步走 **Turso Embedded Replica**（libSQL 内建双向同步）。

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
9. [Turso 同步机制](#9-turso-同步机制)
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
│    config[LLM + Turso] / ocr)                                           │
│         │                                                               │
│         ├──► db/ (libsql 0.9, async, WAL)                               │
│         │       connection.rs · schema.rs · records.rs · trips.rs ·     │
│         │       prompts.rs · learning.rs · chat_history.rs              │
│         │                                                               │
│         ├──► libsql Embedded Replica ─── db.sync() ──► Turso 云端        │
│         │                                                               │
│         ├──► HTTP → 阿里云百炼 / OpenAI 兼容 LLM (call_llm_with_tools)   │
│         │                                                               │
│         └──► Python 子进程 → PaddleOCR (ocr_recognize)                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                              ▲                         ▲
                              │                         │
                  本地 SQLite 副本                Turso 云端（libSQL）
                  app_data.db (WAL)              双向增量同步（Embedded Replica）
```

**核心思想**：
- **数据持久化在 Rust + libSQL**：所有领域操作（CRUD、统计、LLM 调用）都通过 Tauri `invoke()` 走 Rust 异步接口。
- **同步由 libSQL 内建提供**：应用启动时若配置了 Turso URL/Token 且开关打开，则以 Embedded Replica 打开数据库；`db.sync()` 触发双向增量同步，本地始终保留完整副本以支持离线。
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
| `libsql@0.9`（`core` / `replication` / `remote`） | 异步 SQLite 客户端 + Turso Embedded Replica |
| `chrono@0.4` | 时间处理（本地时间戳生成） |
| `serde` / `serde_json` | JSON 序列化 |
| `uuid@1`（v4） | 记录 UUID |
| `reqwest@0.12`（`json`） | 调用 LLM 与 Turso `/health` 探测 |
| `tokio@1`（`full`） | 异步运行时 |
| `dirs@5` | 用户数据目录 |

> `rusqlite` / `urlencoding` / `log` 已在 Phase 2 架构切换中移除；`db/nocobase/` 子模块与 `commands/sync.rs` 全部删除。

### 外部服务/工具
- **阿里云百炼**（或任意 OpenAI 兼容 `/v1/chat/completions`）— Function Calling
- **Turso**（libSQL 托管）— Embedded Replica 双向同步（可选，无配置时纯本地）
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
        ├── main.rs          # invoke_handler! 注册所有命令；async 启动 + Turso 分支
        ├── logger.rs
        ├── commands/        # 8 个命令模块（records/trips/stats/prompts/learning/chat/config/ocr）
        ├── db/              # libsql 业务逻辑（无 NocoBase 子模块）
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
Sync        syncTurso / testTursoConnection
```

> 原 `syncFull / syncPush / syncPull / getSyncLogs` 4 个包装已于阶段 3 一并移除。

### 5.5 Views

| 文件 | 职责 |
|---|---|
| [Home.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/Home.vue) | 首页仪表盘：本月支出/收入/结余三卡 + 类别 / 账户分析格栅 |
| [Records.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/Records.vue) | 记录列表：筛选（类型/账户/日期） + 新增/编辑对话框；监听 `records:highlight-duplicate` 高亮闪烁重复记录 |
| [Budget.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/Budget.vue) | 预算管理：月度预算进度条（超支/紧张/正常），可修改月度预算（`account='个人'` 口径） |
| [Stats.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/Stats.vue) | 统计：周期切换 + 4 个图表（分类排行 / 账户 / 趋势 / 对比） |
| [TripAllowance.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/TripAllowance.vue) | 差旅补助：状态筛选、补助总额/已发/待发/记录数 + CRUD + 发放 |
| [Settings.vue](file:///Users/szd/Documents/Code/accounting-app/src/views/Settings.vue) | 设置：AI 服务多实例（激活、连接测试） + Prompt 编辑 + Turso 云同步（URL/Token/启用开关/测试连接/立即同步） + OCR/Python 管理 + 数据库路径 |

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

`fn main()`（同步入口）通过 `tauri::async_runtime::block_on` 完成数据库初始化：

1. **Step 1** — 用 `db::Database::new().await` 打开纯本地 libsql 数据库，并读取 `app_config` 表中的 `turso_sync_enabled` / `turso_url` / `turso_token` 三项配置。
2. **Step 2** — 若三者齐备且启用，重新调用 `db::Database::new_with_turso(url, token).await` 打开为 **Embedded Replica**（内部走 `libsql::Builder::new_remote_replica`）；失败则回退纯本地。
3. **Step 3** — `commands::config::AppConfig::new(&database).await` 把 `app_config` 载入内存 `Mutex<HashMap>`。
4. **Step 4** — 构造 `tauri::Builder`：注入 `Database` 与 `AppConfig` 为 `State`；初始化日志文件、emit 启动 `app_log` 事件；启用 `tauri_plugin_shell`。
5. **Step 5** — `invoke_handler!` 注册全部命令。

Schema 初始化在 `Database::init_and_wrap` 内完成：`PRAGMA journal_mode=WAL; foreign_keys=ON;` → `schema::init(&conn).await`（含 chat_history 结构迁移、prompts 覆盖、seed 默认 `app_config`：`ocr_enabled=true`、`budget_monthly=3500.0`、`turso_sync_enabled=false`、`turso_url=""`、`turso_token=""`）。

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
| Turso Sync | `sync_turso` `test_turso_connection` |
| OCR | `check_ocr_status` `check_ocr_status_fast` `start_ocr_discover` `select_python` `install_ocr_dependencies` `install_paddleocr_for_python` `uninstall_paddleocr_for_python` `reinstall_paddleocr_for_python` `set_ocr_enabled` `ocr_recognize` `install_bundled_python` `uninstall_bundled_python` `reinstall_bundled_python` |

> 原 `nocobase_test_connection` / `sync_push` / `sync_pull` / `sync_full` / `get_sync_logs` 5 个命令已删除。

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
- **Turso 同步**：
  - `sync_turso()` — 调用 `Database::sync()` 触发一次 libsql Embedded Replica 双向同步；纯本地模式下会得到 libsql 底层错误并透传。
  - `test_turso_connection(url, token)` — 把 `libsql://` 替换为 `https://`，`GET {base}/health` 并带 `Authorization: Bearer <token>`，作为可达性探测；不打开 replica，不改动本地文件。
- `AllConfig` 结构含 `budget_monthly / turso_sync_enabled / turso_url / turso_token` 4 个字段（供 `get_all_config` 返回给前端）。
- `open_folder` 跨平台调用 `explorer/open/xdg-open`。

#### `ocr.rs`
管理 OCR 子进程：
- 探测 Python（`SystemPython`：path、version、is_compatible 3.8–3.12、has_paddleocr）。
- `start_ocr_discover` 异步线程发出 `ocr_discover_result` 事件。
- 安装/卸载/重装 PaddleOCR：逐行流式输出 `ocr_install_log` 事件，含心跳。
- 内置 Python：`install/uninstall/reinstall_bundled_python` 调用 `scripts/python_manager.{sh,ps1}`。
- 识别：`ocr_recognize(image_base64)` 写临时 base64 文件，调 `import ocr_service; recognize_image(b64)`，60s 超时。

#### Turso 同步（config.rs）

见上文 `config.rs` 段落对 `sync_turso` / `test_turso_connection` 的说明。**没有独立 `sync.rs`**：libSQL Embedded Replica 直接由 `Database::sync()` 完成双向同步，业务代码不再手写 push/pull/冲突判定。

### 6.4 db 模块要点

| 文件 | 职责 |
|---|---|
| `connection.rs` | `Database { inner: Arc<libsql::Database> }`；libsql 连接自身 `Clone + Send + Sync`，`get_conn()` 每次返回新句柄。提供 `new()`（纯本地）与 `new_with_turso(url, token)`（Embedded Replica，`Builder::new_remote_replica`）两种打开方式；`sync()` 触发双向增量同步。debug 模式数据库存 `<project>/database/app_data.db`，release 存 `~/Library/Application Support/accounting-app/app_data.db`；启用 WAL + 外键 |
| `schema.rs` | 创建 6 张业务表（`records / business_trip / learning_data / system_prompts / chat_history / app_config`）+ 内置迁移（`migrate_chat_history`、`business_trip` 的 destination/employee_name/reason 列删除、date 时间戳截断、status emoji 迁移）；启动时用 `include_str!("../../prompts/dispatch.md")` **强制覆盖** dispatch prompt；首次启动 seed preferences；清理废弃 `user_preferences`、`record` prompt、旧版 correction；`seed_default_config` 写入 `ocr_enabled=true`、`budget_monthly=3500.0`、`turso_sync_enabled=false`、`turso_url=""`、`turso_token=""` |
| `records.rs` | `RecordInput / RecordUpdateInput / RecordRow`；`get_records`（分页 + 过滤 + 排序 + COUNT(*)）、`create/update/delete`；`INSERT/UPDATE` 时用 Rust 侧 `chrono::Local` 生成 `created_at` |
| `trips.rs` | `TripInput / TripUpdateInput / TripRow`；`create_trip` 自动计算 `trip_allowance=days*100`、`transport_allowance=days*30`、`total`；`update_trip` 在 `days` 变化时重算三项金额 |
| `prompts.rs` | `PromptRow`；`get_prompt / update_prompt`（UPSERT）；`update_preference_in_doc` 行级替换 |
| `learning.rs` | `LearningCorrection { id, keyword, field, value }`，key 拆 `keyword|field`，兼容旧无 `|` 格式 |
| `chat_history.rs` | `ChatMessageRow / ChatMessageInput`；`save_message` 含取消态合并；`get_history(limit)` 按 `created_at DESC`；`get_sessions(limit)` 按 session 聚合 |

> 已删除：`db/nocobase/`（client / push / pull / trip_sync / learning_sync）、`db/sync_log.rs`、`db/preferences.rs`。相关 rusqlite Mutex 锁体系随之消失。

### 6.5 models（`src-tauri/src/models/mod.rs`）

仅一个跨域共享模型：

```rust
pub struct AiService { id, name, api_url, api_key, model, active }
```

其余领域模型分散在各 `db/*.rs`、`commands/*.rs` 内。

### 6.6 Tauri 配置

[tauri.conf.json](file:///Users/szd/Documents/Code/accounting-app/src-tauri/tauri.conf.json)：
- `productName = "AI 记账"`，`identifier = "com.accounting-app.app"`
- `devUrl = http://localhost:5174`，`frontendDist = ../dist`
- `beforeDevCommand = npm run dev:frontend`、`beforeBuildCommand = npm run build`
- 窗口 1200×800，最小 900×600
- CSP：`default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self'; connect-src 'self' https: http:; font-src 'self' https:;`（允许 LLM 与 Turso 直连，可为 http 局域网）
- `tauri-plugin-shell`：`"open": true`

[capabilities/default.json](file:///Users/szd/Documents/Code/accounting-app/src-tauri/capabilities/default.json)：仅 `main` 窗口、`local=true`，授予 `shell:allow-open` + `core:event:default`（前端订阅 `app_log` / `ocr_install_log` / `ocr_discover_result` 事件必需）。

---

## 7. 数据模型与数据库

### 7.1 7 张 SQLite 表

| 表 | 说明 | 关键字段 |
|---|---|---|
| `records` | 收支记录 | `uuid`, `datetime`, `type`, `category`, `amount`, `account`, `note`, `payment_method`, `created_at` |
| `business_trip` | 差旅补助 | `uuid`, `trip_id`, `start_date`, `end_date`, `days`, `trip_allowance`, `transport_allowance`, `total`, `status`, `paid_trip_allowance`, `paid_transport_allowance`, `paid_date`, `notes`, `created_at` |
| `system_prompts` | AI Prompt | `name`（dispatch / preferences）, `content`, `updated_at` |
| `learning_data` | 学习/纠错数据 | `uuid`, `type`（'correction'）, `key`（`keyword\|field`）, `value`(json), `count`, `created_at` |
| `chat_history` | 对话历史 | `uuid`, `session_id`, `role`, `content`, `data`(json: `llmMessages` / `_steps` / `record` / `result` / `_cancelled`), `created_at` |
| `app_config` | 应用配置 | `key`（`ai_services` / `budget_monthly` / `ocr_enabled` / `active_python_path_macos` / `active_python_path_windows` / `turso_sync_enabled` / `turso_url` / `turso_token` / `last_confirmed_ttl_minutes` / `force_confirm_corrections` …）, `value`(json/string) |

> **不存在**独立的 `accounts`、`budgets`、`categories`、`payment_methods` 表，均作为记录的自由文本字段使用。
>
> **NocoBase 遗留结构已清理**（2026-07-09）：三张业务表中的 `synced / nocobase_id / nocobase_updated_at / local_updated_at / retry_count / last_error` 六列以及 `sync_log` 表已从本地 SQLite 与 Turso 云端一并删除。清理脚本：[`scripts/cleanup-nocobase-legacy/`](../scripts/cleanup-nocobase-legacy/README.md)。

### 7.2 时间字段格式约定

| 字段 | 格式 | 说明 |
|---|---|---|
| `datetime`、`created_at`、`updated_at` | `YYYY-MM-DD HH:MM:SS`（**本地时区**，空格分隔） | SQLite TEXT 存储；字符串字典序 = 时间顺序，可直接 `>=` 比较；Rust 侧统一用 `chrono::Local::now().naive_local().format("%Y-%m-%d %H:%M:%S")` 生成 |
| `paid_date`、`start_date`、`end_date` | `YYYY-MM-DD` | 纯日期 |

> `CREATE TABLE` 保留 `DEFAULT (datetime('now', 'localtime'))` 作为兜底；**业务写入不依赖它**，一律显式 bind 参数以规避 libsql 与 SQLite 引擎不同版本对默认值执行时机的差异。

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

## 9. Turso 同步机制

**设计决策与阶段迁移记录**请见 [docs/02-开发路线图.md §Phase 4.6 同步后端迁移](docs/02-开发路线图.md#46-同步后端迁移nocobase--tursolibsql)。

### 9.1 架构总览

```
                   本地 app_data.db (libsql)  ────►  Turso 云端 libSQL
                        │                                 ▲
   业务 CRUD ───────────┤                                 │
                        │                                 │
                        └──── db.sync() ──────────────────┘
                             （双向增量、幂等）
```

- 本地始终保留完整 SQLite 副本，业务读写全部走本地 → **离线可用**
- 同步方向：**双向**（本地→云端 + 云端→本地），由 libsql 内部处理冲突（基于其内建 CRDT/frame 机制）
- 触发方式：
  1. **启动时不触发**（`new_with_turso` 只 open replica，不 `sync()`）——避免启动阻塞与 `database is locked` 竞争
  2. **主界面挂载后 3s 延迟触发**（Home.vue `scheduleBackgroundSync()`）：静默 `sync_turso`；成功后 `loadData()` 静默刷新首页数据 + toast 提示（有新数据/无新数据不同文案）
  3. **用户手动点击「立即同步」**（Settings → 数据同步）

### 9.2 配置项（`app_config` 表）

| Key | 类型 | 默认 | 说明 |
|---|---|---|---|
| `turso_sync_enabled` | `"true"` / `"false"`（历史上也接受 `"1"` / `"0"`） | `"false"` | 启动时决定是否以 Embedded Replica 打开数据库；关闭时纯本地模式 |
| `turso_url` | libsql:// URL | `""` | 例：`libsql://accounting-user.turso.io` |
| `turso_token` | Bearer JWT | `""` | 由 `turso db tokens create` 生成 |

**修改配置后必须重启应用**：`main.rs` 只在启动阶段读取一次；Settings 页面保存后会 `ElMessage.success('...重启应用后生效')` 提示用户。

### 9.3 相关 Tauri commands

| 命令 | 行为 |
|---|---|
| `sync_turso()` | 调用 `Database::sync().await`（libsql `db.inner.sync()`）触发一次双向同步；纯本地模式下会得到 libsql 底层错误，透传给前端 |
| `test_turso_connection(url, token)` | 把 `libsql://` 替换为 `https://`，`GET {base}/health` 并带 `Authorization: Bearer <token>`；只做可达性探测，**不打开 replica、不改动本地数据库文件** |

### 9.4 一次性数据迁移

从 NocoBase / 旧本地库迁移到 Turso 云端使用独立 Node 脚本 [`scripts/migrate-to-turso/`](scripts/migrate-to-turso/README.md)：
- `better-sqlite3` 只读打开本地库，`@libsql/client` 写入 Turso
- 自动剔除 NocoBase 遗留列
- `--dry-run` 预演、`--drop` 推倒重建、`--verify` 抽样校验
- `INSERT OR IGNORE` 按 `uuid` 幂等，可重复执行

---

## 10. OCR 子系统

**设计决策与 Python 管理**请见 [docs/03-活跃设计文档.md §2 OCR Python 管理重设计](docs/03-活跃设计文档.md#2-ocr-python-管理重设计)。

### 10.1 Python 探测与依赖

- 启动后调用 `check_ocr_status_fast`（不跑脚本，仅读配置）。
- 用户在 Settings 触发 `start_ocr_discover`：异步线程扫描系统 Python，emit `ocr_discover_result` 事件，前端展示候选列表。
- `select_python(path)` 校验版本 3.8–3.12 后将路径写入 `app_config.active_python_path_<os>`（macOS 用 `_macos`，Windows 用 `_windows`；平台相关 key 避免 Turso 同步时互相覆盖）。旧的单一 `active_python_path` key 在 `AppConfig::new` 启动时自动迁移到当前平台的新 key。
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
- 可选：Python 3.8–3.12（OCR 功能）；Turso 账号 + libSQL 数据库（云同步功能，见 [scripts/migrate-to-turso/README.md](scripts/migrate-to-turso/README.md)）

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
   - **数据同步 → Turso 云同步**（可选）：填入 `turso_url`（`libsql://...`）与 `turso_token`（`turso db tokens create` 生成），点击「测试连接」验证；打开「启用同步」开关；**重启应用**后进入 Embedded Replica 模式；此后可点击「立即同步一次」按钮触发 `db.sync()`。
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

所有 TEXT 时间字段使用 `YYYY-MM-DD HH:MM:SS`（空格分隔、本地时区）；Rust 用 `chrono::Local::now().naive_local().format("%Y-%m-%d %H:%M:%S")` 生成并显式 bind 参数；前端 `utils/dateRange.ts` 输出同格式。字符串字典序 = 时间顺序，可直接 `>=` 比较。`CREATE TABLE` 中的 `DEFAULT (datetime('now', 'localtime'))` 仅作兜底，业务写入不依赖。

### 12.3 数据库与迁移

- 结构变更必须使用增量迁移（ALTER TABLE），**禁止** DROP TABLE 保留数据。
- SQLite ADD COLUMN 不支持非常量默认值，需两步迁移（先加列再 UPDATE）。
- 记录删除采用硬删除（无软删除标记）。
- 重复判定：`amount + type + datetime(精确到秒)` 完全一致。
- NocoBase 遗留结构（6 列 + `sync_log` 表）已于 2026-07-09 通过 `scripts/cleanup-nocobase-legacy/` 从本地与 Turso 云端一并清理，schema 与业务代码均不再包含。

### 12.4 Turso 同步

- 同步仅通过 libSQL Embedded Replica 提供；触发只走 `sync_turso` command（`Database::sync()`）
- 配置存 `app_config`：`turso_sync_enabled` / `turso_url` / `turso_token`
- 修改配置后**必须重启**才能生效（`main.rs` 只在启动阶段读取）
- 禁止在业务 CRUD 命令内隐式触发同步；禁止新增手写 HTTP 同步逻辑
- 连接测试用 `test_turso_connection`：`libsql://` → `https://`，GET `/health`

### 12.5 LLM 字段来源 `_source`

每个字段必须附 `_source: extracted | inferred | default`，由 `AgentEngine.getFieldSource` 判定，`StepList` 据此显示。

### 12.6 UI 状态推导

- 已确认/已取消的记录消息均持久化到 `chat_history.data`，刷新后由 `data.result.success` 与 `data._cancelled` 推导显示状态。
- `ConfirmCard` 必须根据状态显示「已保存 / 已取消 / 请确认」标签。

### 12.7 文档先行

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

- Turso 目前只有 "启动后 3s 延迟一次同步 + 手动同步" 两种触发；后续可考虑写后延迟同步、周期同步、多窗口 Broadcast 通道等。

---

_文档版本：v2.0 ｜ 生成日期：2026-07-09 ｜ 基于代码状态：libsql 架构切换完成、Turso 同步启用_
