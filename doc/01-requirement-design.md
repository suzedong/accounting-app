# 需求设计

## 1. 项目背景

当前项目是基于 NocoBase + server.py 代理的纯前端记账 Web 应用。存在以下核心问题：

- **server.py 是最不稳定的环节**：需要公网 IP 和端口，可能是临时机器，配置不高，维护成本高
- **NocoBase 虽已部署但并非必要条件**：用户可能在无网络环境、出差场景下使用
- **数据可用性强依赖服务在线**：NocoBase 宕机或 server.py 断连 → 应用完全不可用
- **多设备数据同步困难**：依赖云端 NocoBase，NAS 内网访问受限

## 2. 目标

**将应用从"依赖云端服务的 C/S 架构"重构为"本地优先（Local-first）的桌面应用程序"。**

核心原则：
- **数据永远可用**：所有数据存储在本地 SQLite，不依赖任何外部服务
- **零自有服务依赖**：不需要 server.py、不需要公网 IP、不需要端口映射
- **NocoBase 作为可选同步目标**：有连接时同步，无连接时完全本地运行
- **AI 能力直连**：前端直连云端 AI API（百炼），无需代理层
- **桌面原生体验**：系统通知、全局快捷键、文件关联

## 3. 功能需求

### 3.1 核心功能（现有，需完整迁移）

| 功能 | 说明 | 当前实现 | 目标 |
|---|---|---|---|
| AI 对话记账 | 自然语言输入 → 意图识别 → 创建记录 | Agent Core + LLM dispatch | 桌面内集成，数据存本地 |
| 规则解析 | 关键词匹配 + 正则提取（降级方案） | parse.js | 保留，本地运行 |
| 记录管理 | 增删改查 + 分页 + 筛选 | records.html | 存 SQLite |
| 预算管理 | 月度预算跟踪 + 超支预警 | budget.html | 存 SQLite |
| 统计分析 | 多维度图表（分类、账户、趋势、对比） | stats.html + Chart.js | SQLite GROUP BY + ECharts |
| 差旅补助 | 出差记录 + 补助发放 + 金额匹配 | trip_allowance.html | 存 SQLite |
| OCR 识别 | 图片识别 → 自动记账 | PaddleOCR via server.py | 内置 RapidOCR（ONNX） |
| 学习引擎 | 用户修正 → 个性化规则 | localStorage + NocoBase | 存 SQLite |
| 对话历史 | AI 对话记录 | localStorage | 存 SQLite |

### 3.2 新增功能

| 功能 | 说明 |
|---|---|
| 本地存储 | SQLite 替代 NocoBase 作为主数据源 |
| 数据同步 | 本地 ↔ NocoBase 双向同步（可选） |
| 系统通知 | 记账成功/失败系统级通知 |
| 全局快捷键 | 一键呼出记账窗口 |
| 配置管理 | API Key、NocoBase URL 等设置（本地配置文件） |
| 数据导出 | 导出 CSV/Excel |
| 数据导入 | 从现有 NocoBase 数据导入 |

### 3.3 功能保留不变

| 功能 | 说明 |
|---|---|
| AI 意图识别 | 调用百炼 API，直连不调用代理 |
| 偏好管理 | 从 server.py 的 preferences.md 改为 SQLite 存储 |
| Prompt 管理 | dispatch.md / record.md 改为 SQLite 存储 |
| 账户管理 | 从 NocoBase collections 改为硬编码预置 |
| 分类/支付方式 | 不再需要独立表，records 中直接存自由文本 |

## 4. 非功能需求

### 4.1 可用性

- **离线可用**：无网络时所有核心功能正常（记账、查询、统计、管理）
- **启动时间**：冷启动 < 2 秒
- **操作延迟**：本地操作 < 100ms（无网络等待）

### 4.2 性能

- SQLite 查询：万级记录量级下响应 < 200ms
- 统计聚合：利用 SQL GROUP BY，不再全量拉数据到前端计算
- OCR 识别：本地 RapidOCR 单次 < 2 秒

### 4.3 数据一致性

- 本地 SQLite 为数据源（Source of Truth）
- NocoBase 为可选同步目标，不参与日常读写
- 同步策略：last-write-wins（个人记账场景足够）
- 冲突处理：同一 ID 两边都有修改时保留两份，标记冲突

### 4.4 包体积

- Tauri 应用包：约 5-10 MB（含 RapidOCR ONNX 模型 ~10MB）
- 内存占用：< 150 MB

### 4.5 跨平台

- macOS（Intel + Apple Silicon）
- Windows 10+
- Linux（可选）

## 5. 约束与限制

| 约束 | 说明 |
|---|---|
| 数据模型兼容 | 与现有 NocoBase schema 对齐，方便数据导入/同步 |
| 前端代码复用 | 现有 HTML/CSS/JS 代码应最大限度复用 |
| 框架选择 | Vue 3 + TypeScript + Element Plus（桌面应用非 Web，框架开销可接受）|
| AI 成本 | 不使用百炼视觉模型（额外收费），OCR 用本地方案 |
| 用户群体 | 个人用户，单用户场景，不需要多租户/权限管理 |
