# 记账本应用 - 设计文档

> 版本: v2.2 | 更新日期: 2026-05-09

## 1. 项目概述

记账本是一个基于 NocoBase 的纯前端记账应用，支持多设备访问。用户通过浏览器直接访问 HTML 页面，所有数据通过 NocoBase REST API 存取。

### 核心功能
- 自然语言快速记账（AI 解析金额、类型、分类、账户、支付方式）
- 多维度统计分析（按月、按分类、按账户、预算执行）
- 差旅补助管理（补助金额跟踪、发放状态管理）
- 预算管理（月度预算设置、执行进度、超支预警）
- 移动端适配（响应式设计，支持手机、平板）

### 部署架构
```
┌─────────────────────────────────────────────────┐
│  云端 NocoBase (121.17.49.100:13000)            │
│  PostgreSQL + NocoBase                          │
└──────────────────────┬──────────────────────────┘
                       │ HTTP API
┌──────────────────────▼──────────────────────────┐
│  本地开发 (localhost:18080)                     │
│  Python HTTP Server (静态文件 + API 代理)        │
│  web/ 目录下的 HTML/CSS/JS                      │
└──────────────────────┬──────────────────────────┘
                       │
                ┌──────┴──────┐
                │ 浏览器      │
                └─────────────┘
```

## 2. 技术栈

| 组件 | 技术 | 说明 |
|---|---|---|
| 数据库 | PostgreSQL 16 | NocoBase 内置，运行于 Docker |
| 后端 API | NocoBase v1.x | REST API，JWT 认证 |
| 前端 | 原生 HTML/CSS/JS | 无框架依赖，直接调用 API |
| 图表 | Chart.js | CDN 引入 |
| AI 解析 | 阿里云百炼 qwen3.6-plus | 自然语言记账解析 |
| 本地代理 | Python 3 | 解决 CORS 跨域问题 |

## 3. 数据模型

### 3.1 Collections 概览

| Collection | 说明 | 记录数 |
|---|---|---|
| records | 收支记录 | 699 |
| categories | 收支分类 | 14 (10 支出 + 4 收入) |
| accounts | 账户管理 | 3 |
| payment_methods | 支付方式 | 5 |
| business_trip | 差旅补助 | 36 |

### 3.2 records - 收支记录

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigInt (PK, auto) | 主键 |
| datetime | datetime | 日期时间 |
| type | string | 类型 (`收入` / `支出`) |
| category | string | 分类 (如 `餐饮`, `购物`) |
| amount | float | 金额 |
| account | string | 账户 (如 `个人`, `家庭`) |
| note | text | 备注 |
| payment_method | string | 支付方式 (如 `微信支付`) |

### 3.3 categories - 收支分类

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigInt (PK, auto) | 主键 |
| name | string | 分类名称 |
| type | string | 类型 (`收入` / `支出`) |
| icon | string | 图标 emoji |
| color | string | 颜色 HEX 值 |
| sort_order | integer | 排序序号 |

**支出分类** (10 个): 餐饮、交通、购物、居住、通信、娱乐、医疗、教育、人情、其他
**收入分类** (4 个): 工资、奖金、投资、其他

### 3.4 accounts - 账户

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigInt (PK, auto) | 主键 |
| name | string | 账户名称 (个人/家庭/公司) |
| balance | float | 余额 |
| type | string | 账户类型描述 |
| color | string | 颜色 HEX 值 |
| sort_order | integer | 排序序号 |

### 3.5 payment_methods - 支付方式

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigInt (PK, auto) | 主键 |
| name | string | 支付方式名称 |
| icon | string | 图标 emoji |
| color | string | 颜色 HEX 值 |
| sort_order | integer | 排序序号 |

### 3.6 business_trip - 差旅补助

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigInt (PK, auto) | 主键 |
| trip_id | string | 出差编号 (如 SQ202409190028) |
| start_date | date | 出差开始日期 |
| end_date | date | 出差结束日期 |
| days | integer | 出差天数 |
| trip_allowance | float | 差旅补助金额 (¥100/天) |
| transport_allowance | float | 交通补助金额 (¥30/天) |
| total | float | 合计金额 (trip_allowance + transport_allowance) |
| status | string | 发放状态 (`✅ 已发放` / `⏳ 待发放` / `❌ 已过期`) |
| paid_date | date | 发放日期 |
| notes | text | 备注 |

## 4. API 接口

### 4.1 认证方式

使用 JWT Token 认证，通过 `Authorization: Bearer <token>` 请求头传递。

### 4.2 Collection 记录操作

| 操作 | 方法 | 路径 | 说明 |
|---|---|---|---|
| 列表查询 | GET | `/api/{collection}` | 支持 `page`, `pageSize`, `sort`, `filter[字段]` 参数 |
| 单条查询 | GET | `/api/{collection}/{id}` | 按主键查询 |
| 创建记录 | POST | `/api/{collection}` | JSON body |
| 更新记录 | PATCH | `/api/{collection}/{id}` | JSON body |
| 删除记录 | POST | `/api/{collection}:destroy/{id}` | |

### 4.3 查询参数示例

```
GET /api/records?pageSize=20&sort=-datetime
GET /api/records?pageSize=10000&filter[type]=支出
GET /api/records?filter[datetime][$gte]=2026-01-01+00:00:00
GET /api/categories?sort=sort_order
GET /api/business_trip?filter[status]=✅ 已发放&sort=-start_date
```

## 5. 前端架构

### 5.1 文件结构

```
web/
├── index.html              # 首页（快速记账、统计概览）
├── records.html            # 记录管理（增删改查、分页）
├── budget.html             # 预算管理（月度预算、执行进度）
├── stats.html              # 统计分析（多维度图表）
├── trip_allowance.html     # 差旅补助（状态跟踪、统计）
├── server.py               # Python HTTP 服务器（静态文件 + API 代理 + AI 代理）
├── prompts/                # SYSTEM_PROMPT 文件（Agent 可自修改）
│   ├── dispatch.md         # 意图识别 + Skill 路由规则
│   ├── record.md           # 纯记账解析规则
│   └── README.md           # prompt 编写规范
├── static/
│   ├── config.js           # 配置中心（ESM）
│   ├── globals.js          # ESM 桥接文件（挂载所有模块到 window.*）
│   ├── utils.js            # 工具函数 + 统计计算（ESM）
│   ├── nocobase-api.js     # NocoBase API 客户端（ESM）
│   ├── parse.js            # 自然语言解析器（ESM，降级方案）
│   ├── ai-parser.js        # AI 解析器（ESM，降级方案）
│   ├── learning-engine.js  # 学习引擎（ESM）
│   ├── agent-core.js       # Agent 核心（ESM）
│   ├── chat-widget.js      # AI 对话悬浮组件（ESM）
│   ├── chat-widget.css     # 悬浮组件样式
│   └── chart.js            # Chart.js 库
└── chat-widget.css         # (旧位置，已迁移到 static/)
```

### 5.2 模块说明

**config.js** - 配置中心（ESM）
```javascript
export const NOCOBASE_CONFIG = {
    API_URL: 'http://121.17.49.100:13000/api',
    API_TOKEN: '<JWT Token>',
    BUDGET_MONTHLY: 3500,
    COLLECTIONS: { RECORDS, CATEGORIES, ACCOUNTS, ... }
}
```

**globals.js** - ESM 桥接文件
导入所有 ESM 模块并重新挂载到 `window.*`，使页面内联 `<script>` 可以访问 `NocobaseAPI`、`AgentCore`、`LearningEngine` 等全局对象。

**nocobase-api.js** - API 客户端（ESM）
```
NocobaseAPI.getRecords(options)       # 分页查询记录
NocobaseAPI.getRecord(id)             # 单条查询
NocobaseAPI.createRecord(data)        # 创建记录
NocobaseAPI.updateRecord(id, data)    # 更新记录
NocobaseAPI.deleteRecord(id)          # 删除记录
NocobaseAPI.getCategories()           # 获取分类
NocobaseAPI.getAccounts()             # 获取账户
NocobaseAPI.getPaymentMethods()       # 获取支付方式
NocobaseAPI.getBusinessTrips(status)  # 获取差旅记录
NocobaseAPI.getRecordsForStats(from)  # 获取全量记录（用于前端统计）
```

**ai-parser.js** - AI 解析器（ESM）
通过 `/api/ai/parse` 代理调用阿里云百炼（降级方案）

**learning-engine.js** - 学习引擎（ESM）
localStorage 管理用户修正数据，生成 Prompt 注入文本，支持 NocoBase 同步

**agent-core.js** - Agent 核心（ESM）
`AgentCore.dispatch(text)` 调用 LLM 意图识别，`AgentCore.execute(result)` 路由执行 Skill，`AgentCore.learn()` 记录学习

**chat-widget.js** - AI 对话悬浮组件（ESM）
右下角弹窗，接入 AgentCore，支持自动保存/确认卡片/Skill 结果渲染

**parse.js** - 自然语言解析器（ESM）
- 支持格式：`"今天中午吃饭花了 35 元，微信支付"`
- 解析目标：金额、类型(支出/收入)、分类、账户、支付方式、时间、备注
- 关键词映射：19 类消费分类、3 种账户、7 种支付方式

**utils.js** - 统计计算
```
statsByCategory(records, type)        # 按分类聚合
statsByAccount(records)               # 按账户聚合
calcTotals(records)                   # 总收入/总支出
analyzeBudget(records, period, budget)# 预算分析
monthlyBudgetStats(records, budget)   # 月度预算统计
monthlyTrend(records, months)         # 月度趋势
comparison(records)                   # 本月vs上月对比
heatmapData(records, months)          # 消费热力图
formatDatetime(datetimeStr)           # 日期时间格式化（处理 ISO 8601）
```

### 5.3 页面加载顺序

ESM 模块通过 `globals.js` 统一加载，页面脚本等待全局变量就绪：

```
<script type="module" src="./static/globals.js">
  ├── import config.js
  ├── import utils.js
  ├── import nocobase-api.js (依赖 config, utils)
  ├── import parse.js (依赖 utils)
  ├── import ai-parser.js
  ├── import learning-engine.js
  ├── import agent-core.js (依赖 learning-engine)
  ├── import chat-widget.js (依赖 agent-core, CSS)
  └── 挂载所有模块到 window.*

whenGlobalsReady().then(() => {
  // 页面初始化代码
})
```

### 5.4 前端统计模式

由于 NocoBase 不提供复杂的聚合 API（如 GROUP BY），统计数据全部在前端计算：
1. 通过 `getRecordsForStats()` 获取当年所有记录（`pageSize=10000`）
2. 在前端按日期范围、类型、分类过滤
3. 使用 `utils.js` 中的工具函数进行聚合计算

## 6. AI 自然语言记账

### 6.1 支持的输入格式

| 输入 | 解析结果 |
|---|---|
| `今天吃饭花了 30 元` | 支出/餐饮/¥30/个人/微信支付 |
| `收入 5000 工资` | 收入/工资/¥5000/个人/微信支付 |
| `昨天打车 25 支付宝` | 支出/交通出行/¥25/个人/支付宝 |
| `公司买书花了 100` | 支出/学习/¥100/公司/微信支付 |
| 银行交易通知截图文字 | 自动解析金额、商户、时间等 |

### 6.2 分类关键词

| 分类 | 关键词 |
|---|---|
| 餐饮 | 吃饭, 饭, 外卖, 咖啡, 奶茶, 早餐, 午餐, 晚餐, 食堂 |
| 交通出行 | 打车, 地铁, 公交, 加油, 停车, 车费, 交通, 网约车 |
| 购物 | 超市, 淘宝, 购物, 买, 商场, 便利店, 商店 |
| 生活杂费 | 水电, 物业, 话费, 网费, 房租, 生活 |
| 家庭支出 | 家庭, 家里, 孩子, 父母, 家人 |
| 通信费 | 话费, 中国移动, 中国联通, 中国电信, 充值, 流量 |
| ... | ... |

## 7. 差旅补助

- **差旅补助**: ¥100/天
- **交通补助**: ¥30/天
- **合计**: trip_allowance + transport_allowance
- **发放状态**: ✅ 已发放 / ⏳ 待发放 / ❌ 已过期

## 8. 部署指南

### 8.1 本地开发

```bash
# 方式一：Vite 开发服务器（推荐，支持 HMR 热更新）
npm run dev
# 浏览器访问 http://localhost:5173/index.html

# 方式二：Python 服务器（模拟部署环境）
cd web && python3 server.py 18080
# 浏览器访问 http://localhost:18080/index.html

# 构建生产产物
npm run build
# 输出到 dist/ 目录
```

**本地测试流程：**
1. `npm run dev` 启动 Vite 开发服务器，享受 HMR
2. 浏览器打开 http://localhost:5173/index.html 验证功能
3. 测试通过后，`npm run build` 构建生产产物
4. 同步到 NAS 或云端

### 8.2 本地代理说明

`server.py` 提供以下功能：
1. **静态文件服务**：提供 HTML/CSS/JS 文件（或 dist/ 构建产物）
2. **NocoBase API 代理**：所有 `/api/` 请求自动转发到云端 NocoBase，解决 CORS 跨域问题
3. **AI 代理**：`/api/ai/parse` 和 `/api/ai/dispatch` 转发到阿里云百炼
4. **Prompt 管理**：`PUT /api/ai/prompt/:name` 支持 Agent 自修改解析规则

**配置管理**：
- 敏感配置（API URL、Token、AI Key）通过 `.env` 文件管理
- server.py 内置纯标准库 `.env` 加载器，无需 python-dotenv 依赖

### 8.3 数据迁移脚本

| 脚本 | 用途 |
|---|---|
| `scripts/migrate_to_nocobase.py` | SQLite → NocoBase（原始迁移） |
| `scripts/migrate_nocobase_to_nocobase.py` | NocoBase → NocoBase（实例间迁移） |
| `scripts/migrate_sqlite_to_nocobase.py` | SQLite → NocoBase（差旅补助专用） |
| `scripts/create_collections.py` | 在目标 NocoBase 创建表结构 |

### 8.4 访问地址

| 服务 | 本地地址 | 云端地址 |
|---|---|---|
| NocoBase 管理后台 | - | http://121.17.49.100:13000/ |
| 记账本首页 | http://localhost:18080/index.html | - |
| AI 对话 | 右下角悬浮按钮 | - |
| 记录管理 | http://localhost:18080/records.html | - |
| 预算管理 | http://localhost:18080/budget.html | - |
| 统计分析 | http://localhost:18080/stats.html | - |
| 差旅补助 | http://localhost:18080/trip_allowance.html | - |

## 9. 运维注意事项

### 9.1 JWT Token 有效期

- Token 有效期 1 年（至 2027-05-06）
- 到期后需重新生成，修改以下两处：
  1. `web/static/config.js` 中的 `API_TOKEN`（前端）
  2. `.env` 中的 `NOCOBASE_API_TOKEN`（server.py 代理）

### 9.2 NocoBase 集合管理

- 通过 `POST /api/collections` 创建集合（需指定 fields）
- 通过 `POST /api/collections:destroy/{name}` 删除集合
- 通过 `POST /api/collections/{name}/fields` 添加字段
- 通过 `DELETE /api/collections/{name}/fields/{field}` 删除字段

### 9.3 数据备份

- PostgreSQL 数据通过 Docker volume 持久化
- SQLite 原始数据保留在 `/Users/szd/.qclaw/workspace/accounting-skill/database/accounting.db`
