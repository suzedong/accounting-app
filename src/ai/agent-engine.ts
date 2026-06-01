import { callLLMWithTools, getSystemPrompt, getLearningCorrections } from '@/api/tauri';
import { toolRegistry, type ToolResult } from './tool-registry';
import type { LLMMessage, Step } from '@/types/chat';

// ============================================================
// AgentEngine — 逻辑层：LLM 调用 + 工具执行 + 推理链构建
// ============================================================

export interface LLMLogEntry {
  id: number;
  timestamp: string;
  systemMessage: string;
  userMessage: string;
  response: string;
  latency: number;
  steps: string[];
}

export interface ProcessResult {
  steps: Step[];
  toolResult: ToolResult | null;
  finalReply: string;
  action?: string;
}

export class AgentEngine {
  private conversationHistory: LLMMessage[] = [];
  private maxRounds = 10;
  private systemPrompt = '';
  private preferenceText = '';
  private learningText = '';
  private contextLoaded = false;
  private llmLogs: LLMLogEntry[] = [];
  private nextLogId = 1;

  /** 加载 system prompt + preferences + learning data */
  async loadContext() {
    if (this.contextLoaded) return;

    try {
      const [promptRes, prefRes, learningRes] = await Promise.allSettled([
        getSystemPrompt('dispatch'),
        getSystemPrompt('preferences'),
        getLearningCorrections(),
      ]);

      this.systemPrompt = promptRes.status === 'fulfilled' ? promptRes.value.data.content : '你是一个记账助手。';
      this.preferenceText = prefRes.status === 'fulfilled' ? prefRes.value.data.content : '';
      this.learningText = learningRes.status === 'fulfilled'
        ? this.buildLearningContext(learningRes.value.data)
        : '';

      this.contextLoaded = true;
    } catch {
      this.systemPrompt = '你是一个记账助手。';
      this.contextLoaded = true;
    }
  }

  /**
   * 处理用户消息，逐步返回推理链 + 工具结果 + 最终回复
   * onStep 回调在每步完成时立即触发，用于 UI 逐步渲染
   */
  async processMessage(
    text: string,
    _imageBase64?: string,
    onStep?: (step: Step) => void | Promise<void>,
  ): Promise<ProcessResult> {
    const steps: Step[] = [];

    // 构建完整 system message
    const systemMessage = this.buildSystemMessage();

    // 构建消息历史（最近 10 轮）
    this.conversationHistory.push({ role: 'user', content: text });
    const recentMessages = this.conversationHistory.slice(-this.maxRounds * 2);

    // Step 1: 意图识别 + 字段提取（Function Calling）
    const intentStep: Step = {
      id: 'intent',
      title: '意图识别',
      status: 'running',
      detail: {},
      collapsed: false,
    };
    steps.push(intentStep);
    await onStep?.({ ...intentStep });

    const llmResponse = await this._callLLMWithTools(systemMessage, text, recentMessages);

    const parsed = this.parseFunctionCallResponse(llmResponse.content, llmResponse.toolCalls);
    if (!parsed) {
      intentStep.status = 'error';
      intentStep.detail!.error = 'LLM 返回格式不正确';
      return {
        steps,
        toolResult: null,
        finalReply: '抱歉，我没有理解你的意思。请换个说法。',
      };
    }

    intentStep.status = 'success';
    intentStep.detail!.action = parsed.action;
    intentStep.detail!.confidence = parsed.confidence;

    // 提取字段用于展示（LLM 参数本身就是字段集合，不是嵌套在 params.fields 下）
    const fields: Record<string, unknown> = parsed.params || {};
    console.log('[AgentEngine] 字段来源调试, params keys:', Object.keys(fields));
    console.log('[AgentEngine] payment 值:', fields.payment, 'payment_source:', fields.payment_source);
    if (Object.keys(fields).length > 0) {
      const fieldLabels: Record<string, string> = {
        amount: '金额', type: '类型', category: '分类',
        account: '账户', payment: '支付', payment_method: '支付',
        datetime: '时间', note: '备注',
        trip_id: '申请单号', start_date: '出发日期', end_date: '返程日期',
        days: '出差天数', notes: '备注',
      };
      intentStep.detail!.fields = Object.entries(fields)
        .filter(([k]) => !k.endsWith('_source')) // 跳过 source 元数据键
        .map(([k, v]) => {
          const filtered = v !== undefined && v !== null && v !== '' && v !== 'null' && v !== 'undefined';
          console.log(`[AgentEngine] 字段 ${k}=${JSON.stringify(v)} -> filtered=${filtered}`);
          if (!filtered) return null;
          const source = this.getFieldSource(k, v, fields);
          console.log(`[AgentEngine] 字段 ${k}=${v} -> source=${source}`);
          return {
            label: fieldLabels[k] || k,
            value: typeof v === 'object' ? JSON.stringify(v) : String(v),
            source,
          };
        })
        .filter(Boolean) as Array<{ label: string; value: string; source: 'extracted' | 'inferred' | 'default' }>;
    }
    await onStep?.({ ...intentStep });

    // 如果是 ask_follow_up，直接返回
    if (parsed.action === 'ask_follow_up') {
      return {
        steps,
        toolResult: { success: true, data: parsed.params || {}, render: 'text' } as ToolResult,
        finalReply: parsed.params?.question as string || '请补充更多信息',
        action: parsed.action,
      };
    }

    // 如果是 reply_text，直接返回
    if (parsed.action === 'reply_text') {
      return {
        steps,
        toolResult: null,
        finalReply: parsed.params?.text as string || '',
        action: parsed.action,
      };
    }

    // Step 2: 执行工具
    const executeStep: Step = {
      id: 'execute',
      title: '执行操作',
      status: 'running',
      detail: {},
      collapsed: false,
    };
    steps.push(executeStep);
    await onStep?.({ ...executeStep });

    // 预处理参数：LLM 可能返回 amount 为字符串，或 type 带空格
    if (parsed.params) {
      if (typeof parsed.params.amount === 'string') {
        const num = parseFloat(parsed.params.amount);
        if (!isNaN(num)) parsed.params.amount = num;
        else delete parsed.params.amount;
      } else if (typeof parsed.params.amount !== 'number' || isNaN(parsed.params.amount as number)) {
        delete parsed.params.amount;
      }
      if (typeof parsed.params.type === 'string') {
        const trimmed = parsed.params.type.trim();
        if (trimmed === '收入' || trimmed === '支出') {
          parsed.params.type = trimmed;
        } else {
          delete parsed.params.type;
        }
      }
    }

    const toolResult = await toolRegistry.execute(parsed.action, parsed.params);

    if (toolResult.success) {
      executeStep.status = 'success';
      executeStep.detail!.result = {
        message: toolResult.message || '操作成功',
      };
      if (toolResult.data && typeof toolResult.data === 'object' && 'id' in toolResult.data) {
        (executeStep.detail!.result as Record<string, unknown>).id = (toolResult.data as { id?: number }).id;
      }
    } else {
      executeStep.status = 'error';
      executeStep.title = '执行操作 (失败)';
      executeStep.detail!.error = toolResult.error || '操作失败';
    }
    await onStep?.({ ...executeStep });

    // 更新 conversation history
    this.conversationHistory.push({
      role: 'assistant',
      content: toolResult.success
        ? (toolResult.message || '操作完成')
        : (toolResult.error || '操作失败'),
    });

    let finalReply = toolResult.success
      ? (toolResult.message || '操作完成')
      : (toolResult.error || '操作失败');

    return {
      steps,
      toolResult,
      finalReply,
      action: parsed.action,
    };
  }

  /**
   * 使用 Function Calling 调用 LLM（内部实现）
   * 将 toolRegistry 中的工具定义传给 LLM，LLM 直接返回 tool_calls
   */
  private async _callLLMWithTools(
    systemMessage: string,
    userMessage: string,
    _recentMessages: LLMMessage[],
  ): Promise<{ content: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null }> {
    // 注入对话上下文
    let systemWithHistory = systemMessage;
    if (_recentMessages.length > 1) {
      const contextLines: string[] = [];
      for (let i = Math.max(0, _recentMessages.length - 6); i < _recentMessages.length; i++) {
        const m = _recentMessages[i];
        const prefix = m.role === 'user' ? '用户' : 'AI';
        const content = (m.content || '').substring(0, 80);
        contextLines.push(`${prefix}: ${content}`);
      }
      systemWithHistory += `\n\n## 最近对话上下文\n${contextLines.join('\n')}\n\n**重要**：以上是对话历史，用户可能在纠正上一条记录。请根据上下文理解用户意图。`;
    }

    // 获取工具定义（JSON Schema 格式）
    const tools = toolRegistry.getTools();
    const toolsJson = JSON.stringify(tools);

    const startTime = Date.now();
    try {
      const apiResult = await callLLMWithTools(systemWithHistory, userMessage, toolsJson);
      const latency = Date.now() - startTime;

      // 解析 tool_calls
      let parsedToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null = null;
      if (apiResult.toolCalls) {
        parsedToolCalls = apiResult.toolCalls.map(tc => {
          const raw = tc as Record<string, unknown>;
          const fn = raw.function as Record<string, unknown> | undefined;
          const name = (fn?.name as string) || (raw.name as string) || '';
          let args: Record<string, unknown> = {};
          const argsRaw = fn?.arguments ?? raw.arguments;
          if (typeof argsRaw === 'string') {
            try { args = JSON.parse(argsRaw); } catch { args = {}; }
          } else if (argsRaw && typeof argsRaw === 'object') {
            args = argsRaw as Record<string, unknown>;
          }
          return { id: tc.id, name, arguments: args };
        });
      }

      const responseText = parsedToolCalls
        ? `[tool_calls: ${parsedToolCalls.map(tc => tc.name).join(', ')}]\n${JSON.stringify(parsedToolCalls.map(tc => tc.arguments), null, 2)}`
        : apiResult.content;

      // 记录 LLM 日志
      console.log('[AgentEngine] 记录 LLM 日志, 当前条数:', this.llmLogs.length);
      this.llmLogs.push({
        id: this.nextLogId++,
        timestamp: new Date().toLocaleTimeString(),
        systemMessage: systemWithHistory,
        userMessage,
        response: responseText,
        latency,
        steps: [],
      });

      return {
        content: apiResult.content,
        toolCalls: parsedToolCalls,
      };
    } catch (e) {
      // 即使调用失败也记录日志，方便在开发者控制台看到错误
      const latency = Date.now() - startTime;
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.log('[AgentEngine] LLM 调用失败，记录错误日志:', errorMsg);
      this.llmLogs.push({
        id: this.nextLogId++,
        timestamp: new Date().toLocaleTimeString(),
        systemMessage: systemWithHistory,
        userMessage,
        response: `[错误] ${errorMsg}`,
        latency,
        steps: [],
      });
      throw e;
    }
  }

  /** 解析 Function Calling 响应（tool_calls 或纯文本回复） */
  private parseFunctionCallResponse(
    content: string,
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null,
  ): {
    action: string;
    params: Record<string, unknown>;
    render: string;
    title: string;
    confidence: number;
  } | null {
    // Function Calling：LLM 直接返回 tool_calls
    if (toolCalls && toolCalls.length > 0) {
      const tc = toolCalls[0]; // 当前只处理第一个 tool call
      return {
        action: tc.name,
        params: tc.arguments,
        render: 'card',
        title: '',
        confidence: 1.0, // Function Calling 的 LLM 已经做了选择，置信度固定为 1.0
      };
    }

    // 降级：LLM 返回纯文本（没有 tool_calls），尝试解析为 dispatch JSON
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      const parsed = JSON.parse(jsonStr.trim());

      if (!parsed.action || !parsed.params) return null;

      return {
        action: parsed.action,
        params: parsed.params || {},
        render: parsed.render || 'text',
        title: parsed.title || '',
        confidence: parsed.confidence || 0,
      };
    } catch {
      return null;
    }
  }

  /** 构建完整的 system message */
  private buildSystemMessage(): string {
    let system = this.systemPrompt;
    if (this.preferenceText) {
      system += `\n\n## 用户偏好\n${this.preferenceText}`;
    }
    if (this.learningText) {
      system += `\n\n${this.learningText}`;
    }
    return system;
  }

  /** 构建学习数据上下文 */
  private buildLearningContext(data: Array<{ keyword: string; field: string; value: string }>): string {
    if (data.length === 0) return '';

    const grouped: Record<string, Array<{ keyword: string; value: string }>> = {};
    for (const d of data) {
      if (!grouped[d.field]) grouped[d.field] = [];
      grouped[d.field].push({ keyword: d.keyword, value: d.value });
    }

    let text = '\n## 学习数据（用户修正历史）\n';
    for (const [field, entries] of Object.entries(grouped)) {
      text += `\n### ${field}\n`;
      const freq: Record<string, number> = {};
      for (const e of entries) {
        const key = `${e.keyword}→${e.value}`;
        freq[key] = (freq[key] || 0) + 1;
      }
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
      for (const [k, count] of sorted) {
        text += `- ${k} (使用 ${count} 次)\n`;
      }
    }
    return text;
  }

  /** 获取 LLM 日志（开发者调试用） */
  getLLMLogs(): LLMLogEntry[] {
    return [...this.llmLogs];
  }

  /** 判断字段来源：extracted=从文本提取，inferred=系统推断，default=系统默认值 */
  private getFieldSource(key: string, _value: unknown, allFields: Record<string, unknown>): 'extracted' | 'inferred' | 'default' {
    // 优先使用 LLM 返回的 _source 标注
    const llmSource = allFields[`${key}_source`] as string | undefined;
    if (llmSource === 'extracted' || llmSource === 'inferred' || llmSource === 'default') {
      return llmSource;
    }
    // 兜底判断
    // 账户：系统默认值
    if (key === 'account') return 'default';
    // 类型/分类/时间：系统推断
    if (key === 'type' || key === 'category' || key === 'datetime') return 'inferred';
    // 支付方式：如果 LLM 返回了，通常是推断的
    if (key === 'payment' || key === 'payment_method') return 'inferred';
    // 其余：从文本/OCR 中提取
    return 'extracted';
  }

  /** 清空 LLM 日志 */
  clearLLMLogs() {
    this.llmLogs = [];
    this.nextLogId = 1;
  }

  /** 获取对话历史 */
  getHistory(): LLMMessage[] {
    return [...this.conversationHistory];
  }

  /** 清空对话历史 */
  clearHistory() {
    this.conversationHistory = [];
  }

  /** 重置上下文（重新加载 prompt） */
  resetContext() {
    this.contextLoaded = false;
    this.systemPrompt = '';
    this.preferenceText = '';
    this.learningText = '';
  }
}

// 全局单例
export const agentEngine = new AgentEngine();
