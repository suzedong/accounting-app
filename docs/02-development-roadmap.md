# 开发计划

> **最后更新：2026-05-27**

## 阶段概览

| 阶段 | 名称 | 内容 | 预计时间 | 状态 |
|---|---|---|---|---|
| Phase 1 | Tauri 骨架 + SQLite | 项目初始化、数据库设计、基础 CRUD | 2 周 | ✅ 已完成 |
| Phase 2 | 业务逻辑迁移 | 差旅、统计、预算、设置页面 | 2 周 | ✅ 已完成 |
| Phase 3 | AI 聊天 + Agent | 百炼 API dispatch、11 个 action handlers、OCR | 2 周 | ✅ 已完成 |
| Phase 4 | 同步层 + 清理 | NocoBase 双向同步、清理旧代码 | 2 周 | ✅ 进行中 |
| Phase 5 | 本地 LLM | Candle 推理引擎、Qwen2 模型、GPU 自动检测 | ~7 天 | 📝 规划中 |

**总预计：约 10 周**

---

## Phase 1：Tauri 骨架 + SQLite

> ✅ **已完成**

### 目标

建立 Tauri 项目基本结构，SQLite 数据库可用，基础 CRUD 通过 Tauri IPC 工作。

### 已完成任务

- [x] 初始化 `src-tauri/` 目录（`cargo init` + Tauri 配置）
- [x] 配置 `tauri.conf.json`：前端目录指向 Vue 3 `src/`，窗口配置 900×600
- [x] 配置 `Cargo.toml` 依赖（tauri, rusqlite, serde, chrono, uuid, reqwest, tokio）
- [x] SQLite Schema 初始化（7 张表 + 预置数据）
- [x] Tauri Commands：get_records / get_record / create_record / update_record / delete_record / get_accounts
- [x] 创建 Vue 3 前端（`src/`），替代旧 `web/` 方案
- [x] Pinia 状态管理 + 路由
- [x] `npm run tauri dev` 正常启动，SQLite 数据库文件正确创建，记录 CRUD 正常工作

---

## Phase 2：业务逻辑迁移

> ✅ **已完成**

### 目标

将差旅补助、统计计算、预算分析、Prompt/Preference 管理迁移到 Tauri 环境，完成所有业务页面。

### 已完成任务

- [x] 统计聚合（SQL GROUP BY）：get_stats_summary / get_stats_by_category / get_stats_by_account / get_monthly_trend / get_comparison / get_budget_analysis
- [x] 差旅补助：get_business_trips / create_business_trip / update_business_trip / delete_business_trip + TripAllowance.vue 页面
- [x] 前端页面：Home / Stats / Budget / Settings / Records + Pinia store
- [x] Prompt / Preference / 学习引擎：get_system_prompt / update_system_prompt / get_all_preferences / update_preference / get_learning_corrections / save_correction
- [x] 对话历史：get_chat_history / save_chat_message / clear_chat_history

---

## Phase 3：AI 聊天 + Agent

> ✅ **已完成**

### 目标

实现 AI 对话端到端工作，LLM dispatch → action execute → 结果渲染，支持图片 OCR。

### 已完成任务

- [x] 百炼 API 直连：Rust `call_llm` / `call_llm_with_tools` + 前端 AgentEngine
- [x] 工具注册：ToolRegistry（Zod schema → JSON Schema）+ 20+ 工具（记账 CRUD / 差旅补助 / 统计 / 预算 / 追问 / 偏好 / Prompt 管理）
- [x] 聊天 UI：ChatWidget / ChatMessage / ChatInput / RecordCard / ConfirmCard / CorrectionConfirmCard / FollowUpCard / StepList / DevConsole / SettingsPanel / ImagePreview
- [x] AI 引擎层：agent-engine.ts（三阶段流水线：OCR → LLM 意图识别 → 工具执行，含支付方式防编造清洗）
- [x] Stores：chat.ts（Options API 风格，管理消息/确认/编辑/追问/学习，含 lastConfirmedRecord 修正定位）
- [x] OCR：智能 Python 探测 + 自动安装依赖 + OCR 识别 + Settings 页管理（`.ps1` 支持 Windows，`.sh` 支持 macOS/Linux）

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

#### 4.3 AI Agent 后续增强

> 2026-06-03 已实现基础风险分级修正流：`lastConfirmedRecord`、支付方式防编造、低风险直接执行、高风险 `CorrectionConfirmCard` 确认、StepList 修正 diff 展示。以下为未纳入本期的后续增强。

- [ ] 候选记录选择卡：修正意图匹配到多条可能记录时，让用户选择目标记录
- [ ] 全部修正强制确认模式：提供可选安全策略，所有 `correct_record` / `update_record` 都确认后再落库
- [ ] 跨会话恢复“上一条”：从最近会话或数据库恢复上一条上下文，并设计过期/误匹配保护
- [ ] 删除记录的风险分级确认：对自然语言删除记录增加低/高风险判断和确认流程
- [ ] 差旅补助修正流程重构：将差旅记录修改纳入统一的风险分级修正框架

#### 4.4 清理

- [x] 删除 `server/` 目录（server.py、prompts/、scripts/、python_manager.py 等）
- [x] 迁移关键脚本到 `src-tauri/scripts/`（python_manager.sh、python_manager.ps1、ocr_service.py）
- [x] 删除 `scripts/` 目录（dev.mjs、import_from_nocobase.py 等旧迁移脚本）
- [x] 删除 `.env`（AI/NocoBase 配置已存入 SQLite）
- [x] 删除 `vite.config.js.bak`
- [ ] 精简 `vite.config.js`
- [x] 更新 `CLAUDE.md` 文档

#### 4.5 构建测试

- [ ] `npm run tauri build` 生成 macOS .dmg
- [ ] `npm run tauri build` 生成 Windows .exe/nsis
- [ ] 测试离线运行（断网启动 → 确认所有功能可用）
- [ ] 测试同步功能（连接 NocoBase → 同步 → 确认数据一致）

---

## Phase 5：本地 LLM

> 📝 **规划中**

### 目标

实现完全自包含的本地 LLM 推理能力，不依赖 Ollama 等外部服务，跨平台支持 macOS / Windows。

### 技术选型

**推理引擎：Candle（Hugging Face 纯 Rust 方案）**

| 维度 | Candle | llama-cpp-rs（对比项） |
|---|---|---|
| 语言 | 100% Rust | Rust + C/C++ |
| 编译 | `cargo build` 即可 | 需 CMake + C++ 工具链 |
| GGUF 支持 | ✅ 原生 | ✅ 原生 |
| 推理速度 | 中等（CPU ~10-20 tok/s） | 最快（业界标杆） |
| 跨平台 | 原生跨平台 | 需各平台配编译环境 |
| Tauri 兼容性 | 优秀，零外部依赖 | 需处理 C 库打包 |
| GPU 加速 | Metal (macOS) / CUDA / WGPU | Metal / CUDA / Vulkan |

**模型选择**：Qwen2-1.5B-Instruct（GGUF Q4 ~1GB）—— Candle 官方支持、中文好、零适配风险。

### 架构设计

#### 文件结构

```
~/Library/Application Support/ai-jizhang/     (macOS)
%APPDATA%/ai-jizhang/                          (Windows)
├── app.db                                     (SQLite 数据库)
├── models/                                    (模型文件目录)
│   ├── qwen2-1.5b-instruct-q4_k_m.gguf       (默认模型)
│   └── .model_index.json                      (模型元数据)
└── llm_cache/                                 (可选：推理缓存)
```

#### Candle 依赖

```toml
candle-core = "0.8"
candle-transformers = "0.8"
candle-nn = "0.8"
tokenizers = "0.21"      # HuggingFace tokenizer
```

#### GPU 自动检测

```rust
fn detect_device() -> Device {
    #[cfg(target_os = "macos")]
    if let Ok(d) = Device::new_metal(0) { return d; }
    #[cfg(target_os = "windows")]
    if let Ok(d) = Device::cuda_if_available(0) { return d; }
    Device::Cpu
}
```

#### call_llm 双路径

```rust
#[tauri::command]
pub async fn call_llm(
    app_config: State<'_, AppConfig>,
    system_message: String,
    user_message: String,
) -> Result<String, String> {
    let svc = resolve_active_service(&app_config.data.lock()?)?;
    if svc.local {
        let engine = get_or_load_local_engine(&svc.local_model)?;
        engine.infer(&system_message, &user_message).await
    } else {
        cloud_call(&svc, system_message, user_message).await
    }
}
```

#### AiService 模型扩展

```rust
pub struct AiService {
    pub id: String,
    pub name: String,
    pub api_url: String,
    pub api_key: String,
    pub model: String,
    pub active: bool,
    pub local: bool,               // true = 使用本地模型
    pub local_model: String,       // 本地模型标识
}
```

#### 云端/本地切换（严格二选一）

用户手动切换，本地模式失败时**不自动降级到云端**（保证离线属性）。

```json
[
  {
    "id": "cloud-bailian",
    "name": "百炼 (云端)",
    "api_url": "https://coding.dashscope.aliyuncs.com/v1",
    "api_key": "sk-xxx",
    "model": "qwen-plus",
    "active": true,
    "local": false,
    "local_model": ""
  },
  {
    "id": "local-qwen",
    "name": "Qwen2-1.5B (本地)",
    "api_url": "",
    "api_key": "",
    "model": "",
    "active": false,
    "local": true,
    "local_model": "qwen2-1.5b"
  }
]
```

### 模型管理

#### 下载流程

首次启动 → 引导 Wizard："启用本地 AI 需要下载 1GB 模型" → 后台静默下载 → 默认源 HuggingFace → 备选源 ModelScope → 断点续传 + SHA256 校验 → 下载完成 → 自动加载。

#### Tauri Commands

| Command | 说明 | 参数 | 返回 |
|---|---|---|---|
| `list_available_models` | 获取可下载的模型列表 | 无 | `[{id, name, size, downloaded}]` |
| `download_model` | 下载指定模型 | `model_id: String` | 进度事件流 |
| `pause_download` | 暂停下载 | `model_id: String` | `()` |
| `resume_download` | 恢复下载 | `model_id: String` | `()` |
| `delete_model` | 删除已安装模型 | `model_id: String` | `()` |
| `get_local_engine_status` | 获取本地引擎状态 | 无 | `{loaded, model, device}` |
| `set_proxy` | 配置代理 | `proxy_url: String` | `()` |

#### 模型元数据

```json
{
  "models": {
    "qwen2-1.5b": {
      "name": "Qwen2-1.5B-Instruct",
      "gguf_file": "qwen2-1.5b-instruct-q4_k_m.gguf",
      "size_bytes": 1073741824,
      "sha256": "abc123...",
      "download_urls": [
        "https://huggingface.co/Qwen/Qwen2-1.5B-Instruct-GGUF/resolve/main/...",
        "https://modelscope.cn/models/qwen/Qwen2-1.5B-Instruct-GGUF/resolve/master/..."
      ],
      "downloaded": true,
      "downloaded_at": "2026-05-22T10:00:00Z"
    }
  },
  "active_model": "qwen2-1.5b"
}
```

### UI 设计

#### 设置页新增 Tab：AI 模型

```
设置
├── 基本设置（API Key、NocoBase URL...）
├── AI 模型管理  ← 新增
└── 同步设置

── AI 模型管理 ──────────────────────────────

当前 AI 引擎
┌─────────────────────────────────────────────┐
│  ○ 云端：百炼 (qwen-plus)        [已连接]   │
│  ● 本地：Qwen2-1.5B (离线可用)  [已安装]    │
│     加速：Metal GPU                          │
└─────────────────────────────────────────────┘

已安装模型 / 可下载模型（列表 + 下载按钮）
```

### 开发计划

#### Phase 0：Candle 最小验证（0.5 天）

- [ ] 创建独立 demo 项目（`examples/candle-demo/`）
- [ ] 加载 Qwen2-1.5B GGUF，验证模型加载
- [ ] 跑一句 dispatch prompt，验证推理 + JSON 输出

**里程碑 M0**：确认 Candle 能加载 Qwen2 GGUF 并正确推理。**不通过则调整方案。**

#### Phase 1：模型下载管理（2 天）

- [ ] 实现模型元数据（`src-tauri/src/llm/model_index.rs`）
- [ ] 实现下载管理器（`src-tauri/src/llm/downloader.rs`）：流式下载 + 断点续传 + SHA256
- [ ] 代理配置（`src-tauri/src/llm/proxy.rs`）
- [ ] 下载 Tauri Commands（`src-tauri/src/commands/llm.rs`）
- [ ] 前端 API 封装（`src/api/tauri.ts`）

**里程碑 M1**：设置页可列出模型并执行下载，支持断点续传。

#### Phase 2：Candle 集成（2 天）

- [ ] 添加 Candle 依赖（`Cargo.toml`）
- [ ] GPU 自动检测（`src-tauri/src/llm/device.rs`）
- [ ] 实现本地推理引擎（`src-tauri/src/llm/engine.rs`）
- [ ] 修改 `call_llm` 双路径路由（`src-tauri/src/commands/config.rs`）
- [ ] 扩展 `AiService` 添加 local/local_model 字段（`src-tauri/src/models/mod.rs`）

**里程碑 M2**：本地推理引擎集成到 Tauri，云端/本地可切换。

#### Phase 3：前端 UI（1.5 天）

- [ ] 首次启动引导（`src/components/chat/WelcomeWizard.vue`）
- [ ] AI 模型管理 Tab（`src/views/Settings.vue`）
- [ ] 下载进度组件（`src/components/settings/DownloadProgress.vue`）
- [ ] 引擎切换 UI（`src/components/settings/EngineSwitch.vue`）

**里程碑 M3**：用户可完整体验下载、切换、使用本地 AI。

#### Phase 4：体验优化（1 天）

- [ ] 模型加载提示（"AI 引擎初始化中..."）
- [ ] 离线模式指示（`ChatWidget.vue` 顶部"离线"标签）
- [ ] 代理配置 UI（`Settings.vue` 代理地址输入框）
- [ ] 性能调优（temperature、top_p 调优）

**里程碑 M4**：完整用户体验，本地 AI 端到端可用。

### 时间估算

| 阶段 | 时间 | 累计 |
|---|---|---|
| Phase 0：最小验证 | 0.5 天 | 0.5 天 |
| Phase 1：下载管理 | 2 天 | 2.5 天 |
| Phase 2：Candle 集成 | 2 天 | 4.5 天 |
| Phase 3：前端 UI | 1.5 天 | 6 天 |
| Phase 4：体验优化 | 1 天 | 7 天 |
| **总计** | | **约 7 个工作日** |

### 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Candle 不支持 Qwen2 | 阻塞 Phase 2 | Phase 0 先验证，不通过换 Llama 或 llama-cpp-rs |
| 模型推理太慢 | 用户体验差 | 限制 context length、降低 max_tokens |
| GGUF 下载失败 | 无法安装 | 断点续传 + 多镜像源 + 代理 |
| macOS 签名/公证 | 发布延迟 | 提前测试 notarization |
| 内存不足 | 崩溃 | 启动前检查可用内存 |

### 参考链接

- [Candle GitHub](https://github.com/huggingface/candle)
- [Candle Qwen2 示例](https://github.com/huggingface/candle/tree/main/candle-examples)
- [Qwen2 GGUF 文件](https://huggingface.co/Qwen/Qwen2-1.5B-Instruct-GGUF)
- [ModelScope](https://modelscope.cn)

---

## 里程碑总览

| 里程碑 | 完成标志 | 预计时间 | 状态 |
|---|---|---|---|
| M1: 基础可用 | Phase 1 完成，记录 CRUD 在桌面端工作 | 第 2 周末 | ✅ 已达成 |
| M2: 功能完整 | Phase 2 完成，所有业务页面可用 | 第 4 周末 | ✅ 已达成 |
| M3: AI 可用 | Phase 3 完成，AI 对话 + OCR 均可用 | 第 6 周末 | ✅ 已达成 |
| M4: 同步可用 | Phase 4 完成，可导入并双向同步 | 第 8 周末 | ❌ 待达成 |
| M5: 本地 LLM 可用 | Phase 5 完成，本地模型可完成记账 dispatch | 第 10 周末 | 📝 待达成 |
