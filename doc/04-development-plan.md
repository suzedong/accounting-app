# 开发计划

## 阶段概览

| 阶段 | 名称 | 内容 | 预计时间 |
|---|---|---|---|
| Phase 1 | Tauri 骨架 + SQLite | 项目初始化、数据库设计、基础 CRUD | 2 周 |
| Phase 2 | 业务逻辑迁移 | Agent、统计、OCR、Prompt/Preference | 2 周 |
| Phase 3 | 同步层 | NocoBase 双向同步、数据导入导出 | 1 周 |
| Phase 4 | 桌面增强 + 清理 | 设置页、系统通知、删除 server.py | 1 周 |

**总预计：6 周**

---

## Phase 1：Tauri 骨架 + SQLite

### 目标

建立 Tauri 项目基本结构，SQLite 数据库可用，基础 CRUD 通过 Tauri IPC 工作。

### 任务

#### 1.1 初始化 Tauri 项目

- [ ] 初始化 `src-tauri/` 目录（`cargo init` + Tauri 配置）
- [ ] 配置 `tauri.conf.json`：
  - 前端目录指向 `web/`
  - 开发命令使用 Vite（`npm run dev:frontend`）
  - 构建命令使用 `npm run build`
  - 窗口配置：最小尺寸 900×600，记住窗口位置
- [ ] 配置 `Cargo.toml` 依赖：
  - `tauri = "2"`
  - `rusqlite = { version = "0.32", features = ["bundled"] }`
  - `serde = { version = "1", features = ["derive"] }`
  - `serde_json = "1"`
  - `chrono = { version = "0.4", features = ["serde"] }`
  - `uuid = { version = "1", features = ["v4"] }`
  - `reqwest = { version = "0.12", features = ["json"] }`
  - `tokio = { version = "1", features = ["full"] }`

#### 1.2 SQLite Schema

- [ ] 在 `db.rs` 中实现 schema 初始化（`CREATE TABLE IF NOT EXISTS`）
- [ ] 预置数据插入（分类、支付方式、默认 Prompt）
- [ ] 数据库连接池管理（SQLite 单连接即可，个人应用不需要池）

#### 1.3 Tauri Commands（CRUD）

- [ ] `get_records(params)` — 查询记录（支持筛选、分页、排序）
- [ ] `get_record(id)` — 查询单条记录
- [ ] `create_record(fields)` — 创建记录（生成 UUID）
- [ ] `update_record(id, fields)` — 更新记录
- [ ] `delete_record(id)` — 删除记录
- [ ] `get_accounts()` — 返回预置账户列表（硬编码 fallback）

#### 1.4 前端适配

- [ ] 创建 `web/js/modules/db-api.js`，替代现有 `nocobase-api.js`
- [ ] 所有函数改为调用 `invoke()`：
  ```javascript
  // 旧
  async function getRecords(options) { ... fetch('/api/records?...') }
  // 新
  async function getRecords(options) { invoke('get_records', options) }
  ```
- [ ] 更新 `globals.js` 桥接，挂载 `window.dbAPI` 替代 `window.NocobaseAPI`
- [ ] 逐个页面适配（先 records.html）

#### 1.5 开发调试

- [ ] `npm run tauri dev` 可以正常启动
- [ ] 验证 SQLite 数据库文件在 `$APP_DATA` 正确创建
- [ ] 验证记录 CRUD 通过 Tauri IPC 正常工作

---

## Phase 2：业务逻辑迁移

### 目标

将现有 Agent 核心逻辑、统计计算、OCR、Prompt/Preference 管理迁移到 Tauri 环境。

### 任务

#### 2.1 统计聚合（SQL GROUP BY）

- [ ] `get_stats_summary(params)` — 按时间范围统计总收入/支出/结余
- [ ] `get_stats_by_category(params)` — 按分类聚合
- [ ] `get_stats_by_account(params)` — 按账户聚合
- [ ] `get_monthly_trend(params)` — 月度趋势
- [ ] `get_comparison(params)` — 本月 vs 上月对比
- [ ] `get_budget_analysis(params)` — 预算分析

#### 2.2 差旅补助

- [ ] `get_business_trips(status)` — 查询出差记录
- [ ] `create_business_trip(fields)` — 创建出差记录
- [ ] `update_business_trip(id, fields)` — 更新出差记录
- [ ] `delete_business_trip(id)` — 删除出差记录

#### 2.3 Agent 核心

- [ ] 将 `parse.js`（规则解析）保留为前端模块（纯 JS，不依赖后端）
- [ ] 将 `agent-core.js` 适配为前端调用 `invoke()`
- [ ] AI 调用改为前端直连百炼 API：
  ```javascript
  fetch('https://coding.dashscope.aliyuncs.com/v1/chat/completions', {
      headers: { 'Authorization': `Bearer ${apiKey}` }
  })
  ```
- [ ] API Key 通过 `invoke('get_config', 'ai_api_key')` 从 Rust 获取

#### 2.4 OCR

- [ ] 集成 RapidOCR ONNX 模型（det/cls/rec 三个模型文件）
- [ ] 使用 `ort` crate 实现推理：
  - 图片解码（base64 → ndarray）
  - 检测 → 分类 → 识别 三阶段
  - 文本输出
- [ ] 实现 `ocr_recognize(image_base64)` Tauri Command
- [ ] 前端 `chat-widget.js` 适配：图片上传改为 `invoke('ocr_recognize')`

#### 2.5 Prompt / Preference / 学习引擎

- [ ] `get_system_prompt(name)` — 读取 dispatch/record prompt
- [ ] `update_system_prompt(name, content)` — 更新 prompt（存 SQLite）
- [ ] `get_preference()` — 读取用户偏好（存 SQLite）
- [ ] `update_preference(content)` — 更新偏好（存 SQLite）
- [ ] `get_learning_data()` — 读取学习数据
- [ ] `save_learning_data(data)` — 保存学习数据
- [ ] 前端 `learning-engine.js` 改为调用 `invoke()`，不再用 localStorage

#### 2.6 对话历史

- [ ] `get_chat_history(limit)` — 查询对话历史
- [ ] `save_chat_message(message)` — 保存对话消息
- [ ] `clear_chat_history()` — 清空对话历史
- [ ] 前端 `chat-widget.js` 适配

---

## Phase 3：同步层

### 目标

实现本地 SQLite ↔ NocoBase 双向同步，支持数据导入和导出。

### 任务

#### 3.1 NocoBase 同步

- [ ] 实现 `reqwest` HTTP 客户端封装（复用 NocoBase API）
- [ ] `sync_push()` — 推送本地未同步记录到 NocoBase
- [ ] `sync_pull()` — 拉取 NocoBase 更新数据到本地
- [ ] 冲突检测与 last-write-wins 处理
- [ ] 同步日志记录（`sync_log` 表）
- [ ] 前端同步状态指示器 UI

#### 3.2 数据导入

- [ ] `import_from_nocobase()` — 从现有 NocoBase 全量导入
- [ ] 支持导入所有表（records, business_trip, learning_data 等）
- [ ] 导入进度提示

#### 3.3 数据导出

- [ ] `export_to_csv(collection, filters)` — 导出 CSV
- [ ] 前端导出按钮和下载

#### 3.4 配置管理

- [ ] `get_config(key)` — 读取配置项
- [ ] `set_config(key, value)` — 保存配置项
- [ ] 配置持久化到 `$APP_CONFIG/config.json`
- [ ] 配置项：AI API Key、AI API URL、AI Model、NocoBase URL、NocoBase Token、Monthly Budget

---

## Phase 4：桌面增强 + 清理

### 目标

添加桌面端增强功能，清理旧架构残留，完成重构。

### 任务

#### 4.1 设置页面

- [ ] `settings.html` — API Key、NocoBase URL、预算设置
- [ ] 同步/导入/导出操作入口
- [ ] 配置验证（测试 AI 连接、测试 NocoBase 连接）

#### 4.2 系统通知

- [ ] 集成 `tauri-plugin-notification`
- [ ] 记账成功/失败时发送通知
- [ ] 同步完成/失败时发送通知

#### 4.3 清理

- [ ] 删除 `server/server.py`
- [ ] 删除 `server/prompts/` 目录（迁移到 SQLite）
- [ ] 删除 `dev.mjs`（不再需要双进程管理）
- [ ] 精简 `vite.config.js`（移除 proxy 配置）
- [ ] 精简 `package.json`（移除不再需要的脚本）
- [ ] 删除 `web/js/modules/nocobase-api.js`
- [ ] 更新 `CLAUDE.md` 文档

#### 4.4 构建测试

- [ ] `npm run tauri build` 生成 macOS .dmg
- [ ] `npm run tauri build` 生成 Windows .exe/nsis
- [ ] 测试离线运行（断网启动 → 确认所有功能可用）
- [ ] 测试同步功能（连接 NocoBase → 同步 → 确认数据一致）

---

## 里程碑

| 里程碑 | 完成标志 | 预计时间 |
|---|---|---|
| M1: 基础可用 | Phase 1 完成，记录 CRUD 在桌面端工作 | 第 2 周末 |
| M2: 功能完整 | Phase 2 完成，AI 记账 + OCR + 统计均可用 | 第 4 周末 |
| M3: 同步可用 | Phase 3 完成，可导入现有数据并双向同步 | 第 5 周末 |
| M4: 发布就绪 | Phase 4 完成，桌面构建通过，文档更新 | 第 6 周末 |
