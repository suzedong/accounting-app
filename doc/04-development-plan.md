# 开发计划

> **最后更新：2026-05-21**

## 阶段概览

| 阶段 | 名称 | 内容 | 预计时间 | 状态 |
|---|---|---|---|---|
| Phase 1 | Tauri 骨架 + SQLite | 项目初始化、数据库设计、基础 CRUD | 2 周 | ✅ 已完成 |
| Phase 2 | 业务逻辑迁移 | 差旅、统计、预算、设置页面 | 2 周 | ✅ 已完成 |
| Phase 3 | AI 聊天 + Agent | 百炼 API dispatch、11 个 action handlers、OCR | 2 周 | ✅ 已完成 |
| Phase 4 | 同步层 + 清理 | NocoBase 双向同步、清理旧代码 | 2 周 | ❌ 未开始 |
| Phase 5 | 本地 LLM | Candle 推理引擎、Qwen2 模型、GPU 自动检测 | ~7 天 | 📝 规划中 |

**总预计：约 10 周**

---

## Phase 1：Tauri 骨架 + SQLite

> ✅ **已完成**

### 目标

建立 Tauri 项目基本结构，SQLite 数据库可用，基础 CRUD 通过 Tauri IPC 工作。

### 任务

#### 1.1 初始化 Tauri 项目

- [x] 初始化 `src-tauri/` 目录（`cargo init` + Tauri 配置）
- [x] 配置 `tauri.conf.json`：
  - 前端目录指向 `web/`（已改为 Vue 3 `src/`）
  - 开发命令使用 Vite（`npm run dev:frontend`）
  - 构建命令使用 `npm run build`
  - 窗口配置：最小尺寸 900×600，记住窗口位置
- [x] 配置 `Cargo.toml` 依赖：
  - `tauri = "2"`
  - `rusqlite = { version = "0.32", features = ["bundled"] }`
  - `serde = { version = "1", features = ["derive"] }`
  - `serde_json = "1"`
  - `chrono = { version = "0.4", features = ["serde"] }`
  - `uuid = { version = "1", features = ["v4"] }`
  - `reqwest = { version = "0.12", features = ["json"] }`
  - `tokio = { version = "1", features = ["full"] }`

#### 1.2 SQLite Schema

- [x] 在 `db.rs` 中实现 schema 初始化（`CREATE TABLE IF NOT EXISTS`）
- [x] 预置数据插入（分类、支付方式、默认 Prompt）
- [x] 数据库连接池管理（SQLite 单连接即可，个人应用不需要池）

#### 1.3 Tauri Commands（CRUD）

- [x] `get_records(params)` — 查询记录（支持筛选、分页、排序）
- [x] `get_record(id)` — 查询单条记录
- [x] `create_record(fields)` — 创建记录（生成 UUID）
- [x] `update_record(id, fields)` — 更新记录
- [x] `delete_record(id)` — 删除记录
- [x] `get_accounts()` — 返回预置账户列表（硬编码 fallback）

#### 1.4 前端适配

> **注意**：实际采用 Vue 3 重写而非渐进式改造旧 HTML/JS。
> 新前端使用 `src/`（Vue 3 + TypeScript + Pinia）替代了 `web/` 旧代码。

- [x] 创建 Vue 3 前端（`src/`），替代旧 `web/` 方案
- [x] 所有函数改为调用 `invoke()`（`src/api/tauri.ts`）
- [x] Pinia 状态管理 + 路由（`src/stores/`, `src/router/`）
- [x] 页面组件：Home, Records 已完成

#### 1.5 开发调试

- [x] `npm run tauri dev` 可以正常启动
- [x] 验证 SQLite 数据库文件在 `$APP_DATA` 正确创建
- [x] 验证记录 CRUD 通过 Tauri IPC 正常工作

---

## Phase 2：业务逻辑迁移

> ✅ **已完成**

### 目标

将差旅补助、统计计算、预算分析、Prompt/Preference 管理迁移到 Tauri 环境，完成所有业务页面。

### 任务

#### 2.1 统计聚合（SQL GROUP BY） — ✅ 已完成

- [x] `get_stats_summary(params)` — 按时间范围统计总收入/支出/结余
- [x] `get_stats_by_category(params)` — 按分类聚合
- [x] `get_stats_by_account(params)` — 按账户聚合
- [x] `get_monthly_trend(params)` — 月度趋势
- [x] `get_comparison(params)` — 本月 vs 上月对比
- [x] `get_budget_analysis(params)` — 预算分析

#### 2.2 差旅补助 — ✅ 已完成

- [x] `get_business_trips(status)` — 查询出差记录
- [x] `create_business_trip(fields)` — 创建出差记录
- [x] `update_business_trip(id, fields)` — 更新出差记录
- [x] `delete_business_trip(id)` — 删除出差记录
- [x] `views/TripAllowance.vue` 页面

#### 2.3 前端页面 — ✅ 已完成

- [x] `views/Home.vue` 首页仪表盘
- [x] `views/Stats.vue` 统计分析（ECharts 图表）
- [x] `views/Budget.vue` 预算管理
- [x] `views/Settings.vue` 设置页
- [x] `views/Records.vue` 记录管理
- [x] `stores/records.ts` Pinia store

#### 2.4 Prompt / Preference / 学习引擎 — ✅ 已完成

- [x] `get_system_prompt(name)` — 读取 dispatch/record prompt
- [x] `update_system_prompt(name, content)` — 更新 prompt
- [x] `get_all_preferences()` — 读取用户偏好
- [x] `update_preference(content)` — 更新偏好
- [x] `get_learning_corrections()` — 读取学习数据
- [x] `save_correction()` — 保存学习数据

#### 2.5 对话历史 — ✅ 已完成

- [x] `get_chat_history(limit)` — 查询对话历史
- [x] `save_chat_message(message)` — 保存对话消息
- [x] `clear_chat_history()` — 清空对话历史

---

## Phase 3：AI 聊天 + Agent

> ✅ **已完成**

### 目标

实现 AI 对话端到端工作，LLM dispatch → action execute → 结果渲染，支持图片 OCR。

### 任务

#### 3.1 百炼 API 直连 — ✅ 已完成

- [x] `composables/useDashScope.ts` — DashScope API 直连调用
- [x] `ai/dispatch.ts` — LLM dispatch（system prompt + preference + learning 注入）
- [x] `composables/useParse.ts` — 规则解析降级方案（金额提取、分类推断）

#### 3.2 Action Handlers — ✅ 已完成（11 个）

- [x] `create_record` — 创建记录
- [x] `correct_record` — 修正记录
- [x] `update_record` — 更新记录
- [x] `query_records` — 查询记录
- [x] `render_stats` — 统计渲染
- [x] `render_budget` — 预算渲染
- [x] `ask_follow_up` — 追问
- [x] `reply_text` — 纯文本
- [x] `save_preference` — 保存偏好
- [x] `update_prompt` — 修改 prompt
- [x] `clear_chat` — 清空历史

#### 3.3 聊天 UI — ✅ 已完成

- [x] `components/chat/ChatWidget.vue` — 悬浮对话面板
- [x] `components/chat/ChatMessage.vue` — 多类型消息渲染
- [x] `components/chat/ChatInput.vue` — 输入框 + 图片上传
- [x] `components/chat/RecordCard.vue` — 记录确认卡片
- [x] `components/chat/ChatThinking.vue` — 思考动画
- [x] `components/chat/ImagePreview.vue` — 图片预览
- [x] `components/chat/DebugPanel.vue` — 调试面板
- [x] `components/chat/RulesPanel.vue` — Prompt 编辑器

#### 3.4 Stores — ✅ 已完成

- [x] `stores/chat.ts` — 聊天状态管理
- [x] `stores/learning.ts` — 学习引擎

#### 3.5 OCR — ✅ 已完成

- [x] `commands/ocr.rs` — Tauri Commands（智能 Python 探测 + 自动安装依赖 + OCR 识别）
- [x] `check_ocr_status()` — 探测 Python 路径/版本/paddleocr 安装状态
- [x] `install_ocr_dependencies()` — 自动 pip install paddlepaddle paddleocr
- [x] `ocr_recognize(image_base64)` — 调用 server/ocr_service.py 子进程
- [x] Settings 页 OCR 管理（状态展示 / 安装依赖 / 启用禁用开关）
- [x] 聊天窗口图片上传对接 OCR

---

## Phase 4：同步层 + 清理

### 目标

实现本地 SQLite ↔ NocoBase 双向同步，清理旧架构残留代码。

### 任务

#### 4.1 NocoBase 同步

- [ ] 实现 `reqwest` HTTP 客户端封装
- [ ] `sync_push()` — 推送本地未同步记录到 NocoBase
- [ ] `sync_pull()` — 拉取 NocoBase 更新数据到本地
- [ ] 冲突检测与 last-write-wins 处理
- [ ] `import_from_nocobase()` — 从 NocoBase 全量导入

#### 4.2 桌面增强

- [ ] `tauri-plugin-notification` — 系统通知
- [ ] Settings 页同步操作入口

#### 4.3 清理

- [ ] 删除 `server/server.py`
- [ ] 删除 `server/prompts/` 目录
- [ ] 删除 `dev.mjs`
- [ ] 精简 `vite.config.js`
- [ ] 更新 `CLAUDE.md` / `README.md` 文档

#### 4.4 构建测试

- [ ] `npm run tauri build` 生成 macOS .dmg
- [ ] `npm run tauri build` 生成 Windows .exe/nsis
- [ ] 测试离线运行（断网启动 → 确认所有功能可用）
- [ ] 测试同步功能（连接 NocoBase → 同步 → 确认数据一致）

---

## Phase 5：本地 LLM

> 📝 **规划中**

### 目标

实现完全自包含的本地 LLM 推理能力，不依赖 Ollama 等外部服务，跨平台支持 macOS / Windows。

### 任务

#### 5.0 最小验证（Phase 0）

- [ ] Candle + Qwen2-1.5B-Instruct 最小 demo（Rust CLI，能输出有效回复）
- [ ] 验证 token 速度（CPU vs GPU）

#### 5.1 Candle 推理引擎集成

- [ ] `src-tauri/Cargo.toml` 添加 Candle 依赖（`candle-core`, `candle-transformers`, `candle-nn`, `hf-hub`）
- [ ] `src-tauri/src/llm/mod.rs` — LLM 引擎模块
- [ ] 模型加载：`.gguf` 量化格式（4-bit / 8-bit）
- [ ] 推理接口：`generate(system_prompt, user_message, max_tokens) -> String`
- [ ] Tauri Commands：`local_llm_chat`, `local_llm_health_check`

#### 5.2 GPU 自动检测

- [ ] macOS：自动启用 Metal（`candle-core` 原生支持）
- [ ] Windows：检测 NVIDIA GPU（`cuda` feature），有则启用，无则回退 CPU
- [ ] 启动时日志输出：`LLM device: Metal / CUDA / CPU`

#### 5.3 模型下载与部署

- [ ] 默认模型：Qwen2-1.5B-Instruct（GGUF 4-bit, ~0.9GB）
- [ ] HF 默认源 + 镜像源备选 + 断点续传 + 代理支持
- [ ] 首次启动引导 + 后台静默下载
- [ ] Settings 页模型管理（与 OCR 模型管理类似的 UI）
- [ ] 模型切换（支持多个模型下载管理）

#### 5.4 云端 / 本地严格切换

- [ ] Settings 页"AI 引擎"选择：百炼 API ↔ 本地 LLM（严格二选一，不自动回退）
- [ ] 本地模式：`local_llm_chat` command 调用 Candle 推理
- [ ] 云端模式：现有 `call_llm` command（reqwest 调百炼 API）
- [ ] Agent dispatch 逻辑无需修改，仅底层 LLM 调用方式不同

### 里程碑

| 里程碑 | 完成标志 | 预计时间 | 状态 |
|---|---|---|---|
| M5: 本地 LLM 可用 | Phase 5 完成，本地模型可完成记账 dispatch | 第 10 周末 | 📝 待达成 |

---

## 里程碑

| 里程碑 | 完成标志 | 预计时间 | 状态 |
|---|---|---|---|
| M1: 基础可用 | Phase 1 完成，记录 CRUD 在桌面端工作 | 第 2 周末 | ✅ 已达成 |
| M2: 功能完整 | Phase 2 完成，所有业务页面可用 | 第 4 周末 | ✅ 已达成 |
| M3: AI 可用 | Phase 3 完成，AI 对话 + OCR 均可用 | 第 6 周末 | ✅ 已达成 |
| M4: 同步可用 | Phase 4 完成，可导入并双向同步 | 第 8 周末 | ❌ 待达成 |
| M5: 本地 LLM 可用 | Phase 5 完成，本地模型可完成记账 dispatch | 第 10 周末 | 📝 待达成 |
