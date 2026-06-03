# 项目概览

## 1. 需求设计

### 1.1 项目背景

原项目基于 NocoBase + server.py 代理的纯前端记账 Web 应用（旧架构已删除）。重构前存在以下核心问题：

- **server.py 是最不稳定的环节**：需要公网 IP 和端口，可能是临时机器，配置不高，维护成本高
- **NocoBase 虽已部署但并非必要条件**：用户可能在无网络环境、出差场景下使用
- **数据可用性强依赖服务在线**：NocoBase 宕机或 server.py 断连 → 应用完全不可用
- **多设备数据同步困难**：依赖云端 NocoBase，NAS 内网访问受限

### 1.2 目标

**将应用从"依赖云端服务的 C/S 架构"重构为"本地优先（Local-first）的桌面应用程序。**

核心原则：
- **数据永远可用**：所有数据存储在本地 SQLite，不依赖任何外部服务
- **零自有服务依赖**：不再需要 server.py（已删除）、不需要公网 IP、不需要端口映射
- **NocoBase 作为可选同步目标**：有连接时同步，无连接时完全本地运行
- **AI 能力直连**：前端直连云端 AI API（百炼），无需代理层
- **桌面原生体验**：系统通知、全局快捷键、文件关联

### 1.3 功能需求

#### 核心功能（现有，需完整迁移）

| 功能 | 说明 | 当前实现 | 目标 |
|---|---|---|---|
| AI 对话记账 | 自然语言输入 → 意图识别 → 创建记录 | AgentEngine + LLM Function Calling | 桌面内集成，数据存本地 |
| 记录管理 | 增删改查 + 分页 + 筛选 | records.html | 存 SQLite |
| 预算管理 | 月度预算跟踪 + 超支预警 | budget.html | 存 SQLite |
| 统计分析 | 多维度图表（分类、账户、趋势、对比） | stats.html + Chart.js | SQLite GROUP BY + ECharts |
| 差旅补助 | 出差记录 + 补助发放 + 金额匹配 | trip_allowance.html | 存 SQLite |
| OCR 识别 | 图片识别 → 自动记账 | PaddleOCR（Python 子进程调用） | Python subprocess |
| 学习引擎 | 用户修正 → 个性化规则 | localStorage + NocoBase | 存 SQLite |
| 对话历史 | AI 对话记录 | localStorage | 存 SQLite |

#### 新增功能

| 功能 | 说明 |
|---|---|
| 本地存储 | SQLite 替代 NocoBase 作为主数据源 |
| 数据同步 | 本地 ↔ NocoBase 双向同步（可选） |
| 系统通知 | 记账成功/失败系统级通知 |
| 全局快捷键 | 一键呼出记账窗口 |
| 配置管理 | API Key、NocoBase URL 等设置（本地配置文件） |
| 数据导出 | 导出 CSV/Excel |
| 数据导入 | 从现有 NocoBase 数据导入 |

#### 功能保留不变

| 功能 | 说明 |
|---|---|
| AI 意图识别 | 调用百炼 API，直连不调用代理 |
| 偏好管理 | preferences.md 已迁移为 SQLite 存储 |
| Prompt 管理 | dispatch.md / record.md 已迁移为 SQLite 存储 |
| 账户管理 | 从 NocoBase collections 改为硬编码预置 |
| 分类/支付方式 | 不再需要独立表，records 中直接存自由文本 |

### 1.4 非功能需求

- **离线可用**：无网络时所有核心功能正常（记账、查询、统计、管理）
- **启动时间**：冷启动 < 2 秒
- **操作延迟**：本地操作 < 100ms（无网络等待）
- SQLite 查询：万级记录量级下响应 < 200ms
- 统计聚合：利用 SQL GROUP BY，不再全量拉数据到前端计算
- OCR 识别：Python PaddleOCR 子进程单次 < 3 秒（含启动时间）
- 本地 SQLite 为数据源（Source of Truth），NocoBase 为可选同步目标
- 同步策略：last-write-wins（个人记账场景足够）
- Tauri 应用包：约 5-10 MB（OCR 依赖外部 Python + PaddleOCR，不内置）
- 内存占用：< 150 MB
- 跨平台：macOS（Intel + Apple Silicon）、Windows 10+、Linux（可选）

### 1.5 约束与限制

| 约束 | 说明 |
|---|---|
| 数据模型兼容 | 与现有 NocoBase schema 对齐，方便数据导入/同步 |
| 框架选择 | Vue 3 + TypeScript + Element Plus |
| AI 成本 | 不使用百炼视觉模型（额外收费），OCR 用本地方案 |
| 用户群体 | 个人用户，单用户场景，不需要多租户/权限管理 |

---

## 2. 架构设计

### 2.1 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│  桌面应用（Tauri v2）                                          │
│                                                              │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │  前端（WebView）    │    │  后端（Rust 进程）              │   │
│  │                  │    │                              │   │
│  │  Vue 3 SPA       │    │  ┌──────────────────────┐   │   │
│  │  Element Plus    │    │  │  Tauri Commands       │   │   │
│  │  TypeScript      │    │  │  ├─ db operations     │   │   │
│  │  Pinia           │    │  │  ├─ sync operations   │   │   │
│  │                  │    │  │  ├─ OCR operations    │   │   │
│  │  invoke() ──────┼──IPC┤──│  ├─ LLM operations    │   │   │
│  │                │    │    │  └──────────────────────┘   │   │
│  └──────────────────┘    │                              │   │
│                          │  ┌──────────────────────┐      │   │
│                          │  │  本地存储              │      │   │
│                          │  │  ├─ SQLite DB        │      │   │
│                          │  │  │  (app_data.db)    │      │   │
│                          │  │  └───────────────────┘      │   │
│                          │  └──────────────────────┘      │   │
│                          │                              │   │
│                          │  ┌──────────────────────┐      │   │
│                          │  │  OCR（Python subprocess）│     │   │
│                          │  │  └─ PaddleOCR        │      │   │
│                          │  └──────────────────────┘      │   │
│                          │                              │   │
│                          │  ┌──────────────────────┐      │   │
│                          │  │  本地 LLM（规划中）     │      │   │
│                          │  │  └─ Candle + Qwen2   │      │   │
│                          │  └──────────────────────┘      │   │
│                          └──────────────────────────────┘   │
│                                                              │
│  外部服务（直连，无需代理）                                      │
│  ┌──────────────┐  ┌──────────────                        │
│  │  百炼 API     │  │  NocoBase API │                        │
│  │  (云端 AI)     │  │  (可选同步)    │                        │
│  └──────────────┘  └──────────────                        │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 技术选型

#### 运行时框架

**Tauri v2（Rust）**

| 选型 | 理由 |
|---|---|
| Tauri vs Electron | 包体积小（~5MB vs 150MB），内存占用低（~50MB vs 200MB） |
| Rust vs Node.js 后端 | 原生 SQLite 绑定（rusqlite/binding_sqlite），无需编译原生模块 |
| WebView vs 自绘 | 复用现有 HTML/CSS/JS，改动最小 |

#### 数据层

**SQLite**

- 通过 `rusqlite` crate 操作
- 与现有 NocoBase collections 完全对齐
- 本地存储路径：开发模式 `项目根目录/database/app_data.db`，发布模式 `$APP_DATA/app_data.db`
- 配置文件存储在 SQLite `app_config` 表（AI 服务列表、月度预算等）

#### AI 层

**百炼 API 直连**

- 前端 `AgentEngine` 通过 Tauri IPC 调用 `call_llm_with_tools`，Rust 后端使用 `reqwest` 转发到百炼 API
- API Key 存储在 SQLite `app_config` 表
- 不需要代理层，个人使用 API Key 暴露在前端可接受
- 支持多服务管理（`ai_services` JSON 数组，active 标记当前使用）
- LLM 使用 Function Calling 模式，返回 tool_calls 而非自由 JSON

#### OCR 层

**PaddleOCR（Python 子进程）+ 智能 Python 探测 + 自动安装依赖**

- Rust 端通过 `std::process::Command` 调用 `src-tauri/scripts/ocr_service.py` 子进程
- 跨平台 Python 智能探测（Windows `py`/`python` + 注册表，macOS `python3`/Homebrew，Linux `python3`），通过 `python_manager.ps1`（Windows）和 `python_manager.sh`（macOS/Linux）实现
- 首次使用时 Settings 页一键 `pip install paddlepaddle paddleocr`
- 通过临时文件传递 base64 图片数据，避免命令行长度限制
- 启动时自动检测 Python 和 paddleocr 安装状态
- Settings 页提供 OCR 管理（状态展示 / 安装依赖 / 启用禁用开关）

#### 本地 LLM 层

**Candle（Hugging Face 纯 Rust 推理框架）+ Qwen2 中文模型**

| 选型 | 理由 |
|---|---|
| Candle vs Ollama | 完全自包含，无需外部进程，跨平台原生 |
| GGUF 4-bit 量化 | 模型体积 ~0.9GB，内存占用低，CPU 可用 |
| Qwen2-1.5B-Instruct | 中文能力好，体积小，Candle 官方支持 |

- **推理引擎**：`candle-transformers` crate（Qwen2 架构原生支持）
- **模型格式**：GGUF 量化（4-bit / 8-bit），通过 `hf-hub` 下载
- **GPU 策略**：macOS 自动启用 Metal，Windows 检测 NVIDIA GPU（CUDA），无则回退 CPU
- **模型存储**：与 OCR 模型同目录 `$APP_DATA/ai-jizhang/models/`
- **下载策略**：HF 默认源 + 镜像源备选 + 断点续传 + 代理配置
- **云端 / 本地切换**：Settings 页严格二选一，不自动回退

### 2.3 SQLite Schema

```sql
-- 记账记录（对齐 records collection）
CREATE TABLE records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,          -- 全局唯一标识（用于同步）
    datetime TEXT NOT NULL,             -- 时间 YYYY-MM-DD HH:MM:SS
    type TEXT NOT NULL,                 -- 收入/支出
    category TEXT,                      -- 分类
    amount REAL NOT NULL DEFAULT 0,     -- 金额
    account TEXT DEFAULT '个人',         -- 账户
    note TEXT,                          -- 备注
    payment_method TEXT,                -- 支付方式
    local_updated_at TEXT DEFAULT (datetime('now')),  -- 本地最后修改时间
    synced INTEGER DEFAULT 0,           -- 是否已同步到 NocoBase
    nocobase_id INTEGER,                -- NocoBase 记录 ID（同步时使用）
    nocobase_updated_at TEXT,           -- NocoBase 最后修改时间
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_records_datetime ON records(datetime);
CREATE INDEX idx_records_type ON records(type);
CREATE INDEX idx_records_category ON records(category);
CREATE INDEX idx_records_synced ON records(synced);

-- 差旅补助（对齐 business_trip collection）
CREATE TABLE business_trip (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    trip_id TEXT,                       -- 申请单号
    start_date TEXT,                    -- 仅日期 YYYY-MM-DD
    end_date TEXT,                      -- 仅日期 YYYY-MM-DD
    days INTEGER,
    trip_allowance REAL DEFAULT 0,      -- 差旅补助（100元/天）
    transport_allowance REAL DEFAULT 0,  -- 交通补助（30元/天）
    total REAL DEFAULT 0,
    status TEXT DEFAULT '⏳ 待发放',     -- 待发放/已发放/已过期（带 emoji）
    paid_trip_allowance REAL DEFAULT 0,  -- 已发差旅补助
    paid_transport_allowance REAL DEFAULT 0, -- 已发交通补助
    paid_date TEXT,
    notes TEXT,
    synced INTEGER DEFAULT 0,
    nocobase_id INTEGER,
    nocobase_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 系统 Prompt（本地 SQLite 管理）
CREATE TABLE system_prompts (
    name TEXT PRIMARY KEY,              -- dispatch / record / preferences
    content TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 应用配置（KV 存储）
CREATE TABLE app_config (
    key TEXT PRIMARY KEY,               -- ai_services, budget_monthly 等
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 学习数据（替代 learning_data collection）
CREATE TABLE learning_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL,                 -- correction / preference
    key TEXT,                           -- 关键词
    value TEXT,                         -- JSON 值
    count INTEGER DEFAULT 1,
    synced INTEGER DEFAULT 0,
    nocobase_id INTEGER,
    nocobase_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 对话历史
CREATE TABLE chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL,                 -- user / ai
    content TEXT,                       -- 文本内容
    data TEXT,                          -- JSON 附加数据（图片、OCR 等）
    skill TEXT,                         -- 技能名称
    confidence REAL,                    -- 置信度
    created_at TEXT DEFAULT (datetime('now'))
);

-- 同步日志
CREATE TABLE sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL,            -- pull / push
    collection TEXT NOT NULL,
    status TEXT NOT NULL,               -- success / failed / conflict
    count INTEGER DEFAULT 0,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
```

### 2.4 通信架构

#### 前端 ↔ 后端（Tauri IPC）

```
前端 JS                    Rust 后端
  │                          │
  │  invoke('get_records')   │
  ├─────────────────────────>│
  │                          │  sqlite query
  │  { data: [...], total }  │
  │<─────────────────────────┤
  │                          │
  │  invoke('create_record', │
  │    { fields })           │
  ├─────────────────────────>│
  │                          │  sqlite insert + generate uuid
  │  { success, id }         │
  │<─────────────────────────┤
```

前端通过 `@tauri-apps/api/core.invoke()` 调用后端命令。

#### 后端 ↔ 外部服务

```
Rust 后端                  百炼 API              NocoBase
  │                          │                    │
  │  AI 请求 (直连)           │                    │
  ├─────────────────────────>│                    │
  │  返回 JSON                │                    │
  │<─────────────────────────┤                    │
  │                          │                    │
  │                          │    同步 push       │
  │  ────────────────────────┼───────────────────>│
  │                          │    返回结果        │
  │  ────────────────────────┼───────────────────<│
  │                          │                    │
  │                          │    同步 pull       │
  │  ────────────────────────┼───────────────────>│
  │                          │    返回数据        │
  │  ────────────────────────┼───────────────────<│
```

百炼 API 和 NocoBase API 均从 Rust 后端直连，使用 `reqwest` crate。

### 2.5 同步策略

- **触发时机**：应用启动时检测连接自动同步、手动点击同步按钮
- **推送（Push）**：本地未同步记录 → NocoBase，筛选 synced=0 的记录，批量 POST 到 NocoBase，成功后更新 synced=1, nocobase_id, nocobase_updated_at
- **拉取（Pull）**：NocoBase → 本地，查询 nocobase_updated_at > 本地对应值的记录，按 uuid 匹配（已存在则比较时间戳，新覆盖旧；不存在则插入新记录）
- **冲突处理**：last-write-wins，个人记账场景足够
- **多设备同步特殊数据**：system_prompts 按 name 匹配比较 updated_at；learning_data 每条独立 uuid 不会冲突；复用 records 的同步逻辑

### 2.6 关键架构决策

| 决策 | 说明 |
|---|---|
| Database 设计 | `Arc<Mutex<Connection>>`，构造函数中直接打开，无需延迟初始化 |
| rusqlite 参数 | 动态参数使用 `Box<dyn ToSql + Send>` + `params_from_iter`，避免生命周期问题 |
| SQLite WAL 模式 | `PRAGMA journal_mode=WAL`，提升并发写入性能 |
| 字段类型 | `records.category` 和 `payment_method` 为自由文本，非枚举 |
| 数据层 | SQLite 通过 `rusqlite` crate，7 张表 + 预置数据 |
| OCR | Python 子进程调用 PaddleOCR，跨平台智能探测 Python，自动安装依赖 |
| LLM 模型存储 | `$APP_DATA/ai-jizhang/models/`，GGUF 格式（4-bit 量化 ~0.9GB） |
| GPU 策略 | macOS Metal / Windows CUDA（检测后自动启用）/ CPU 回退 |
| AI 引擎切换 | 百炼 API ↔ 本地 LLM，严格二选一，不自动回退 |

---

## 3. 界面设计

### 3.1 设计原则

- **保留现有 UI 风格**：现有 HTML/CSS 已有完整的视觉设计，重构期间不改变视觉风格
- **桌面优化**：固定窗口尺寸，支持窗口拖拽、最小化/最大化
- **离线状态展示**：同步状态可视化
- **减少层级**：桌面应用可承载更多功能在同一页面，减少页面跳转

### 3.2 页面结构

#### 页面清单（Vue SPA 路由）

| 页面 | 路由 | 说明 |
|---|---|---|
| 首页 | `/` | AI 对话 + 快速概览 |
| 记录 | `/records` | 记录增删改查 + 分页 + 筛选 |
| 预算 | `/budget` | 月度预算跟踪 + 超支预警 |
| 统计 | `/stats` | 多维度图表分析（分类、账户、趋势、对比） |
| 差旅补助 | `/trips` | 差旅管理 + 补助发放 |
| 设置 | `/settings` | AI 服务、NocoBase 同步、预算、OCR、Prompt 管理 |

#### 新增页面

| 页面 | 说明 | 状态 |
|---|---|---|
| Settings | 设置页（AI 服务管理、NocoBase 同步、预算、OCR 管理、Prompt/偏好编辑、学习数据、系统诊断） | ✅ 已实现 |

### 3.3 桌面端增强

- **窗口行为**：固定最小尺寸 900×600，记住窗口位置和尺寸，关闭时最小化到托盘（可选）
- **系统通知**：记账成功/失败时发送系统通知（`tauri-plugin-notification`）
- **全局快捷键**：`Cmd/Ctrl + Shift + A` 快速记账（呼出窗口并聚焦输入框）

### 3.4 新增 UI 元素

#### 同步状态指示器

```
┌──────────────────────────────────────────────┐
│ 首页 记录 预算 统计 差旅    [🔄 同步] ● 已同步 │
└──────────────────────────────────────────────┘

状态：● 已同步（绿色）/ ↻ 同步中（旋转）/ ○ 未同步（灰色）/ ⚠ 有冲突（黄色）
```

#### Skill 标签

位于消息气泡上方：

```
┌─────────────────────────┐
│ [create_record]  95%     │  ← skill tag（灰边框 pill，在气泡外）
│                          │
│ 已为您记录：              │
│   餐饮 支出 ¥35          │  ← message bubble
│   个人账户 2026-05-26    │
│                          │
│ [确认] [编辑] [取消]      │
└─────────────────────────┘
```

样式：灰边框 `#e0e0e0`，无渐变，圆角 10px，`margin-left: 4px; margin-bottom: 4px`。

#### 推理链展示（StepList）

- 逐步展示 AI 处理过程：OCR 识别（含延迟/错误）→ 意图识别（含置信度）→ 字段提取（标注来源）→ 执行结果
- 支持折叠/展开，折叠后步骤保留作为历史记录
- 每个步骤标注字段来源：`extracted`（用户输入提取）/ `inferred`（AI 推断）/ `default`（系统默认）

#### 图片粘贴（剪贴板）

ChatInput 支持剪贴板图片粘贴（Cmd+V / Ctrl+V），自动读取为 File 对象，走与文件选择相同的图片加载流程。

#### OCR 管理（Settings 页）

列出系统中所有 Python 版本及兼容性，选择活跃 Python，安装/卸载 PaddleOCR 依赖，内置 Python 生命周期管理，安装日志实时显示。

#### 设置页面（SettingsPanel + Settings.vue）

包含 AI 服务管理（单选列表、添加/编辑/删除、测试连接）、NocoBase 同步配置、预算设置、OCR 管理、Dispatch Prompt 编辑器、用户偏好编辑器、学习数据表格（可删除条目）、系统诊断（检查数据库/AI 服务/OCR 状态）。

### 3.5 现有页面改动说明

- **首页**：数据获取从 `fetch('/api/records')` 改为 Tauri `invoke()`，对话历史从 localStorage 改为 SQLite，AI 调用通过 AgentEngine 调用 LLM Function Calling
- **记录管理**：所有 CRUD 从 NocoBase API 改为 SQLite，筛选和分页由 SQL 查询完成
- **预算**：预算数据从 SQLite 读取，统计计算由 SQL GROUP BY 完成
- **统计**：数据获取从 `pageSize=10000` 改为 SQL 聚合查询，ECharts 渲染
- **差旅补助**：数据从 SQLite 读取，补助计算逻辑不变
- **设置**：全新页面，包含 AI 服务管理、NocoBase 同步配置、预算设置、OCR 管理、Prompt/偏好编辑、学习数据表格、系统诊断

### 3.6 视觉风格

保持现有配色方案：

```css
:root {
    --primary: #667eea;
    --primary-dark: #5568d3;
    --gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    --success: #52C41A;
    --warning: #FFC107;
    --danger: #FF6B6B;
    --danger-dark: #FF4D4F;
    --bg: #f5f7fa;
    --card-bg: white;
    --text: #333;
    --text-secondary: #666;
    --text-muted: #999;
}
```

桌面端新增同步状态颜色：`--sync-success: #68d391; --sync-warning: #f6ad55; --sync-error: #fc8181;`

桌面应用不需要响应式适配，但保留现有 CSS 以兼容窗口缩放和多显示器场景。
