# 记账本应用（Accounting-App）

本地优先（Local-first）的桌面记账应用，基于 **Tauri 2 + Vue 3 + libSQL (SQLite)**，集成阿里云百炼 LLM 与 PaddleOCR，可选启用 Turso 云端做双向同步（libSQL Embedded Replica）。

---

## 快速开始

```bash
# 安装依赖
npm install

# 开发模式（桌面窗口 + Vite HMR）
npm run dev

# 生产构建
npm run build
npm run tauri build   # 打包桌面安装包（macOS .dmg / Windows .exe）
```

### 前置环境

- Node.js ≥ 18、Rust toolchain（稳定版）
- macOS / Windows（两端均需可构建）
- Python 3.x + PaddleOCR（首次运行可由 `src-tauri/scripts/python_manager.*` 自动管理）

### 首次运行

启动后在 **Settings 页** 配置：

1. AI 服务（API Key、模型，存入 SQLite `app_config`）
2. Turso 云同步参数（可选：启用开关、URL、Token）
3. 个性化偏好（默认账户、支付方式映射等）

---

## 核心功能

- AI 对话记账（自然语言 → 意图识别 → 创建记录）
- 记录管理（增删改查 + 分页 + 筛选）
- 预算管理（月度预算跟踪 + 超支预警）
- 统计分析（分类 / 账户 / 趋势 / 对比图表）
- 差旅补助（出差记录 + 补助发放 + 金额匹配）
- OCR 识别（PaddleOCR 图片识别 → 自动记账）
- 学习引擎（用户修正 → 个性化规则）
- 数据同步（本地 libSQL ↔ Turso 云端双向同步，可选启用）

---

## 文档导航

| 文档 | 用途 |
|---|---|
| [AGENTS.md](AGENTS.md) | 开发规则与规范（**开发前必读**） |
| [CODE_WIKI.md](CODE_WIKI.md) | 代码实现现状（架构、模块、API、数据库、数据流） |
| [docs/01-项目概览.md](docs/01-项目概览.md) | 业务需求 + 界面设计蓝图 |
| [docs/02-开发路线图.md](docs/02-开发路线图.md) | 开发计划与里程碑 |
| [docs/03-活跃设计文档.md](docs/03-活跃设计文档.md) | 进行中的设计与重构 |
| [scripts/README.md](scripts/README.md) | 数据迁移/校验脚本说明 |

---

## 许可证

MIT License
