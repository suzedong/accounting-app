# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

本地优先（Local-first）的桌面记账应用，基于 Tauri 2 + Vue 3 + SQLite。数据存储在本地 SQLite，可选与 NocoBase 双向同步。

- **代码**在 `src/`（Vue 3 前端）和 `src-tauri/`（Rust 后端）
- **开发命令**：`npm run dev`（启动 Tauri，前端 Vite + 后端 Rust）

### 功能模块

| 模块 | 状态 | 说明 |
|---|---|---|
| Tauri 骨架 + SQLite | ✅ 完成 | 数据库（7 张表）、CRUD、前端基础 |
| 业务逻辑 | ✅ 完成 | Rust commands 齐全（记录/差旅/统计），Vue 6 个页面 |
| AI 聊天 + Agent | ✅ 完成 | 百炼 API 直连、LLM dispatch、action handlers、ChatWidget、学习引擎、对话历史、OCR |
| NocoBase 同步 | ✅ 完成 | 双向同步（push/pull）、增量拉取 |

### 目录结构

```
src/              # Vue 3 前端（TypeScript + Element Plus + Pinia）
├── main.ts       # 入口
├── App.vue       # 根组件（Navbar + Router + ChatWidget）
├── router/       # 路由：/ /records /budget /stats /trips /settings
├── stores/       # Pinia 状态管理（records、chat、learning）
├── api/          # Tauri invoke 封装（tauri.ts）
├── types/        # TypeScript 类型定义（chat.ts 定义消息/步骤/状态接口）
├── utils/        # 工具函数（formatters, dateRange）
├── ai/           # AI 引擎层
│   ├── agent-engine.ts   # AgentEngine 单例：三阶段流水线（OCR→LLM意图识别→工具执行）
│   └── tool-registry.ts  # ToolRegistry：Zod schema → LLM Function Calling 工具注册
├── views/        # 页面组件（Home, Records, Budget, Stats, TripAllowance, Settings）
└── components/   # 共享组件
    ├── AppNavbar.vue           # 顶部导航栏
    ├── chat/                   # AI 对话组件
    │   ├── ChatWidget.vue      # 悬浮对话面板（主容器）
    │   ├── ChatInput.vue       # 输入框 + 图片上传/粘贴
    │   ├── ChatMessage.vue     # 消息渲染
    │   ├── ChatThinking.vue    # 思考中状态
    │   ├── ConfirmCard.vue     # AI 返回的记录/差旅确认卡片
    │   ├── FollowUpCard.vue    # AI 追问补充信息卡片
    │   ├── RecordCard.vue      # 已创建记录卡片（含修正/删除按钮）
    │   ├── CorrectionConfirmCard.vue # 高风险修正确认卡片
    │   ├── StepList.vue        # 推理链展示（含修正 diff）
    │   ├── ImagePreview.vue    # 图片预览（截图/上传）
    │   ├── SettingsPanel.vue   # 设置面板（Prompt/偏好/学习数据/诊断）
    │   └── DevConsole.vue      # 开发者控制台（IPC/LLM/Rust + 复制全部）
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
│   ├── python_manager.sh  # Python 发现 + PaddleOCR 依赖管理（macOS/Linux）
│   ├── python_manager.ps1 # Python 发现 + PaddleOCR 依赖管理（Windows）
│   └── ocr_service.py     # PaddleOCR 识别服务
└── prompts/      # AI 系统 Prompt
    ├── dispatch.md       # 分类识别表、支付方式、账户、类型判断、备注规则、OCR处理、追问规则
    ├── preferences.md    # 用户个性化偏好（默认账户、支付方式映射等）
    └── record.md         # 记录备注生成规则（商户名、堂食、外卖、话费等格式）

docs/             # 设计文档
│   ├── 01-project-overview.md     # 需求 + 架构 + UI
│   ├── 02-development-roadmap.md  # 开发计划（含本地 LLM 方案）
│   └── 03-active-design-docs.md   # 进行中的设计（Agent 重构 + OCR）
```

### 开发命令

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

#### LLM 字段来源标注（_source）

LLM 返回的每个参数字段必须附带 `_source` 标注，标识数据来源：

| source 值 | 含义 | 示例 |
|---|---|---|
| `extracted` | 用户输入中**明确提到**的值 | "花了35元" → `amount_source: "extracted"` |
| `inferred` | 根据上下文**推断**出的值 | "吃饭" → `category_source: "inferred"` |
| `default` | 系统**默认填充**的值 | 未提账户 → `account_source: "default"` |

前端 StepList 组件根据此值标注字段来源（绿色提取/蓝色推断/灰色默认）。

## Agent 架构（LLM Function Calling + Tool Registry）

### 核心设计

Agent 采用 **LLM Function Calling + 前端 Tool Registry** 的架构：

```
用户输入 ──▶ ChatWidget.vue ──▶ ChatStore.sendMessage()
                                     │
                              AgentEngine.processMessage()
                                     │
                          ┌──────────┼──────────┐
                          ▼          ▼          ▼
                     OCR 识别   意图识别    工具执行
                  (ocrRecognize) (LLM +    (ToolRegistry)
                                 Function
                                 Calling)
                          │
                          ▼
                   返回 ToolResult ──▶ ConfirmCard / FollowUpCard / RecordCard
                          │
                          ▼
                   用户确认 ──▶ toolRegistry.execute('confirm_...')
                          │
                          ▼
                   写入数据库 ──▶ 保存学习数据
```

### 核心模块

| 模块 | 文件 | 职责 |
|---|---|---|
| `AgentEngine` | `src/ai/agent-engine.ts` | 全局单例，两阶段流水线：① LLM 意图识别（Function Calling） 工具执行。负责加载上下文、构建 system message、调用 LLM、解析 tool_calls、清洗无效支付方式（用户未提及支付时自动删除 payment 字段）。OCR 在前端输入预处理阶段完成，不在 AgentEngine 中。 |
| `ToolRegistry` | `src/ai/tool-registry.ts` | 使用 Zod schema 注册工具，自动将 Zod schema 转为 JSON Schema 传给 LLM。执行工具时通过 runtime context 传递应用事实（`lastConfirmedRecord`），`correct_record` 按风险分级（低风险直接执行 / 高风险返回 CorrectionConfirmCard）。 |
| `ChatStore` | `src/stores/chat.ts` | Pinia store，管理消息列表、发送流程、确认/编辑/追问交互、持久化、学习去重、`lastConfirmedRecord`（跟踪最近一次用户确认的记录，用于"上一条"修正定位）。 |
| `ChatWidget` | `src/components/chat/ChatWidget.vue` | 主容器组件，悬浮按钮 + 侧边聊天面板。包含欢迎页、消息列表、设置对话框、修正确认卡片（CorrectionConfirmCard）。 |

### 注册的工具列表

| 工具 | 说明 | 对应 Handler |
|---|---|---|
| `create_record` | 创建记账记录 | 生成确认卡片 |
| `confirm_record` | 用户确认创建 | 写入数据库 + 保存学习数据 |
| `correct_record` | 纠正上一条记录（应用定位目标 + 风险分级） | 低风险直接执行 / 高风险返回修正确认卡 |
| `confirm_correction` | 确认高风险修正（仅由 UI 确认后调用） | 执行 updateRecord + 保存学习数据 |
| `update_record` | 按 ID 修改指定记录 | 生成修改确认卡片 |
| `query_records` | 查询记录列表 | 返回表格/列表结果 |
| `render_stats` | 渲染统计分析 | 调用统计命令 |
| `render_budget` | 渲染预算状态 | 计算预算执行情况 |
| `ask_follow_up` | 追问补充信息 | 生成 FollowUpCard |
| `reply_text` | 纯文本回复 | 直接显示文本 |
| `save_preference` | 保存用户偏好 | 写入 SQLite learning_data |
| `update_prompt` | 修改系统 dispatch prompt | 更新 system_prompts 表 |
| `clear_chat` | 清空对话历史 | 清空 chat_history 表 |
| `query_collection` | 查询任意集合 | 通用查询 |

**差旅补助相关工具**：

| 工具 | 说明 |
|---|---|
| `create_trip_record` | 创建差旅补助记录 |
| `confirm_trip_record` | 确认创建差旅补助 |
| `record_trip_payment` | 记录差旅补助支付 |
| `confirm_trip_payment` | 确认支付 |
| `update_trip_record` | 修改差旅补助记录 |
| `delete_trip_record` | 删除差旅补助记录 |

### Prompt 系统

SYSTEM_PROMPT 存储在 SQLite `system_prompts` 表中，文件缓存在 `src-tauri/prompts/` 目录：

| 文件 | 用途 |
|---|---|
| `dispatch.md` | 能力清单 + 意图识别规则 + 分类识别表 + 支付方式识别 + 账户识别 + OCR 处理规则 + 追问规则 + 字段来源标注规则 |
| `preferences.md` | 用户个性化偏好（默认账户、支付方式映射等），优先级高于系统默认 |
| `record.md` | 备注生成规则：商户名、堂食格式、外卖格式、话费格式等 |

### AgentEngine 工作流程

1. **加载上下文**：并行加载 dispatch prompt、用户偏好、学习纠正数据
2. **构建 System Message**：拼接 prompt + preferences + learning context
3. **OCR 阶段**（如果有图片）：调用 `ocrRecognize` 获取识别文本
4. **LLM 意图识别**：调用 `callLLMWithTools`（Function Calling），解析 tool_calls
5. **工具执行**：通过 `ToolRegistry.execute()` 路由到对应 handler
6. **用户确认**：生成 ConfirmCard/FollowUpCard，用户操作后执行确认或取消
7. **学习机制**：用户修正记录时自动保存学习数据，下次注入 system message

### 关键 API 函数（`src/api/tauri.ts`）

| 函数 | 调用的 Tauri Command |
|---|---|
| `getChatHistory(limit)` | `get_chat_history` |
| `saveChatMessage(role, content, data, skill, confidence)` | `save_chat_message` |
| `clearChatHistory()` | `clear_chat_history` |
| `callLLM(systemMessage, userMessage)` | `call_llm` |
| `callLLMWithTools(systemMessage, userMessage, toolsJson)` | `call_llm_with_tools` |
| `getSystemPrompt(name)` | `get_system_prompt` |
| `updateSystemPrompt(name, content)` | `update_system_prompt` |
| `updatePreference(key, value)` | `update_preference` |
| `getLearningCorrections()` | `get_learning_corrections` |
| `saveCorrection(keyword, field, value)` | `save_correction` |
| `deleteCorrection(id)` | `delete_correction` |
| `clearCorrections()` | `clear_corrections` |
| `ocrRecognize(imageBase64)` | `ocr_recognize` |

### 聊天组件清单

| 组件 | 作用 |
|---|---|
| `ChatWidget.vue` | 主容器：悬浮按钮 + 面板 + 欢迎页 + 消息列表 + 设置对话框 |
| `ChatInput.vue` | 输入框 + 图片上传/粘贴，通过 `@send` 事件发送 `(text, imageBase64, imageFullSrc)`；点击发送后立即进入本地处理态，禁用发送按钮，覆盖图片转码、OCR 检测和识别全过程 |
| `ChatMessage.vue` | 消息渲染组件 |
| `ChatThinking.vue` | 思考中状态指示器 |
| `ConfirmCard.vue` | 确认卡片：展示 AI 生成的记录/差旅补助，支持确认/修改/取消。待确认时显示"请确认（尚未保存）"标题；已确认/已取消时折叠头部显示状态（"已保存"/"已取消"），点击可展开/折叠 |
| `FollowUpCard.vue` | 追问卡片：AI 缺少必要信息时展示，提供字段按钮供用户选择 |
| `RecordCard.vue` | 记录卡片：展示已创建的记账记录，含修正/删除按钮 |
| `CorrectionConfirmCard.vue` | 高风险修正确认卡片：展示目标记录、修改 diff、风险原因 |
| `StepList.vue` | 推理链：逐步展示 OCR 识别→意图识别→字段提取→执行过程；确认记录后仍保留意图气泡，不因保存成功隐藏 |
| `ImagePreview.vue` | 图片预览：支持截图/上传预览，可移除和 OCR 加载状态覆盖 |
| `SettingsPanel.vue` | 设置面板：4 个 Tab（Dispatch Prompt 编辑、偏好编辑、学习数据表格、系统诊断） |
| `DevConsole.vue` | 开发者控制台：3 个 Tab（IPC 调用日志、LLM 请求日志、Rust 端日志） |

### ChatStore 核心方法

| 方法 | 作用 |
|---|---|
| `loadHistory()` | 从 API 加载历史消息，恢复 Agent 上下文（`restoreContext`） |
| `sendMessage()` | 主流程：调用 `agentEngine.processMessage()`，处理步骤回调，根据 action 路由 |
| `confirmRecord()` | 确认后执行 `toolRegistry.execute('confirm_...', record)`，触发学习保存 |
| `cancelRecord()` | 取消创建记录 |
| `startEditField()` / `applyFieldEdit()` | 字段编辑交互 |
| `answerFollowUp()` | 回答 AI 追问 |
| `persistMessage()` | 将消息写入数据库（存储 LLM 消息 + 推理步骤 + 操作结果） |
| `checkDuplicate()` / `saveLearningIfNeeded()` | 去重和学习机制 |
| `clearHistory()` | 清空本地消息 + 调用后端 + 清空 agentEngine |

## Agent Session 架构

**核心原则：存储事实，UI 状态从事实推导。**

### 数据持久化结构（`chat_history.data`）

```typescript
interface PersistedChatData {
  llmMessages?: LLMMessage[];  // 对话上下文，用于刷新后恢复
  _steps?: Step[];             // 推理步骤，用于历史消息展示思考过程
  record?: Record<string, unknown>;  // 记录字段（卡片展示）
  result?: { success: boolean; action?: string; message?: string }; // 操作结果
  correction?: {...};          // 修正相关数据
  followUp?: {...};            // 追问相关数据
}
```

### 三层记忆架构

```
┌─────────────────────────────────────────
│  1. 活跃上下文 (Active Context)           │
│  - AgentEngine.conversationHistory       │
│  - 最近 10 轮 LLM 消息                    │
│  - 刷新时从数据库恢复                     │
├─────────────────────────────────────────┤
│  2. 对话归档 (Conversation Archive)       │
│  - chat_history 表，带 session_id         │
│  - 完整历史记录                           │
├─────────────────────────────────────────┤
│  3. 持久记忆 (Persistent Memory)          │
│  - learning_data 表                       │
│  - user preferences                       │
└─────────────────────────────────────────┘
```

### 关键设计

| 设计点 | 说明 |
|---|---|
| session_id | 应用每次启动生成新的，格式 `session_{timestamp}_{random}` |
| 上下文恢复 | `loadHistory()` 提取 `llmMessages` → `agentEngine.restoreContext()` |
| UI 状态推导 | 从 `data.result` 和 `data.record` 推导 `status`（pending/confirmed） |
| 推理步骤 | 存储 `_steps` 在 data 字段中，历史加载时恢复 |
| 支付默认值 | 用户未提及支付方式时默认"现金"，标注 source=default，需用户确认 |
| 支付字段显示 | 所有卡片（ConfirmCard/RecordCard/CorrectionConfirmCard）始终显示支付 |

## 数据模型

| 表名 | 说明 | 关键字段 |
|---|---|---|
| `records` | 收支记录 | uuid, datetime, type, category, amount, account, note, payment_method, synced, nocobase_id |
| `business_trip` | 差旅补助 | uuid, trip_id, start_date, end_date, days, trip_allowance, transport_allowance, status |
| `system_prompts` | AI 提示词 | name (dispatch/record), content, updated_at |
| `learning_data` | 学习数据 | uuid, type, key, value(json), count |
| `chat_history` | 对话历史 | session_id, role, content, data(json: llmMessages/_steps/record/result) |
| `sync_log` | 同步日志 | direction, collection, status, count, error |
| `app_config` | 应用配置 | key (ai_services), value(json) |

> 注意：无 `accounts`、`budgets`、`categories`、`payment_methods` 独立表，均作为自由文本字段存储。

## 重要约定

- 所有 API 调用通过 Tauri `invoke()` 调用 Rust commands
- `AgentEngine`（`src/ai/agent-engine.ts`）是 Agent 核心入口，通过 `processMessage()` 处理用户消息
- `ToolRegistry`（`src/ai/tool-registry.ts`）注册所有 LLM 可调用的工具，使用 Zod schema 定义
- `ChatWidget` 在 `App.vue` 中全局挂载，所有页面均可唤起 AI 对话
- 开发使用 `npm run dev`（Tauri 开发模式），构建使用 `npm run build` 输出到 `dist/`
- AI 配置（API Key、模型等）通过 Settings 页 UI 存入 SQLite `app_config` 表
