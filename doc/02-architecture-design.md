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
│  │  ECharts     │    │  │  ├─ sync operations   │   │   │
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
- 本地存储路径：
  - 开发模式：`项目根目录/database/app_data.db`
  - 发布模式：`$APP_DATA/app_data.db`
- 配置文件存储在 SQLite `app_config` 表（非 config.json）

### 2.3 AI 层

**百炼 API 直连**

- 前端 `fetch()` 直接调用百炼 API
- API Key 存储在本地 `config.json`
- 不需要代理层，个人使用 API Key 暴露在前端可接受
- 支持 Referer 白名单限制

### 2.4 OCR 层

**macOS 快捷指令（Vision.framework）+ 跨平台占位**

- macOS 端通过 `shortcuts` 命令调用系统自带 Vision.framework OCR
- 零配置，无需下载 ONNX 模型
- Windows/Linux 使用占位方案（需后续实现 RapidOCR ONNX 或其他引擎）
- 输入：图片 base64
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

## 6. 项目文件结构

### 6.1 前端（Vue 3 SPA）

```
accounting-app/
├── index.html                    # SPA 入口
├── src/                          # Vue 3 + TypeScript 前端
│   ├── main.ts                   # Vue app 初始化、Pinia、Element Plus
│   ├── App.vue                   # 根组件（AppNavbar + router-view + ChatWidget）
│   ├── env.d.ts                  # TypeScript 环境声明
│   ├── router/
│   │   └── index.ts              # 6 个路由（/, /records, /budget, /stats, /trips, /settings）
│   ├── stores/
│   │   └── records.ts            # Pinia：记录列表、筛选、分页、CRUD
│   ├── types/
│   │   └── index.ts              # TypeScript 类型：Record, TripRecord, StatsSummary 等
│   ├── api/
│   │   └── tauri.ts              # invoke() 封装（records, trips, stats, config, OCR）
│   ├── utils/
│   │   ├── formatters.ts         # formatMoney, formatDatetime
│   │   └── dateRange.ts          # 日期范围计算（month, last_month, week, year）
│   ├── views/
│   │   ├── Home.vue              # 首页仪表盘（统计卡片 + 分类分析 + 账户分析 + 预算执行）
│   │   ├── Records.vue           # 记录管理（ElTable + 筛选 + 分页 + 编辑对话框）
│   │   ├── Budget.vue            # 预算管理
│   │   ├── Stats.vue             # 统计分析
│   │   ├── TripAllowance.vue     # 差旅补助
│   │   └── Settings.vue          # 设置页
│   └── components/
│       ├── layout/
│       │   └── AppNavbar.vue     # 顶部导航栏（渐变色 + 路由链接）
│       ├── chat/
│       │   ├── ChatWidget.vue    # 悬浮对话面板（完整实现）
│       │   ├── ChatMessage.vue   # 消息渲染（文本/卡片/列表）
│       │   ├── ChatInput.vue     # 输入框 + 图片上传
│       │   └── RecordCard.vue    # 记录确认卡片
│       └── stats/
│           ├── CategoryBarChart.vue  # ECharts：分类柱状图
│           ├── AccountPieChart.vue   # ECharts：账户环形图
│           ├── MonthlyTrendChart.vue # ECharts：月度趋势
│           └── ComparisonChart.vue   # ECharts：环比对比
├── src-tauri/                    # Tauri 2 后端（Rust）
│   ├── src/
│   │   ├── main.rs               # 入口：初始化 Database + AppConfig + OcrEngine，注册 30+ 命令
│   │   ├── db/
│   │   │   ├── mod.rs            # 模块根，导出 Database, RecordInput 等
│   │   │   ├── connection.rs     # SQLite 连接（Arc<Mutex<Connection>>，构造函数打开）
│   │   │   ├── schema.rs         # 建表（7 张）+ 预置 dispatch/record Prompt
│   │   │   ├── records.rs        # records CRUD（分页、筛选、排序）
│   │   │   ├── trips.rs          # business_trip CRUD（自动计算补助）
│   │   │   ├── prompts.rs        # system_prompts + user_preferences CRUD
│   │   │   ├── learning.rs       # learning_data CRUD（修正映射）
│   │   │   ├── chat_history.rs   # chat_history CRUD
│   │   │   ├── sync_log.rs       # sync_log 写入 + 查询
│   │   └── preferences.rs    # 偏好 CRUD
│   │   ├── commands/
│   │   │   ├── mod.rs            # 模块声明
│   │   │   ├── records.rs        # 记录 Tauri Commands（5 个）
│   │   │   ├── trips.rs          # 差旅 Tauri Commands（4 个）
│   │   │   ├── stats.rs          # 统计聚合（6 个命令）
│   │   │   ├── prompts.rs        # Prompt/偏好（4 个命令）
│   │   │   ├── learning.rs       # 学习数据（3 个命令）
│   │   │   ├── chat.rs           # 对话历史（3 个命令）
│   │   │   ├── config.rs         # 配置读写（3 个命令）
│   │   │   ├── sync.rs           # 同步占位（5 个命令）
│   │   │   └── ocr.rs            # OCR（macOS 快捷指令 + 占位）
│   │   └── models/
│   │       └── mod.rs            # 数据模型定义
│   ├── capabilities/
│   │   └── default.json          # Tauri 2 权限配置
│   ├── icons/
│   │   └── icon.png              # 应用图标
│   ├── Cargo.toml                # Rust 依赖
│   ├── tauri.conf.json           # Tauri 配置（窗口 1200×800、CSP）
│   └── build.rs                  # Tauri 构建脚本
├── doc/                          # 设计文档
│   ├── 01-requirement-design.md
│   ├── 02-architecture-design.md
│   ├── 03-ui-design.md
│   ├── 04-development-plan.md
│   └── 05-refactoring-plan.md
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts                # Vite + Vue 插件，端口 5173
└── index.html
```

### 6.2 关键架构决策

| 决策 | 说明 |
|---|---|
| Database 设计 | `Arc<Mutex<Connection>>`，构造函数中直接打开，无需延迟初始化 |
| rusqlite 参数 | 动态参数使用 `Box<dyn ToSql + Send>` + `params_from_iter`，避免生命周期问题 |
| SQLite WAL 模式 | `PRAGMA journal_mode=WAL`，提升并发写入性能 |
| 字段类型 | `records.category` 和 `payment_method` 为自由文本，非枚举 |
| 数据层 | SQLite 通过 `rusqlite` crate，7 张表 + 预置数据 |
