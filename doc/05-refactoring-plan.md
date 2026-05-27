# 重构方案

## 1. 重构范围

### 1.1 需要大改的部分

| 组件 | 当前 | 目标 | 改动量 |
|---|---|---|---|
| 数据层 | NocoBase REST API | SQLite + Tauri invoke | **大改** |
| 后端服务 | server.py 代理 | Rust Tauri 后端 | **完全重写** |
| AI 调用 | server.py 代理百炼 | 前端直连百炼 API | **中改** |
| OCR | server.py + PaddleOCR | Rust 子进程调用 PaddleOCR（保留 server/ocr_service.py） | **已实现（Python 子进程）** |
| Prompt | server.py 文件管理 | SQLite 存储 | **中改** |
| Preference | preferences.md | SQLite 存储 | **中改** |
| 学习引擎 | localStorage | SQLite | **中改** |
| 对话历史 | localStorage | SQLite | **中改** |

### 1.2 基本不变的部分

| 组件 | 说明 |
|---|---|
| HTML 页面 | 5 个页面布局不变，仅改数据获取调用 |
| CSS 样式 | 现有样式全部保留 |
| ECharts | 统计图表，替换原 Vue Data UI |
| parse.js | 规则解析（纯 JS，不依赖后端） |
| Agent 意图识别逻辑 | dispatch 逻辑不变，仅改调用方式 |

## 2. 数据层重构方案

### 2.1 当前数据流

```
前端 → fetch('/api/records')
     → Vite proxy → server.py → NocoBase REST API
```

### 2.2 目标数据流

```
前端 → invoke('get_records') → Rust → SQLite
```

### 2.3 改造步骤

**Step 1：创建 db-api.js 替代 nocobase-api.js**

```javascript
// web/js/modules/db-api.js（新建）
import { invoke } from '@tauri-apps/api/core';

export async function getRecords(options = {}) {
    return await invoke('get_records', options);
}

export async function getRecord(id) {
    return await invoke('get_record', { id });
}

export async function createRecord(data) {
    return await invoke('create_record', { fields: data });
}

export async function updateRecord(id, data) {
    return await invoke('update_record', { id, fields: data });
}

export async function deleteRecord(id) {
    return await invoke('delete_record', { id });
}

// ... 其余函数
```

**Step 2：更新 globals.js**

```javascript
// 旧
import * as NocobaseAPI from './modules/nocobase-api.js';
window.NocobaseAPI = NocobaseAPI;

// 新
import * as DbAPI from './modules/db-api.js';
window.NocobaseAPI = DbAPI;  // 保持全局变量名不变，减少页面改动
```

**Step 3：逐个页面适配**

页面代码基本不需要改，因为 `window.NocobaseAPI` 接口保持一致。唯一需要确认的是返回格式一致。

### 2.4 简化：删除 categories 和 payment_methods 表

AI 解析提取的是具体名称（"招商银行信用卡"、"午餐"），不是预置的抽象分类（"信用卡"、"餐饮"）。

| 表 | 处理 |
|---|---|
| `payment_methods` | 删除，`records.payment_method` 直接存自由文本 |
| `categories` | 删除，`records.category` 直接存自由文本 |

影响：
- Prompt 中不再列举分类列表，改为"根据用户输入提取分类，保持用词一致"
- stats 页面按 category GROUP BY 时自然就是细粒度分类
- 规则管理面板的下拉选择改为自由输入
- SQLite schema 从 9 张表减到 7 张

### 2.5 NocoBase API 返回格式 vs SQLite 返回格式

需要确保 Rust 端返回格式与 NocoBase API 一致：

```json
// NocoBase 格式
{
    "data": [{ "id": 1, "datetime": "...", ... }],
    "meta": { "count": 100 }
}

// Rust 端返回（保持一致）
{
    "data": [{ "id": 1, "datetime": "...", ... }],
    "meta": { "count": 100 }
}
```

## 3. AI 层重构方案

### 3.1 当前流程

```
前端 → fetch('/api/ai/dispatch')
     → server.py → 百炼 API（server.py 持有 API Key）
```

### 3.2 目标流程

```
前端 → fetch('https://coding.dashscope.aliyuncs.com/...', {
           headers: { 'Authorization': `Bearer ${apiKey}` }
       })
```

### 3.3 API Key 管理

API Key 存储在 Rust 端的 `config.json`，前端通过 invoke 获取：

```javascript
// ai-parser.js / agent-core.js
const apiKey = await invoke('get_config', { key: 'ai_api_key' });
const apiUrl = await invoke('get_config', { key: 'ai_api_url' });
const model = await invoke('get_config', { key: 'ai_model' });

const response = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestData)
});
```

### 3.4 Prompt 注入

当前 server.py 在代理层注入 prompt + preferences。重构后由前端自行组装：

```javascript
// agent-core.js
const dispatchPrompt = await invoke('get_system_prompt', { name: 'dispatch' });
const preference = await invoke('get_preference');
const learningContext = getPromptContext(); // 本地学习数据

const response = await fetch(apiUrl, {
    body: JSON.stringify({
        model,
        messages: [
            { role: 'system', content: dispatchPrompt + preference + learningContext },
            { role: 'user', content: text }
        ]
    })
});
```

## 4. OCR 重构方案

### 4.1 当前流程

```
前端图片 → fetch('/api/ai/ocr')
         → server.py → PaddleOCR (Python)
```

### 4.2 目标流程

```
前端图片 → invoke('ocr_recognize', { imageBase64 })
         → Rust → 探测 Python → 调用 ocr_service.py → PaddleOCR → 文本
```

**OCR 方案**：
- 使用 `server/ocr_service.py`（原有 PaddleOCR Python 脚本）
- Rust 端智能探测 Python（跨平台：Windows `py`/`python`/`python3`，macOS `python3`，Linux `python3`）
- 首次使用时自动 `pip install paddlepaddle paddleocr`
- 通过临时文件传递 base64 图片数据（避免命令行长度限制）

### 4.3 Rust 端实现

```rust
// src-tauri/src/commands/ocr.rs
// 跨平台：Python 子进程调用 PaddleOCR
pub async fn ocr_recognize(image_base64: String) -> Result<String, String> {
    // 探测 Python → 检查 paddleocr 已安装 → 调用 ocr_service.py
}
```

**Tauri Commands**：
- `check_ocr_status()` — 检查 OCR 状态（Python 路径/版本/paddleocr 安装状态）
- `install_ocr_dependencies()` — 自动安装 paddleocr 依赖
- `set_ocr_enabled(enabled)` — 启用/禁用 OCR
- `ocr_recognize(image_base64)` — 执行 OCR 识别

### 4.4 前端适配

Settings 页提供 OCR 管理：
- Python 路径、版本、PaddleOCR 安装状态展示
- 安装依赖按钮（首次使用时自动 pip install）
- 启用/禁用开关

```typescript
// 旧：server.py 代理
fetch('/api/ai/ocr', {
    body: JSON.stringify({ base64: compressedUrl })
})

// 新：Rust 子进程调用
const { invoke } = await import('@tauri-apps/api/core');
const result = await invoke('ocr_recognize', { imageBase64: compressedUrl });
```

## 5. Prompt / Preference / Learning 重构方案

### 5.1 为什么放数据库（而非文件）

这三类数据有以下共同特征：
- **Agent 动态写入**：dispatch 可通过 `update_prompt` 自修改，preference 可通过 `save_preference` 自修改
- **需要多设备同步**：多台客户端需要共享这些数据，复用 NocoBase 同步逻辑即可
- **结构化查询**：learning_data 需要 `GROUP BY key` 聚合，文件需要全量加载再过滤

### 5.2 多设备同步策略

| 数据类型 | 同步方式 | 冲突处理 |
|---|---|---|
| system_prompts | 按 `name` 匹配，比较 `updated_at` | last-write-wins |
| user_preferences | 按 `key` 匹配，比较 `updated_at` | last-write-wins |
| learning_data | 每条独立 `uuid`，新增插入 | 不会冲突 |

复用 records 的 push/pull 逻辑，无需额外机制。

### 5.3 迁移

| 当前 | 目标 |
|---|---|
| `server/prompts/dispatch.md` | `system_prompts` 表 |
| `server/prompts/record.md` | `system_prompts` 表 |
| `server/prompts/preferences.md` | `user_preferences` 表 |
| `server/prompts/README.md` | 合并到 dispatch.md 注释 |

### 5.4 迁移工具

Phase 3 的数据导入功能中增加：

```rust
#[tauri::command]
async fn import_prompts_from_files(
    dispatch_path: String,
    record_path: String,
    pref_path: String,
) -> Result<(), String> {
    // 读取现有 .md 文件 → 写入 SQLite
}
```

## 6. ~~前端最小化改动策略~~（已废弃）

> **注意**：本方案基于"保留现有 HTML/JS，只改底层"的渐进式改造思路。
> 现已改为**完全重写**方案（Vue 3 + TypeScript），详见 `~/.claude/plans/curious-crafting-octopus.md`。
> 本节保留仅作历史参考。

### 6.1 保持全局变量名不变

```javascript
// globals.js
// 旧：window.NocobaseAPI = NocobaseAPI;
// 新：window.NocobaseAPI = DbAPI;  // 保持 NocobaseAPI 名
```

这样所有页面的 `NocobaseAPI.xxx()` 调用不需要改。

### 6.2 保持返回格式不变

Rust 端 `get_records` 返回：

```rust
serde_json::json!({
    "data": records,
    "meta": { "count": total }
})
```

与 NocoBase API 格式一致。

### 6.3 需要改动的文件清单

| 文件 | 改动内容 |
|---|---|
| `globals.js` | 挂载 DbAPI 替代 NocobaseAPI |
| `modules/nocobase-api.js` | 改名为 `db-api.js`，函数改为 invoke |
| `modules/ai-parser.js` | API 调用改为直连百炼 |
| `modules/agent-core.js` | dispatch 调用改为直连百炼 |
| `modules/learning-engine.js` | 存储改为 invoke |
| `modules/chat-widget.js` | OCR 改为 invoke |
| `modules/config.js` | 移除 NocoBase 配置，增加本地配置 |
| `pages/*.html` | 基本不需要改 |

## 7. server.py 移除清单

重构完成后，以下文件和目录可安全删除：

```
server/server.py                    # 主服务器
server/prompts/dispatch.md          # → SQLite
server/prompts/record.md            # → SQLite
server/prompts/preferences.md       # → SQLite
server/prompts/README.md            # → 文档合并
server/scripts/*.py                 # 迁移脚本（保留归档）
dev.mjs                             # 双进程管理（不再需要）
vite.config.js 中的 proxy 配置      # 不再需要代理
package.json 中的 dev:backend       # 不再需要启动 server.py
```

> 注意：`server/ocr_service.py` **保留**，Rust 端通过子进程调用。

## 8. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| Python 或 PaddleOCR 安装失败 | OCR 不可用 | 跨平台智能探测 + 自动 pip install + 手动安装指引 |
| Tauri WebView 版本不兼容 | 部分 API 不可用 | 测试主流平台 WebView 版本，必要时 polyfill |
| SQLite 并发写入冲突 | 数据丢失 | 使用 WAL 模式，单连接写操作 |
| 百炼 API 前端暴露 Key | 安全 | 个人使用可接受，加 Referer 白名单 |
| NocoBase 同步失败 | 数据不同步 | 本地优先，同步失败不影响使用 |

## 9. 兼容性过渡期

为平滑过渡，Phase 3 同步层完成前：

1. **保留现有 C/S 架构同时运行**：在 NocoBase 中继续记录
2. **Phase 3 完成后**：使用 `import_from_nocobase()` 全量导入
3. **导入验证**：对比导入前后记录数量、总金额
4. **废弃 server.py**：确认桌面端稳定后删除
