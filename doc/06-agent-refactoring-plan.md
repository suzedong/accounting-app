# AI Agent 架构重构方案

## 1. 背景与目标

### 1.1 现状

当前 Agent 架构采用 **手写 dispatch prompt + JSON 解析** 模式：

- LLM 调用：通过 `callLLM(systemMessage, text)` 传入一个 50+ 行的 JSON schema 定义在 system prompt 中
- 响应解析：用正则 `content.match(/```(?:json)?\s*([\s\S]*?)\s*```/)` 提取 JSON，然后 `JSON.parse`
- 上下文管理：每次调用用 `buildConversationContext()` 拼接最近 6 条消息为字符串
- 状态管理：`ChatWidget.vue` 1200 行，同时充当 store、orchestrator 和 presenter
- 思考过程：3 个硬编码延迟（300ms + 200ms + 100ms）模拟"思考"
- 工具调用：`actionHandlers` 注册表，参数类型 `Record<string, unknown>` 无类型安全

### 1.2 目标

1. **用 Function Calling 替代手写 dispatch prompt** — 标准格式、不 parse JSON、token 减半
2. **推理链可视化** — 每条消息展示完整执行过程（意图识别 → 字段提取 → 执行入库 → 最终回复）
3. **分层架构** — UI 层（~300行）/ Store 层（~200行）/ Agent 层（~150行）/ 工具层（~50行）
4. **开发者调试** — Ctrl+` 打开控制台，查看每轮 LLM 调用的原始请求/响应
5. **对话即学习** — 用户自然对话纠正，LLM 自动检测纠正意图，Agent 自动提取差异存入 learning_data

---

## 2. 架构设计

### 2.1 分层架构

```
┌─────────────────────────────────────────────────┐
│  ChatWidget.vue (UI 层, ~300 行)                 │
│  - 消息列表渲染                                   │
│  - 输入框                                         │
│  - 欢迎页/设置面板                                │
├─────────────────────────────────────────────────┤
│  ChatStore (状态层, ~200 行)                      │
│  - messages[] 管理                                │
│  - conversationHistory[] (标准消息历史)            │
│  - conversationState (waitingForConfirm 等)       │
│  - sendMessage(text, images?)                     │
│  - confirmRecord(fields?)                         │
│  - cancelRecord()                                 │
├─────────────────────────────────────────────────┤
│  AgentEngine (逻辑层, ~150 行)                     │
│  - callLLM(messages, tools) → toolCall            │
│  - executeTool(toolCall) → result                 │
│  - 自动构建 conversationHistory                   │
│  - 自动注入 learning context                      │
│  - 自动提取差异存入 learning_data                 │
├─────────────────────────────────────────────────┤
│  ToolRegistry (工具层, ~50 行)                     │
│  - zod schema 定义 + 类型安全执行器               │
│  - create_record, query_records, render_stats...  │
└─────────────────────────────────────────────────┘
```

### 2.2 数据流

```
用户消息
  ↓
ChatStore.sendMessage(text)
  ↓
AgentEngine.processMessage(text, conversationHistory, tools)
  ├─ 1. OCR 处理（如果有图片）→ 记录 OCR 步骤
  ├─ 2. 构建 conversationHistory（最近 10 轮）
  ├─ 3. 调用 LLM（Function Calling）
  │     └─ LLM 返回 tool_calls 或 text
  ├─ 4. 执行工具 → ToolResult（纯数据）
  │     └─ LLM 拿到结果，生成自然语言回复
  ├─ 5. 组装 StepList（推理链）
  └─ 6. 组装 ActionResult（UI 渲染）
  ↓
ChatStore 更新 messages[] + conversationHistory[]
  ↓
ChatWidget 渲染 UI
```

### 2.3 消息历史

**UI 消息**（`messages[]`）vs **LLM 消息历史**（`conversationHistory[]`）分离：

```typescript
// UI 消息：包含 rich UI 数据
interface ChatMessage {
  id: number;
  role: 'user' | 'ai';
  content: string;
  data?: Record<string, unknown>;
  render?: string;        // text | card | chart | list
  steps?: Step[];         // 推理链步骤
  status?: 'pending' | 'confirmed' | 'cancelled' | 'success';
  skill?: SkillMeta;
  imageSrc?: string;      // base64 图片
}

// LLM 消息历史：标准格式
interface LLMMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;  // tool 返回结果时的标识
}
```

---

## 3. 决策记录

### 3.1 降级方案

**选择 B：本地 fallback（正则提取）**

LLM 不可用时，使用正则提取字段（金额、类型、时间关键词），UI 标注"⚠️ 使用本地解析（AI 不可用）"。

### 3.2 Tool 返回值拆分

**拆分两层：**

```typescript
// Tool 返回给 LLM 的（纯数据）
interface ToolResult {
  success: boolean;
  result: unknown;
  error?: string;
}

// 前端渲染用的（UI 层决定）
interface ActionResult {
  success: boolean;
  message: string;
  data?: unknown;
  render: string;
}
```

### 3.3 OCR 失败处理

OCR 失败一律中止流程（即使用户有手动输入文字），识别到的文本在步骤详情里显示。

### 3.4 上下文窗口管理

**选择 A：固定 10 轮对话窗口。**

10 轮 = 20 条消息，足够覆盖"追问补充 + 纠正 + 确认"的完整流程。

### 3.5 消息持久化

保持现有 `chat_history` 表结构不变，`steps[]` 存 `data` 字段 JSON 数组，不新增步骤表。

原始 LLM 响应只在开发者控制台内存中保留，不写入数据库。

### 3.6 Prompt 管理

保留编辑入口在 Settings 页面，Dispatch Prompt 和 Preferences 分 Tab 独立编辑，各 Tab 有 `[保存]` 和 `[恢复默认]` 按钮。

### 3.7 类型安全

选择 **zod 方案**：一个定义同时生成 JSON Schema + TypeScript 类型 + 运行时校验。

### 3.8 流式输出

**先不加**，后续再加。

### 3.9 学习引擎

**对话即学习**：LLM 检测纠正意图（`correct_record`），Agent 执行纠正时自动对比原始字段和修正字段，存入 `learning_data`。

---

## 4. 组件详细设计

### 4.1 ToolRegistry（工具注册表）

```typescript
import { z } from 'zod';

// 工具 schema（一个定义，三种用途：JSON Schema for LLM / TypeScript types / runtime validation）
const CreateRecordSchema = z.object({
  amount: z.number().positive(),
  type: z.enum(['收入', '支出']),
  category: z.string().optional(),
  datetime: z.string().optional(),
  account: z.string().optional(),
  note: z.string().optional(),
  payment_method: z.string().optional(),
});

type CreateRecordArgs = z.infer<typeof CreateRecordSchema>;

// 工具注册
interface Tool<Args, Result> {
  name: string;
  description: string;
  schema: z.ZodType<Args>;
  execute: (args: Args) => Promise<Result>;
}

class ToolRegistry {
  private tools = new Map<string, Tool<any, any>>();

  register<Args, Result>(tool: Tool<Args, Result>) {
    this.tools.set(tool.name, tool);
  }

  // 获取 LLM 所需的 tools 数组
  getTools() {
    return [...this.tools.values()].map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: zodToJsonSchema(t.schema),
      },
    }));
  }

  // 执行工具（带运行时校验）
  async execute(name: string, args: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { success: false, error: `未知工具: ${name}` };

    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) return { success: false, error: `参数校验失败: ${parsed.error}` };

    try {
      const result = await tool.execute(parsed.data);
      return { success: true, result };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
```

### 4.2 AgentEngine（逻辑层）

```typescript
interface Step {
  id: string;
  title: string;          // '意图识别', '字段提取', '执行入库', '最终回复'
  status: 'running' | 'success' | 'error';
  detail?: StepDetail;
  collapsed: boolean;
}

interface StepDetail {
  action?: string;
  confidence?: number;
  fields?: Array<{ label: string; value: string; source: 'extracted' | 'inferred' | 'default' }>;
  result?: { message?: string; id?: number };
  ocr?: {
    status: 'success' | 'error';
    latency: number;
    recognizedText: string;
    imageWidth?: number;
    imageHeight?: number;
    error?: string;
  };
}

class AgentEngine {
  private toolRegistry: ToolRegistry;
  private conversationHistory: LLMMessage[] = [];
  private maxRounds = 10;

  async processMessage(text: string, imageBase64?: string): Promise<{
    steps: Step[];
    toolResult: ToolResult;
    finalReply: string;
  }> {
    const steps: Step[] = [];

    // Step 1: OCR
    if (imageBase64) {
      const ocrStep = this.addOCRStep(steps);
      try {
        const startTime = Date.now();
        const ocrText = await this.recognizeOCR(imageBase64);
        ocrStep.status = 'success';
        ocrStep.detail.ocr = { status: 'success', latency: Date.now() - startTime, recognizedText: ocrText };
        text = text ? `${text} ${ocrText}` : ocrText;
      } catch (e) {
        ocrStep.status = 'error';
        ocrStep.detail.ocr = { status: 'error', latency: 0, recognizedText: '', error: e.message };
        throw new Error('OCR 识别失败：' + e.message);
      }
    }

    // Step 2: Build conversation history (最近 10 轮)
    this.conversationHistory.push({ role: 'user', content: text });
    const recentMessages = this.conversationHistory.slice(-this.maxRounds * 2);

    // Step 3: Call LLM
    const tools = this.toolRegistry.getTools();
    const response = await this.callLLM(recentMessages, tools);

    // Step 4: Execute tool
    if (response.finish_reason === 'tool_calls') {
      const toolCall = response.tool_calls[0];
      const result = await this.toolRegistry.execute(toolCall.function.name, JSON.parse(toolCall.function.arguments));

      steps.push({ id: 'execute', title: '执行入库', status: result.success ? 'success' : 'error', detail: result.result, collapsed: false });

      // Feed result back to LLM
      this.conversationHistory.push(
        { role: 'assistant', content: null, tool_calls: [toolCall] },
        { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) }
      );

      const finalResponse = await this.callLLM(this.conversationHistory.slice(-this.maxRounds * 2), []);
      const finalReply = finalResponse.content || '';

      steps.push({ id: 'reply', title: '最终回复', status: 'success', detail: { message: finalReply }, collapsed: false });

      return { steps, toolResult: result, finalReply };
    } else {
      // Normal text response
      return { steps: [], toolResult: { success: false, error: 'LLM 未返回工具调用' }, finalReply: response.content || '' };
    }
  }
}
```

### 4.3 StepList 组件

```vue
<template>
  <div class="step-list">
    <div
      v-for="step in steps"
      :key="step.id"
      class="step-item"
      :class="{
        'step-running': step.status === 'running',
        'step-success': step.status === 'success',
        'step-error': step.status === 'error',
      }"
    >
      <!-- 步骤标题行 -->
      <div class="step-header" @click="step.collapsed = !step.collapsed">
        <Icon :name="statusIcon(step.status)" :class="step.status" />
        <span class="step-title">{{ step.title }}</span>
        <span v-if="step.detail?.confidence" class="confidence">
          {{ Math.round(step.detail.confidence * 100) }}%
        </span>
        <Icon name="chevron" :class="{ rotated: !step.collapsed }" />
      </div>

      <!-- 步骤详情 -->
      <div v-show="!step.collapsed" class="step-detail">
        <!-- OCR 识别 -->
        <dl v-if="step.detail?.ocr">
          <div class="field-row">
            <dt>识别文本</dt>
            <dd>{{ step.detail.ocr.recognizedText || '识别失败' }}</dd>
          </div>
          <div class="field-row">
            <dt>耗时</dt>
            <dd>{{ step.detail.ocr.latency }}ms</dd>
          </div>
        </dl>

        <!-- 意图识别 -->
        <div v-if="step.detail?.action">
          <span class="action-label">动作: {{ step.detail.action }}</span>
        </div>

        <!-- 字段列表 -->
        <dl v-if="step.detail?.fields">
          <div v-for="field in step.detail.fields" class="field-row">
            <dt>{{ field.label }}</dt>
            <dd>
              {{ field.value }}
              <Badge :type="field.source" />
            </dd>
          </div>
        </dl>

        <!-- 执行结果 -->
        <div v-if="step.detail?.result">
          <span>{{ step.detail.result.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
```

### 4.4 开发者控制台

快捷键 `Ctrl+`` 打开/关闭，显示最近 N 次 LLM 调用的完整请求/响应。

```typescript
interface RequestEntry {
  id: number;
  timestamp: string;
  model: string;
  systemPrompt: string;
  messages: LLMMessage[];
  tools: Tool[];
  finishReason: string;
  toolCalls?: ToolCall[];
  content?: string;
  usage: { promptTokens: number; completionTokens: number };
  latency: number;
  error?: string;
}
```

功能：
- 列表：最近 N 次 API 调用（时间/模型/耗时/状态）
- 详情：完整请求/响应 JSON
- 过滤：按状态/耗时范围筛选
- 导出：导出为 JSON
- 双击消息：快速定位到对应的请求

### 4.5 系统诊断（Settings 页面）

```
┌─────────────────────────────────────────┐
│  AI 服务                                │
│  状态:  🟢 已连接                        │
│  服务:  LM Studio (qwen3.6-35b)          │
│  URL:  http://121.17.49.99:1234         │
│  延迟:  230ms (最近 5 次平均)             │
│  [测试连接]                               │
│                                         │
│  最近请求日志                            │
│  14:32:15  create_record  ✅ 230ms      │
│  14:31:42  query_records   ✅ 180ms      │
│  14:30:08  create_record  ✅ 450ms      │
│  14:28:55  render_stats    ❌ 超时       │
│                                         │
│  [导出 JSON] [清空日志]                   │
└─────────────────────────────────────────┘
```

### 4.6 对话即学习

用户纠正场景：
```
用户：今天吃饭花了35元 → LLM 识别为餐饮 → 用户确认
用户：不对，是交通 → LLM 识别为 correct_record → Agent 自动执行纠正 + 提取差异
```

Agent 执行 `correct_record` 时自动对比：
```typescript
const original = await getRecord(recordId);
await updateRecord(recordId, args.fields);

for (const [key, newValue] of Object.entries(args.fields)) {
  if (original[key] && original[key] !== newValue) {
    await saveCorrection(key, String(original[key]), String(newValue));
  }
}
```

---

## 5. 文件变更清单

### 新增文件

| 文件 | 说明 |
|---|---|
| `src/ai/tool-registry.ts` | ToolRegistry 类，zod schema + 执行器 |
| `src/ai/agent-engine.ts` | AgentEngine 类，LLM 调用 + 工具执行 + 推理链构建 |
| `src/components/chat/StepList.vue` | 推理链可视化组件 |
| `src/components/chat/DevConsole.vue` | 开发者控制台 |
| `src/stores/chat.ts` | 重构后的 ChatStore（承载所有状态管理） |

### 修改文件

| 文件 | 变更 |
|---|---|
| `src/components/chat/ChatWidget.vue` | 瘦身为纯 UI 层，~300 行 |
| `src/components/chat/ChatMessage.vue` | 渲染 StepList + 最终结果 |
| `src/components/chat/ConfirmCard.vue` | 保留（确认卡片 UI） |
| `src/views/Settings.vue` | 新增 Prompt/偏好/学习数据 tab + 系统诊断 |
| `src-tauri/src/commands/config.rs` | 支持 Function Calling 格式（tools 参数 + tool_calls 返回） |
| `src-tauri/src/db/prompts.rs` | 精简 dispatch prompt |
| `package.json` | 新增 zod 依赖 |

### 删除文件

| 文件 | 理由 |
|---|---|
| `src/ai/dispatch.ts` | 被 agent-engine.ts 替代 |
| `src/ai/actions.ts` | 被 tool-registry.ts 替代 |
| `src/components/chat/DebugPanel.vue` | 被 DevConsole.vue 替代 |
| `src/components/chat/ChatThinking.vue` | 被 StepList.vue 替代 |
| `src/components/chat/RulesPanel.vue` | 功能移到 Settings 页面 |

---

## 6. 实施顺序

1. **添加 zod 依赖 + 实现 ToolRegistry**
2. **创建 AgentEngine 层**（LLM 调用 + 工具执行 + 推理链构建）
3. **重构 ChatStore**（状态管理 + 对话流程）
4. **创建 StepList 组件**（推理链可视化）
5. **重构 ChatWidget**（瘦身为纯 UI）
6. **实现开发者控制台**
7. **更新 Settings 页面**（Prompt/偏好/学习数据 tab + 系统诊断）
8. **更新 Rust 后端**（Function Calling 支持）
9. **清理旧代码**

---

## 7. 测试计划

| 场景 | 预期 |
|---|---|
| 正常记账 | 推理链完整显示（意图识别 → 字段提取 → 执行入库 → 回复） |
| 图片 OCR | OCR 步骤显示在推理链中，识别文本可见 |
| OCR 失败 | 中止流程，显示错误步骤 |
| LLM 不可用 | 降级到本地正则解析，标注"使用本地解析" |
| 纠正记录 | LLM 自动识别纠正意图，自动更新记录 + 存入学习数据 |
| 追问补充 | 追问步骤显示在推理链中，用户回复后重新 dispatch |
| 多工具调用 | 每个工具独立步骤展示 |
| 开发者控制台 | Ctrl+` 打开，显示完整请求/响应 |
| 多轮对话 | 保持最近 10 轮，旧对话自动截断 |
| 持久化 | steps[] 存 data 字段 JSON，加载历史消息正常渲染 |
