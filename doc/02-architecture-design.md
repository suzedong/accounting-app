# 架构设计

## 1. 总体架构

```
┌──────────────────────────────────────────────────────────────┐
│  桌面应用（Tauri v2）                                          │
│                                                              │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │  前端（WebView）    │    │  后端（Rust 进程）              │   │
│  │                  │    │                              │   │
│  │  web/pages/*.html │    │  ┌──────────────────────┐   │   │
│  │  web/js/*.js      │    │  │  Tauri Commands       │   │   │
│  │  web/assets/*.css │    │  │  ├─ db operations     │   │   │
│  │  Vue Data UI     │    │  │  ├─ sync operations   │   │   │
│  │                  │    │  │  ├─ OCR operations    │   │   │
│  │  invoke() ──────┼──IPC┤──│  └──────────────────────┘   │   │
│  │                │    │    │                              │   │
│  └──────────────────┘    │  ┌──────────────────────┐      │   │
│                          │  │  本地存储              │      │   │
│                          │  │  ├─ SQLite DB        │      │   │
│                          │  │  │  (app_data.db)    │      │   │
│                          │  │  └─ config.json       │      │   │
│                          │  └──────────────────────┘      │   │
│                          │                              │   │
│                          │  ┌──────────────────────┐      │   │
│                          │  │  OCR 引擎              │      │   │
│                          │  │  RapidOCR (ONNX)     │      │   │
│                          │  └──────────────────────┘      │   │
│                          └──────────────────────────────┘   │
│                                                              │
│  外部服务（可选，直连无需代理）                                  │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │  百炼 API     │  │  NocoBase API │                        │
│  │  (AI)         │  │  (同步)       │                        │
│  └──────────────┘  └──────────────┘                        │
└──────────────────────────────────────────────────────────────┘
```

## 2. 技术选型

### 2.1 运行时框架

**Tauri v2（Rust）**

| 选型 | 理由 |
|---|---|
| Tauri vs Electron | 包体积小（~5MB vs 150MB），内存占用低（~50MB vs 200MB） |
| Rust vs Node.js 后端 | 原生 SQLite 绑定（rusqlite/binding_sqlite），无需编译原生模块 |
| WebView vs 自绘 | 复用现有 HTML/CSS/JS，改动最小 |

### 2.2 数据层

**SQLite**

- 通过 `rusqlite` crate 操作
- 与现有 NocoBase collections 完全对齐
- 本地存储路径：`$APP_DATA/app_data.db`
- 配置文件路径：`$APP_CONFIG/config.json`

### 2.3 AI 层

**百炼 API 直连**

- 前端 `fetch()` 直接调用百炼 API
- API Key 存储在本地 `config.json`
- 不需要代理层，个人使用 API Key 暴露在前端可接受
- 支持 Referer 白名单限制

### 2.4 OCR 层

**RapidOCR（ONNX Runtime）**

- 模型文件打包到应用资源中（~10MB）
- 通过 `ort` crate（ONNX Runtime Rust 绑定）推理
- 纯 Rust 实现，无 Python 依赖
- 输入：图片 base64 / 二进制
- 输出：识别文本

## 3. 数据模型设计

### 3.1 SQLite Schema

与现有 NocoBase collections 对齐，新增同步相关字段：

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
    start_date TEXT,
    end_date TEXT,
    days INTEGER,
    destination TEXT,
    employee_name TEXT,
    reason TEXT,
    trip_allowance REAL DEFAULT 0,      -- 差旅补助（100元/天）
    transport_allowance REAL DEFAULT 0,  -- 交通补助（30元/天）
    total REAL DEFAULT 0,
    status TEXT DEFAULT '待发放',        -- 待发放/已发放/已过期
    paid_trip_allowance REAL DEFAULT 0,  -- 已发差旅补助
    paid_transport_allowance REAL DEFAULT 0, -- 已发交通补助
    paid_date TEXT,
    notes TEXT,
    synced INTEGER DEFAULT 0,
    nocobase_id INTEGER,
    nocobase_updated_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- 系统 Prompt（替代 server/prompts/*.md）
CREATE TABLE system_prompts (
    name TEXT PRIMARY KEY,              -- dispatch / record
    content TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 用户偏好（替代 preferences.md）
CREATE TABLE user_preferences (
    key TEXT PRIMARY KEY,
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

### 3.2 预置数据

首次启动时初始化基础数据：

```sql
-- 默认 Prompt
INSERT INTO system_prompts (name, content) VALUES
    ('dispatch', <从现有 dispatch.md 导入>),
    ('record', <从现有 record.md 导入>);
```

## 4. 通信架构

### 4.1 前端 ↔ 后端（Tauri IPC）

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
  │                          │
```

前端通过 `@tauri-apps/api/core.invoke()` 调用后端命令。

### 4.2 后端 ↔ 外部服务

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
  │                          │                    │
```

百炼 API 和 NocoBase API 均从 Rust 后端直连，使用 `reqwest` crate。

## 5. 同步策略

### 5.1 触发时机

- 应用启动时检测连接，自动同步
- 手动点击同步按钮
- 可选：定期后台同步

### 5.2 推送（Push）

```
本地未同步记录 → NocoBase
  - 筛选 synced=0 的记录
  - 批量 POST 到 NocoBase
  - 成功后更新 synced=1, nocobase_id, nocobase_updated_at
```

### 5.3 拉取（Pull）

```
NocoBase → 本地
  - 查询 nocobase_updated_at > 本地对应值的记录
  - 按 uuid 匹配：
    - 已存在 → 比较时间戳，新的覆盖旧的
    - 不存在 → 插入新记录
  - 更新 nocobase_updated_at
```

### 5.4 冲突处理

```
if 本地 modified && NocoBase modified:
    if 本地 updated_at > NocoBase updated_at:
        推送本地到 NocoBase（覆盖）
    else:
        拉取 NocoBase 到本地（覆盖）
```

个人记账场景，last-write-wins 足够。

### 5.5 多设备同步特殊数据

Prompt、Preference、Learning Data 三类数据需要跨设备同步（与 records 不同，records 是用户写入，每台设备写不同数据；这三类是 Agent 写入，多台设备可能写同一个 key）：

**system_prompts 表**
- 每条 prompt 通过 `name`（dispatch / record）唯一标识
- 同步时按 `name` 匹配，比较 `updated_at`，新覆盖旧
- Agent 修改频率低，冲突概率小

**user_preferences 表**
- 按 `key` 唯一标识
- 同步逻辑同 prompts

**learning_data 表**
- 每条学习记录带独立 `uuid`，新增直接插入，不会冲突
- 同一条 key 的多条记录在前端聚合时使用 `GROUP BY key`
- 不同步不影响功能，仅影响"设备间学习经验共享"

这三类数据复用 records 的同步逻辑（push/pull/冲突处理），无需额外机制。

## 6. ~~文件结构（重构后）~~（已更新）

> **注意**：下方文件结构基于"保留 HTML/JS"的旧方案。现已改为 **Vue 3 + TypeScript SPA** 重写，
> 最新文件结构见 `~/.claude/plans/curious-crafting-octopus.md`。此处保留仅作历史参考。

```
accounting-app/
├── src/                          # Tauri 前端（复用现有 web/）
│   ├── pages/
│   │   ├── index.html            # AI 对话首页
│   │   ├── records.html          # 记录管理
│   │   ├── budget.html           # 预算管理
│   │   ├── stats.html            # 统计分析
│   │   └── trip_allowance.html   # 差旅补助
│   ├── js/
│   │   ├── globals.js            # ESM 桥接（增加 Tauri invoke 适配）
│   │   ├── modules/
│   │   │   ├── config.js         # 配置
│   │   │   ├── utils.js          # 工具函数
│   │   │   ├── db-api.js         # 替代 nocobase-api.js，调用 invoke
│   │   │   ├── parse.js          # 规则解析（保留）
│   │   │   ├── ai-parser.js      # AI 解析（改为直连百炼）
│   │   │   ├── learning-engine.js# 学习引擎（存 SQLite）
│   │   │   ├── agent-core.js     # Agent 核心
│   │   │   └── chat-widget.js    # 对话组件（改 OCR 调用）
│   │   └── vendor/
│   │       └── (Vue Data UI via npm)
│   └── assets/
│       ├── chat-widget.css
│       └── favicon.svg
├── src-tauri/                    # Tauri 后端
│   ├── src/
│   │   ├── main.rs               # 入口，注册命令
│   │   ├── db.rs                 # SQLite 操作
│   │   ├── sync.rs               # NocoBase 同步
│   │   ├── ocr.rs                # RapidOCR 封装
│   │   ├── ai.rs                 # 百炼 API 直连
│   │   └── config.rs             # 配置管理
│   ├── models/                   # ONNX 模型文件
│   │   ├── det.onnx              # 检测模型
│   │   ├── cls.onnx              # 分类模型
│   │   └── rec.onnx              # 识别模型
│   ├── tauri.conf.json
│   └── Cargo.toml
├── doc/                          # 设计文档
├── package.json
└── vite.config.js                # 仅用于开发模式 HMR
```
