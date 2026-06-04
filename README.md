# 记账本应用

本地优先（Local-first）的桌面记账应用，基于 Tauri 2 + Vue 3 + SQLite。

- **开发**：`npm run dev` → Tauri 桌面应用
- **构建**：`npm run build`
- **数据**：本地 SQLite，可选与 NocoBase 双向同步

## 核心功能

- AI 对话记账（自然语言输入 → 意图识别 → 创建记录）
- 记录管理（增删改查 + 分页 + 筛选）
- 预算管理（月度预算跟踪 + 超支预警）
- 统计分析（多维度图表：分类、账户、趋势、对比）
- 差旅补助（出差记录 + 补助发放 + 金额匹配）
- OCR 识别（PaddleOCR 图片识别 → 自动记账）
- 学习引擎（用户修正 → 个性化规则）
- 数据同步（本地 ↔ NocoBase 双向同步）

## 技术栈

| 组件 | 技术 |
|---|---|
| 框架 | Tauri 2 (Rust 后端 + WebView 前端) |
| 前端 | Vue 3 + TypeScript + Element Plus + Pinia |
| 数据库 | SQLite (rusqlite) |
| AI | 阿里云百炼 API (qwen3.6-plus) |
| OCR | PaddleOCR (Python 子进程) |

## 目录结构

```
src/              # Vue 3 前端
├── views/        # 页面组件（Home, Records, Budget, Stats, TripAllowance, Settings）
├── components/   # 共享组件（ChatWidget, Navbar, 统计图表等）
├── stores/       # Pinia 状态管理
├── api/          # Tauri invoke 封装
├── ai/           # AI 引擎（AgentEngine, ToolRegistry）
└── types/        # TypeScript 类型定义

src-tauri/        # Rust 后端
├── src/
│   ├── main.rs   # Tauri 入口
│   ├── commands/ # Tauri 命令（records/trips/stats/sync/ocr 等）
│   └── db/       # SQLite 数据库
└── prompts/      # AI 系统 Prompt（dispatch.md, record.md）

docs/             # 设计文档
```

## 数据模型

| 表名 | 说明 |
|---|---|
| `records` | 收支记录 |
| `business_trip` | 差旅补助 |
| `system_prompts` | AI 提示词 |
| `learning_data` | 学习数据 |
| `chat_history` | 对话历史 |
| `sync_log` | 同步日志 |
| `app_config` | 应用配置 |

> 无 `accounts`/`budgets`/`categories`/`payment_methods` 独立表，均作为自由文本字段存储。

## 开发约定

### Tauri 2 camelCase 序列化

前端 `invoke()` 必须使用 **camelCase** 键名，对应 Rust 端的 **snake_case** 参数：

```typescript
// ✅ 正确
invoke('get_stats_summary', { datetimeGte: '2026-05-01 00:00:00' })
```

### SQLite 时间格式

所有时间字段使用 **TEXT** 存储，格式 `YYYY-MM-DD HH:MM:SS`（空格分隔，24 小时制）。

### LLM 字段来源标注

LLM 返回的每个参数字段附带 `_source`：`extracted`（明确提到）/ `inferred`（推断）/ `default`（默认填充）。

## 详细文档

- [项目概览](docs/01-project-overview.md) — 需求 + 架构 + UI
- [开发路线图](docs/02-development-roadmap.md) — 开发计划（含本地 LLM 方案）
- [活跃设计文档](docs/03-active-design-docs.md) — 进行中的设计
