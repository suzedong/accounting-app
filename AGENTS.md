# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ 当前状态：重构进行中（新旧架构并存）

项目正在从**旧架构**（纯前端 HTML/JS + Python server.py + NocoBase REST API）重构为**新架构**（Tauri 2 桌面应用 + Vue 3 + SQLite 本地数据库 + NocoBase 可选同步）。

- **新架构代码**在 `src/`（Vue 3 前端）和 `src-tauri/`（Rust 后端） — 主要开发目标
- **旧架构代码**仍存在于 `web/`、`server/`、`.env`、`vite.config.js` — 仍在重构中，暂不删除

### 完成度

| 阶段 | 状态 | 说明 |
|---|---|---|
| Phase 1: Tauri 骨架 + SQLite | ✅ 已完成 | 数据库、CRUD、前端基础 |
| Phase 2: 业务逻辑迁移 | ✅ 已完成 | Rust commands 齐全，Vue 6 个页面（首页含账户分析+预算执行）全部可用 |
| Phase 3: AI 聊天 + Agent | ✅ 已完成 | 11 个 action handlers，OCR，聊天 UI |
| Phase 4: 同步层 + 清理 | ❌ 未开始 | push/pull/import 占位，server.py 待删除 |

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
**例外**：`Option<T>` 参数应使用条件展开 `...(value ? { key: value } : {})` 而非传 `null`。

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

### 新架构目录

```
src/              # Vue 3 前端（TypeScript + Element Plus + Pinia）
├── main.ts       # 入口
├── App.vue       # 根组件（Navbar + Router + ChatWidget）
├── router/       # 路由：/ /records /budget /stats /trips /settings
├── stores/       # Pinia 状态管理（records, chat, learning）
├── api/          # Tauri invoke 封装（tauri.ts）
├── types/        # TypeScript 类型定义
├── utils/        # 工具函数（formatters, dateRange, stats, keywords）
├── views/        # 页面组件（Home, Records, Budget, Stats, TripAllowance, Settings）
└── components/   # 共享组件
    ├── chat/     # ChatWidget, ChatMessage, ChatInput, RecordCard, 等
    └── stats/    # 统计图表（AccountPieChart, CategoryBarChart, 等）

src-tauri/        # Rust 后端（Tauri 2 + SQLite）
├── Cargo.toml
├── tauri.conf.json
├── capabilities/
└── src/
    ├── main.rs   # Tauri 入口，注册所有 commands
    ├── commands/ # Tauri Commands（records, trips, stats, sync, chat, config, ocr, 等）
    ├── db/       # SQLite 数据库（schema, CRUD, 聚合查询）
    ├── ocr/      # OCR 引擎（macOS 快捷指令 + 跨平台占位）
    └── models/   # 数据模型

web/              # 旧前端（HTML/JS，重构中保留，最终会删除）
server/           # 旧后端（Python server.py，重构中保留，最终会删除）
doc/              # 设计文档和开发计划
```

---

## 旧架构参考（保留作重构参考）

基于 NocoBase 的纯前端记账应用，原生 HTML/CSS/JS 无框架。用户通过浏览器访问 HTML 页面，数据通过 NocoBase REST API 存取到 PostgreSQL。

### 旧开发命令（已废弃，仅供了解历史）

```bash
npm run dev          # Vite HMR + API 代理（端口 5174）
npm run build        # 构建到 dist/
cd server && python3 server.py 18080   # 旧 Python 服务器
```

### 旧架构概览

```
浏览器 → Vite dev server (5174) ──→ server.py (18080) ──→ 云端 NocoBase
                         │                 │
                         ├─ HMR + ESM      ├─ 代理 /api/* → NocoBase
                         └─ proxy /api/* ──┤─ /api/ai/parse → 百炼
                                           └─ /api/ai/dispatch → 百炼
```

### Agent 架构（LLM 驱动 + Action 注册制）

用户输入 → LLM dispatch → { action, params, render, title, confidence }
         → 前端 actionHandlers 注册表 → 执行 handler → 按 render 类型渲染

### Action 列表

| Action | 说明 | 新架构 handler |
|---|---|---|
| `create_record` | 创建记账记录 | ✅ handleCreateRecord |
| `correct_record` | 纠正记录 | ✅ handleCorrectRecord |
| `update_record` | 修改记录 | ✅ handleUpdateRecord |
| `query_records` | 查询记录 | ✅ handleQueryRecords |
| `render_stats` | 统计结果 | ✅ handleRenderStats |
| `render_budget` | 预算状态 | ✅ handleRenderBudget |
| `save_preference` | 保存偏好 | ✅ handleSavePreference |
| `update_prompt` | 修改 prompt | ✅ handleUpdatePrompt |
| `ask_follow_up` | 追问 | ✅ handleAskFollowUp |
| `reply_text` | 纯文本 | ✅ handleReplyText |
| `clear_chat` | 清空历史 | ✅ handleClearChat |

### 数据模型（NocoBase Collections → SQLite 迁移对照）

| NocoBase Collection | SQLite 表 | 说明 |
|---|---|---|
| `records` | `records` | 收支记录 |
| `business_trip` | `business_trip` | 差旅补助 |
| `budgets` | `budgets` | 预算 |
| `learning_data` | `learning_data` | AI 学习数据 |
| `system_prompts` | `system_prompts` | 系统 Prompt |
| `user_preferences` | `user_preferences` | 用户偏好 |
| `chat_history` | `chat_history` | 对话历史 |
| — | `app_config` | 应用配置（AI Key, NocoBase URL 等） |
| — | `sync_log` | 同步日志 |
