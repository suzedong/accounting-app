import { callLLMWithTools, getSystemPrompt, getLearningCorrections } from '@/api/tauri';
import { toolRegistry, type ToolResult, type ToolRuntimeContext } from './tool-registry';
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

const MAX_LLM_LOGS = 200;

export class AgentEngine {
  private conversationHistory: LLMMessage[] = [];
  private maxRounds = 10;
  private systemPrompt = '';
  private preferenceText = '';
  private learningText = '';
  private contextLoaded = false;
  private llmLogs: LLMLogEntry[] = [];
  private llmLogListeners = new Set<(entry: LLMLogEntry) => void>();
  private lastConfirmedRecordContext = '';  // 上一条记录的结构化摘要
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
    runtimeContext?: Omit<ToolRuntimeContext, 'userMessage'>,
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
    this.removeOrphanSourceFields(parsed.params);
    this.removeInventedPaymentFields(parsed.params, text);

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

      // 按工具类型限定意图识别面板可显示的字段，避免 LLM 多余字段污染面板
      const TOOL_VISIBLE_FIELDS: Record<string, Set<string>> = {
        record_trip_payment: new Set(['amount', 'datetime']),
        confirm_trip_payment: new Set(['tripId', 'amount', 'datetime', 'matchType']),
        create_trip_record: new Set(['trip_id', 'start_date', 'end_date', 'days', 'notes']),
        confirm_trip_record: new Set(['trip_id', 'start_date', 'end_date', 'days', 'notes']),
      };
      const allowedFields = TOOL_VISIBLE_FIELDS[parsed.action];

      // 仅对普通记账类意图（create_record / update_record 等）注入默认 payment
      const isRecordIntent = !allowedFields && (parsed.action === 'create_record' || parsed.action === 'update_record' || parsed.action === 'correct_record');
      const paymentWasProvided = 'payment' in fields;
      const fieldsForDisplay = isRecordIntent ? { payment: fields.payment || '现金', ...fields } : fields;

      intentStep.detail!.fields = Object.entries(fieldsForDisplay)
        .filter(([k]) => !k.endsWith('_source')) // 跳过 source 元数据键
        .filter(([k]) => !allowedFields || allowedFields.has(k)) // 工具白名单过滤
        .map(([k, v]) => {
          // payment 字段（仅记账意图下）始终显示，其他字段按原逻辑过滤
          const isInjectedPayment = isRecordIntent && k === 'payment';
          const filtered = isInjectedPayment || (v !== undefined && v !== null && v !== '' && v !== 'null' && v !== 'undefined');
          console.log(`[AgentEngine] 字段 ${k}=${JSON.stringify(v)} -> filtered=${filtered}`);
          if (!filtered) return null;
          // payment 字段：用户没提则为 default，否则走正常判断
          const source = isInjectedPayment && !paymentWasProvided ? 'default' : this.getFieldSource(k, v, fields);
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

    const toolResult = await toolRegistry.execute(parsed.action, parsed.params, {
      userMessage: text,
      ...runtimeContext,
    });

    if (toolResult.success) {
      executeStep.status = 'success';
      executeStep.detail!.result = {
        message: toolResult.message || '操作成功',
      };
      if (toolResult.data && typeof toolResult.data === 'object' && 'id' in toolResult.data) {
        (executeStep.detail!.result as Record<string, unknown>).id = (toolResult.data as { id?: number }).id;
      }
      if (toolResult.data && typeof toolResult.data === 'object' && 'changes' in toolResult.data) {
        const correction = toolResult.data as {
          targetRecord?: Record<string, unknown>;
          changes?: Array<{ field: string; label: string; oldValue: unknown; newValue: unknown }>;
          risk?: 'low' | 'high';
          reason?: string;
        };
        executeStep.detail!.correction = {
          targetRecord: correction.targetRecord || {},
          changes: correction.changes || [],
          risk: correction.risk || 'low',
          reason: correction.reason,
        };
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
    // 智能上下文注入：只在检测到修正意图时注入历史
    let systemWithHistory = systemMessage;

    if (this.needsHistoryContext(userMessage)) {
      // 优先使用 lastConfirmedRecord 的摘要（最精确）
      if (this.lastConfirmedRecordContext) {
        systemWithHistory += `\n\n## 上一条记录\n${this.lastConfirmedRecordContext}`;
      } else if (_recentMessages.length > 1) {
        // 降级：从最近对话中提取摘要
        const contextSummary = this.buildContextSummary(_recentMessages);
        if (contextSummary) {
          systemWithHistory += `\n\n## 最近对话上下文\n${contextSummary}\n\n**重要**：以上是对话历史，用户可能在纠正上一条记录。请根据上下文理解用户意图。`;
        }
      }
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
      this.pushLLMLog({
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
      this.pushLLMLog({
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
    system += `\n\n${this.buildCurrentTimeContext()}`;
    if (this.preferenceText) {
      system += `\n\n## 用户偏好\n${this.preferenceText}`;
    }
    if (this.learningText) {
      system += `\n\n${this.learningText}`;
    }
    return system;
  }

  private buildCurrentTimeContext(): string {
    const now = new Date();
    const datetime = this.formatDateTime(now);
    const date = datetime.slice(0, 10);
    return [
      '## 当前时间',
      `当前日期：${date}`,
      `当前时间：${datetime}`,
      '当用户提到“今天、昨天、前天、明天、本周、本月、中午、晚上、早上”等相对时间时，必须以当前时间为基准换算。',
      '时间字段统一输出为 YYYY-MM-DD HH:mm:ss。',
    ].join('\n');
  }

  private formatDateTime(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private removeOrphanSourceFields(params: Record<string, unknown>) {
    for (const key of Object.keys(params)) {
      if (!key.endsWith('_source')) continue;
      const fieldName = key.slice(0, -'_source'.length);
      if (!(fieldName in params)) {
        delete params[key];
      }
    }
  }

  private removeInventedPaymentFields(params: Record<string, unknown>, originalText: string) {
    if (!('payment' in params) && !('payment_method' in params)) return;
    const paymentKeywords = ['微信', '支付宝', '刷卡', '银行卡', '信用卡', '现金', '花呗', '零钱', '储蓄卡', '招商', '浦发', '尾号', '卡号'];
    const hasPaymentKeyword = paymentKeywords.some(keyword => originalText.includes(keyword));
    if (hasPaymentKeyword) return;

    delete params.payment;
    delete params.payment_method;
    delete params.payment_source;
    delete params.payment_method_source;
  }

  /**
   * 检测用户消息是否需要注入历史上下文
   * 触发条件：用户明确引用历史记录或表达修正意图
   */
  private needsHistoryContext(userMessage: string): boolean {
    const msg = userMessage.toLowerCase();
    // 显式引用词
    const referenceWords = ['上面', '前面', '上一条', '刚才', '上条', '之前'];
    // 修正动作词
    const correctionWords = ['改成', '改为', '改一下', '修正', '纠正', '更新', '修改'];
    // 否定判断词
    const negationWords = ['不对', '错了', '不是', '有误', '错误'];
    // 省略主语的修正表达（"应该是"、"应该是家庭"）
    const implicitCorrection = ['应该是', '应为', '应是', '改成', '改为'];

    const allTriggers = [...referenceWords, ...correctionWords, ...negationWords, ...implicitCorrection];
    return allTriggers.some(word => msg.includes(word));
  }

  /**
   * 从最近对话历史中构建上下文摘要
   * 提取关键信息，避免注入完整 OCR 原文
   */
  private buildContextSummary(recentMessages: LLMMessage[]): string | null {
    // 取最近 3 轮（6 条消息），排除当前消息
    const historyForContext = recentMessages.slice(0, -2);
    const displayCount = Math.min(6, historyForContext.length);
    if (displayCount === 0) return null;

    const contextLines: string[] = [];
    for (let i = historyForContext.length - displayCount; i < historyForContext.length; i++) {
      if (i < 0) continue;
      const m = historyForContext[i];
      const prefix = m.role === 'user' ? '用户' : 'AI';
      contextLines.push(`${prefix}: ${m.content || ''}`);
    }
    return contextLines.join('\n');
  }

  /**
   * 设置上一条确认记录的上下文摘要
   * 在确认记录后调用，用于后续修正意图的快速上下文注入
   */
  setLastConfirmedRecordContext(record: unknown) {
    if (!record || typeof record !== 'object') {
      this.lastConfirmedRecordContext = '';
      return;
    }
    const r = record as Record<string, unknown>;
    const lines: string[] = [];
    if (r.amount) lines.push(`金额：${r.amount}元`);
    if (r.type) lines.push(`类型：${r.type}`);
    if (r.category) lines.push(`分类：${r.category}`);
    if (r.account) lines.push(`账户：${r.account}`);
    if (r.payment) lines.push(`支付：${r.payment}`);
    if (r.note) lines.push(`备注：${r.note}`);
    if (r.datetime) lines.push(`时间：${r.datetime}`);
    this.lastConfirmedRecordContext = lines.join('\n');
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

  /** 监听新的 LLM 日志 */
  addLLMListener(fn: (entry: LLMLogEntry) => void) {
    this.llmLogListeners.add(fn);
    return () => this.llmLogListeners.delete(fn);
  }

  private pushLLMLog(entry: LLMLogEntry) {
    this.llmLogs.push(entry);
    if (this.llmLogs.length > MAX_LLM_LOGS) {
      this.llmLogs.splice(0, this.llmLogs.length - MAX_LLM_LOGS);
    }
    for (const fn of this.llmLogListeners) {
      try { fn(entry); } catch { /* ignore */ }
    }
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

  /**
   * 从持久化历史恢复对话上下文
   * @param messages - 从数据库加载的 LLM 消息列表
   * @param maxRounds - 恢复的最大对话轮数（默认 10）
   */
  restoreContext(messages: LLMMessage[], maxRounds: number = 10) {
    // 只保留最近 N 轮对话，避免 token 超限
    const recentMessages = messages.slice(-maxRounds * 2);
    this.conversationHistory = recentMessages;
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
