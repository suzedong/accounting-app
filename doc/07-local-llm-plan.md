# 本地 LLM 方案

## 目标

将 AI 推理从云端 API 迁移到本地模型，实现**完全离线可用**的 AI 记账功能。

### 核心要求

- **完全自包含**：不依赖用户额外安装 Ollama 等外部工具
- **跨平台**：macOS + Windows
- **按需下载**：模型文件不打包进应用，用户可选择性下载
- **纯 Rust 实现**：零 C/C++ 依赖，编译简单，Tauri 兼容性好

---

## 技术选型

### 推理引擎：Candle（Hugging Face 纯 Rust 方案）

| 维度 | Candle | llama-cpp-rs（对比项） |
|---|---|---|
| 语言 | 100% Rust | Rust + C/C++ |
| 编译 | `cargo build` 即可 | 需 CMake + C++ 工具链 |
| GGUF 支持 | ✅ 原生 | ✅ 原生 |
| 推理速度 | 中等（CPU ~10-20 tok/s） | 最快（业界标杆） |
| 跨平台 | 原生跨平台 | 需各平台配编译环境 |
| Tauri 兼容性 | 优秀，零外部依赖 | 需处理 C 库打包 |
| GPU 加速 | Metal (macOS) / CUDA / WGPU | Metal / CUDA / Vulkan |

**选择理由**：记账 dispatch 是短文本结构化提取（每次 500-2000 token），Candle 的性能完全够用，且纯 Rust 方案大幅降低跨平台编译风险。

### 模型选择

| 模型 | GGUF Q4 大小 | 优点 | 推荐度 |
|---|---|---|---|
| Qwen2-1.5B-Instruct | ~1GB | Candle 官方支持、中文好、零适配风险 | ⭐⭐⭐⭐⭐ 首选验证 |
| Qwen2.5-1.5B-Instruct | ~1GB | 指令遵循更强 | ⭐⭐⭐⭐ 后续升级 |
| Qwen2-3B-Instruct | ~2GB | 质量更高 | ⭐⭐⭐⭐ 可选 |
| Phi-3.5-mini-Instruct | ~2.3GB | 微软出品 | ⭐⭐⭐ 备选 |

**首选验证 Qwen2-1.5B-Instruct**：Candle 官方已支持，零适配风险。验证通过后如需更强能力可升级到 Qwen2.5。

---

## 架构设计

### 文件结构

```
~/Library/Application Support/ai-jizhang/     (macOS)
%APPDATA%/ai-jizhang/                          (Windows)
├── app.db                                     (SQLite 数据库)
├── models/                                    (模型文件目录)
│   ├── qwen2-1.5b-instruct-q4_k_m.gguf       (默认模型)
│   ├── qwen2-3b-instruct-q4_k_m.gguf         (可选)
│   └── .model_index.json                      (模型元数据)
└── llm_cache/                                 (可选：推理缓存)
```

### 应用包体积

| 组件 | 体积 |
|---|---|
| Tauri + Vue 前端 | ~15MB |
| Rust 后端 + Candle 依赖 | ~30MB |
| 模型文件 | 0（按需下载） |
| **总计** | **~45-50MB** |

### Candle 依赖

```toml
# src-tauri/Cargo.toml
candle-core = "0.8"
candle-transformers = "0.8"
candle-nn = "0.8"
tokenizers = "0.21"      # HuggingFace tokenizer
```

### GPU 自动检测策略

```rust
fn detect_device() -> Device {
    // 1. 优先 Metal (macOS Apple Silicon)
    #[cfg(target_os = "macos")]
    if let Ok(d) = Device::new_metal(0) {
        return d;
    }
    // 2. 尝试 CUDA (Windows NVIDIA)
    #[cfg(target_os = "windows")]
    if let Ok(d) = Device::cuda_if_available(0) {
        return d;
    }
    // 3. 回退 CPU
    Device::Cpu
}
```

**策略**：自动检测，有就用，没有就 CPU 兜底。UI 显示当前加速方式。

### 数据流

```
用户输入
  │
  ▼
前端：chat.sendMessage(text)
  │
  ▼
chat store：dispatchLLM(system_prompt, user_input)
  │
  ▼
Tauri invoke：call_llm(system_message, user_message)
  │
  ├─ 云端模式 → reqwest → 百炼 API → 返回 JSON
  │
  └─ 本地模式 → Candle 推理引擎 → 加载 GGUF → 生成文本 → 解析 JSON
                    │
                    ├─ 模型已加载 → 直接推理
                    ─ 模型未加载 → 自动加载（~2秒）
```

### AiService 模型扩展

```rust
pub struct AiService {
    pub id: String,
    pub name: String,
    pub api_url: String,           // 云端 API 地址
    pub api_key: String,           // 云端 API Key
    pub model: String,             // 云端模型名称
    pub active: bool,
    pub local: bool,               // true = 使用本地模型
    pub local_model: String,       // 本地模型标识（如 "qwen2-1.5b"）
}
```

### 云端/本地切换（严格二选一）

```json
// app_config 表中的 ai_services JSON
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

**切换逻辑**：用户手动切换，本地模式失败时**不自动降级到云端**（保证离线属性）。失败时提示用户手动切换。

---

## call_llm 双路径实现

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

---

## 模型管理

### 下载流程

```
首次启动 → 引导 Wizard："启用本地 AI 需要下载 1GB 模型"
  │
  ├─ 用户点击"开始下载" → 后台静默下载
  │   │
  │   ├─ 默认源：HuggingFace
  │   ├─ 备选源：ModelScope / WiseModel（国内镜像）
  │   ├─ 支持 HTTP 代理配置
  │   ─ 断点续传 + SHA256 校验
  │
  └─ 下载完成 → 自动加载 → 提示切换本地模式
```

### Tauri Commands

| Command | 说明 | 参数 | 返回 |
|---|---|---|---|
| `list_available_models` | 获取可下载的模型列表 | 无 | `[{id, name, size, downloaded}]` |
| `download_model` | 下载指定模型 | `model_id: String` | 进度事件流 |
| `pause_download` | 暂停下载 | `model_id: String` | `()` |
| `resume_download` | 恢复下载 | `model_id: String` | `()` |
| `delete_model` | 删除已安装模型 | `model_id: String` | `()` |
| `get_local_engine_status` | 获取本地引擎状态 | 无 | `{loaded: bool, model: string, device: string}` |
| `set_proxy` | 配置代理 | `proxy_url: String` | `()` |

### 代理配置

| 配置项 | 说明 |
|---|---|
| 位置 | 设置页 → 网络设置 → HTTP 代理 |
| 格式 | `http://127.0.0.1:7890` 或 `socks5://127.0.0.1:7890` |
| 范围 | 模型下载 + 云端 API 调用全局生效 |

### 模型元数据

```json
// models/.model_index.json
{
  "models": {
    "qwen2-1.5b": {
      "name": "Qwen2-1.5B-Instruct",
      "gguf_file": "qwen2-1.5b-instruct-q4_k_m.gguf",
      "size_bytes": 1073741824,
      "sha256": "abc123...",
      "download_urls": [
        "https://huggingface.co/Qwen/Qwen2-1.5B-Instruct-GGUF/resolve/main/qwen2-1.5b-instruct-q4_k_m.gguf",
        "https://modelscope.cn/models/qwen/Qwen2-1.5B-Instruct-GGUF/resolve/master/qwen2-1.5b-instruct-q4_k_m.gguf"
      ],
      "downloaded": true,
      "downloaded_at": "2026-05-22T10:00:00Z"
    }
  },
  "active_model": "qwen2-1.5b"
}
```

---

## UI 设计

### 设置页新增 Tab：AI 模型

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

已安装模型
─────────────────────────────────────────────┐
│ Qwen2-1.5B-Instruct        1.0 GB   ✅      │
│ Qwen2-3B-Instruct          2.0 GB   ✅      │
└─────────────────────────────────────────────┘

可下载模型
─────────────────────────────────────────────┐
│ Phi-3.5-mini-Instruct      2.3 GB   [下载]  │
└─────────────────────────────────────────────┘
```

### 首次启动引导 Wizard

```
┌─────────────────────────────────────────────┐
│ 欢迎使用 AI 记账！                            │
│                                             │
│ 你可以选择：                                 │
│ 1. 云端模式：秒回，需要网络                   │
│ 2. 本地模式：离线可用，需下载 1GB 模型        │
│                                             │
│ [仅用云端]    [下载并开始使用本地模式]        │
└─────────────────────────────────────────────┘
```

---

## 开发计划

### Phase 0：Candle 最小验证（0.5 天）

| # | 任务 | 文件 | 说明 |
|---|---|---|---|
| 0.1 | 创建独立 demo 项目 | `examples/candle-demo/` | 不集成到 Tauri |
| 0.2 | 加载 Qwen2-1.5B GGUF | `main.rs` | 验证模型加载 |
| 0.3 | 跑一句 dispatch prompt | `main.rs` | 验证推理 + JSON 输出 |

**里程碑 M0**：确认 Candle 能加载 Qwen2 GGUF 并正确推理。**不通过则调整方案，不浪费后续时间。**

### Phase 1：模型下载管理（2 天）

| # | 任务 | 文件 | 说明 |
|---|---|---|---|
| 1.1 | 实现模型元数据 | `src-tauri/src/llm/model_index.rs` | 读写 `.model_index.json` |
| 1.2 | 实现下载管理器 | `src-tauri/src/llm/downloader.rs` | 流式下载 + 断点续传 + SHA256 |
| 1.3 | 代理配置 | `src-tauri/src/llm/proxy.rs` | HTTP 代理支持 |
| 1.4 | 下载 Tauri Commands | `src-tauri/src/commands/llm.rs` | list/download/pause/delete |
| 1.5 | 前端 API 封装 | `src/api/tauri.ts` | 下载相关 invoke 函数 |

**里程碑 M1**：设置页可列出模型并执行下载，支持断点续传。

### Phase 2：Candle 集成（2 天）

| # | 任务 | 文件 | 说明 |
|---|---|---|---|
| 2.1 | 添加 Candle 依赖 | `Cargo.toml` | candle-core, candle-transformers, tokenizers |
| 2.2 | GPU 自动检测 | `src-tauri/src/llm/device.rs` | Metal/CUDA/CPU 自动切换 |
| 2.3 | 实现本地推理引擎 | `src-tauri/src/llm/engine.rs` | GGUF 加载 + 推理 |
| 2.4 | 修改 `call_llm` | `src-tauri/src/commands/config.rs` | 双路径路由 |
| 2.5 | 扩展 `AiService` | `src-tauri/src/models/mod.rs` | 添加 local/local_model |

**里程碑 M2**：本地推理引擎集成到 Tauri，云端/本地可切换。

### Phase 3：前端 UI（1.5 天）

| # | 任务 | 文件 | 说明 |
|---|---|---|---|
| 3.1 | 首次启动引导 | `src/components/chat/WelcomeWizard.vue` | 云端/本地选择 |
| 3.2 | AI 模型管理 Tab | `src/views/Settings.vue` | 模型列表 + 下载 |
| 3.3 | 下载进度组件 | `src/components/settings/DownloadProgress.vue` | 进度条 + 速度 |
| 3.4 | 引擎切换 UI | `src/components/settings/EngineSwitch.vue` | 云端/本地切换 |

**里程碑 M3**：用户可完整体验下载、切换、使用本地 AI。

### Phase 4：体验优化（1 天）

| # | 任务 | 文件 | 说明 |
|---|---|---|---|
| 4.1 | 模型加载提示 | `src/components/chat/` | "AI 引擎初始化中..." |
| 4.2 | 离线模式指示 | `src/components/chat/ChatWidget.vue` | 顶部"离线"标签 |
| 4.3 | 代理配置 UI | `src/views/Settings.vue` | 代理地址输入框 |
| 4.4 | 性能调优 | `src-tauri/src/llm/engine.rs` | temperature、top_p 调优 |

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

---

## 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Candle 不支持 Qwen2 | 阻塞 Phase 2 | Phase 0 先验证，不通过换 Llama 或 llama-cpp-rs |
| 模型推理太慢 | 用户体验差 | 限制 context length、降低 max_tokens |
| GGUF 下载失败 | 无法安装 | 断点续传 + 多镜像源 + 代理 |
| macOS 签名/公证 | 发布延迟 | 提前测试 notarization |
| 内存不足 | 崩溃 | 启动前检查可用内存 |

---

## 参考链接

- [Candle GitHub](https://github.com/huggingface/candle)
- [Candle Qwen2 示例](https://github.com/huggingface/candle/tree/main/candle-examples)
- [Qwen2 GGUF 文件](https://huggingface.co/Qwen/Qwen2-1.5B-Instruct-GGUF)
- [ModelScope](https://modelscope.cn)
