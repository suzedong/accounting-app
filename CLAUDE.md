# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

基于 NocoBase 的纯前端记账应用，原生 HTML/CSS/JS 无框架。用户通过浏览器访问 HTML 页面，数据通过 NocoBase REST API 存取到 PostgreSQL。

## 开发命令

```bash
# 启动本地服务器（端口 18080，提供静态文件 + API 代理 + AI 解析/分发代理）
cd web && python3 server.py 18080

# 浏览器访问
# http://localhost:18080/index.html        - 首页（快速记账 + 统计概览）
# http://localhost:18080/records.html      - 记录管理（增删改查 + 分页）
# http://localhost:18080/budget.html       - 预算管理
# http://localhost:18080/stats.html        - 统计分析（多维度图表）
# http://localhost:18080/trip_allowance.html - 差旅补助

# 数据迁移脚本
python3 scripts/create_collections.py       # 在 NocoBase 创建表结构
python3 scripts/migrate_to_nocobase.py      # SQLite → NocoBase
python3 scripts/migrate_nocobase_to_nocobase.py  # NocoBase 实例间迁移
```

## 架构概览

### 部署架构
```
浏览器 → 本地 Python server.py (localhost:18080) → 云端 NocoBase (121.17.49.100:13000)
                              │
                              ├─ 代理 /api/* 转发到 NocoBase
                              ├─ /api/ai/parse  → 阿里云百炼（记账解析）
                              └─ /api/ai/dispatch → 阿里云百炼（意图识别+参数提取）
```

本地 `server.py` 提供：
1. 静态文件服务（HTML/CSS/JS）
2. NocoBase API 代理：`/api/*` 转发
3. AI 代理：`/api/ai/parse`（纯记账解析）、`/api/ai/dispatch`（意图识别+Skill路由）

### 数据模型 (NocoBase Collections)

| Collection | 说明 | 关键字段 |
|---|---|---|
| `records` | 收支记录 | datetime, type, category, amount, account, note, payment_method |
| `categories` | 分类 | name, type(收入/支出), icon, color, sort_order |
| `accounts` | 账户 | name, balance, type, icon, color |
| `payment_methods` | 支付方式 | name, icon, color, sort_order |
| `business_trip` | 差旅补助 | trip_id, start_date, end_date, days, trip_allowance, transport_allowance, status |
| `budgets` | 预算 | month, amount, category |
| `learning_data` | AI 学习数据 | type, key, value(json), count, updated_at |

### 前端模块依赖和加载顺序

```
config.js → nocobase-api.js → utils.js → parse.js → ai-parser.js → learning-engine.js → agent-core.js → chat-widget.js → 页面脚本
```

| 文件 | 说明 |
|---|---|
| `web/static/config.js` | 配置中心：NocoBase API URL/Token、AI 配置、Collection 名称映射 |
| `web/static/nocobase-api.js` | NocoBase API 客户端 (IIFE)：`getRecords`, `createRecord`, `updateRecord`, `deleteRecord`, `getCategories`, `getAccounts`, `getPaymentMethods`, `getBusinessTrips`, `getRecordsForStats`, `getCollection`, `createRecordInCollection` |
| `web/static/utils.js` | 工具函数 + 统计计算：`formatMoney`, `formatDatetime`, `Paginator`, `statsByCategory`, `calcTotals`, `statsByAccount`, `analyzeBudget`, `monthlyBudgetStats`, `monthlyTrend`, `comparison`, `heatmapData`, `filterRecords`, `getDateRange` |
| `web/static/parse.js` | 自然语言规则解析器（降级方案）：关键词匹配提取金额/类型/分类/账户/支付方式/时间 |
| `web/static/ai-parser.js` | AI 解析器 (IIFE)：通过 `/api/ai/parse` 代理调用阿里云百炼（降级方案） |
| `web/static/learning-engine.js` | 学习引擎 (IIFE)：localStorage 管理用户修正数据，生成 Prompt 注入文本，NocoBase 同步 |
| `web/static/agent-core.js` | Agent 核心 (IIFE)：`AgentCore.dispatch(text)` 调用 LLM 意图识别，`AgentCore.execute(result)` 路由执行 Skill，`AgentCore.learn()` 记录学习 |
| `web/static/chat-widget.js` | AI 对话悬浮组件 (IIFE)：右下角弹窗，接入 AgentCore，支持自动保存/确认卡片/Skill 结果渲染 |

**Agent 工作流程**：
1. 用户输入 → `AgentCore.dispatch(text)` 调用 `/api/ai/dispatch`（LLM 意图识别 + 参数提取）
2. 根据 intent 路由：`record` → 解析记账 / `query` → 查询记录 / `stats` → 统计分析 / `budget` → 预算 / `chitchat` → 闲聊
3. 记账高置信度（≥0.85）自动保存，低置信度弹确认卡片
4. 用户修改字段时触发 `AgentCore.learn()` 记录学习数据
5. 下次 LLM 调用时学习数据注入 SYSTEM_PROMPT

**解析策略**：主流程由 LLM 通过 `/api/ai/dispatch` 完成意图识别和参数提取。`parse.js` 和 `ai-parser.js` 作为 LLM 失败时的降级方案保留。

### 统计模式

NocoBase 不提供 GROUP BY 聚合，所有统计在前端计算：
1. 通过 `getRecordsForStats()` 获取全量记录（`pageSize=10000`）
2. 在前端按日期/类型/分类过滤
3. 使用 `utils.js` 工具函数聚合

## 重要约定

- **Token 和配置** 同时存在于 `web/static/config.js`（前端）和 `web/server.py`（代理），修改需同步
- JWT Token 有效期 1 年（至 2027-05-05），到期后需更新两处
- 所有 API 调用通过相对路径 `/api/*`，由 `server.py` 代理转发
- `NocobaseAPI` 是全局 IIFE，通过 `NocobaseAPI.xxx()` 调用
- `AgentCore.dispatch()` 和 `AgentCore.execute()` 是 Agent 核心入口
- `LearningEngine.init()` 在每个页面加载时调用
- `ChatWidget.init()` 在页面加载时调用初始化 AI 对话悬浮窗
- HTML 页面内联了所有 CSS 和 JS（除引入的 static/ 文件），无构建步骤
- `web/chat.html` 已删除，功能由 `chat-widget.js` 悬浮窗统一提供
