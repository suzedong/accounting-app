import { defineStore } from 'pinia';
import { ref, nextTick } from 'vue';
import { agentEngine } from '@/ai/agent-engine';
import { toolRegistry } from '@/ai/tool-registry';
import { getChatHistory, saveChatMessage, clearChatHistory } from '@/api/tauri';
import type { ChatMessage, Step, PersistedChatData, LLMMessage } from '@/types/chat';
import type { AccountRecord } from '@/types';

/** 生成 session ID（应用启动时一次） */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/** 从持久化数据推导 UI 渲染类型 */
function deriveRenderType(data: PersistedChatData): string {
  if (data.correction) return 'correctionCard';
  if (data.followUp) return 'followUp';
  if (data.record) return 'card';
  if (data.result?.action === 'render_stats') return 'chart';
  if (data.result?.action === 'render_budget') return 'budget';
  return 'text';
}

/** 从持久化数据推导 UI 状态 */
function deriveUIStatus(data: PersistedChatData, isLastMessage: boolean): 'pending' | 'confirmed' | 'cancelled' | 'success' | undefined {
  // 最后一条消息且有待确认记录 → pending
  if (isLastMessage && data.record && !data.result) return 'pending';
  // 有结果 → 已完成
  if (data.result) return data.result.success ? 'success' : 'cancelled';
  return 'success';
}

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([]);
  const isOpen = ref(false);
  const sending = ref(false);
  const ocrLoading = ref(false);
  let nextId = 1;

  /** 当前会话 ID */
  let sessionId = generateSessionId();

  // 对话状态
  const pendingRecord = ref<Record<string, unknown> | null>(null);
  const pendingAction = ref<string | null>(null);
  const lastConfirmedRecord = ref<AccountRecord | null>(null);
  const awaitingFollowUp = ref(false);
  const pendingFollowUp = ref<{
    question: string;
    missingFields: string[];
    originalFields: Record<string, unknown>;
  } | null>(null);
  const editingField = ref<string | null>(null);
  const originalParse = ref<Record<string, unknown> | null>(null);

  function genId() {
    return nextId++;
  }

  async function scrollToBottom(messagesRef: HTMLElement | null) {
    await nextTick();
    if (messagesRef) {
      messagesRef.scrollTop = messagesRef.scrollHeight;
    }
  }

  /**
   * 加载历史消息并恢复 Agent 上下文
   */
  async function loadHistory(limit = 50) {
    try {
      const res = await getChatHistory(limit);
      const loaded: ChatMessage[] = [];
      const llmMessages: LLMMessage[] = [];

      // 从后往前遍历（数据库返回是 DESC 排序）
      for (const m of res.data.reverse()) {
        const persistedData: PersistedChatData = m.data ? JSON.parse(m.data) : {};

        // 收集 LLM 消息用于恢复上下文
        if (persistedData.llmMessages) {
          llmMessages.push(...persistedData.llmMessages);
        }

        // 推导 UI 状态
        const isLast = m.id === res.data[res.data.length - 1].id;
        const render = deriveRenderType(persistedData);
        const status = deriveUIStatus(persistedData, isLast);

        // 恢复推理步骤（历史消息展示思考过程）
        const _steps = (persistedData as unknown as { _steps?: Step[] })._steps;

        loaded.push({
          id: genId(),
          role: m.role as 'user' | 'ai',
          content: m.content || '',
          data: persistedData.record || persistedData.result || persistedData.correction || persistedData.followUp,
          render,
          status,
          steps: _steps, // 恢复历史思考过程
        });

        // 恢复最后确认的记录
        if (persistedData.result?.success && persistedData.result.action === 'confirm_record') {
          const recordData = persistedData.record;
          if (recordData && 'id' in recordData) {
            lastConfirmedRecord.value = recordData as AccountRecord;
          }
        }
      }

      messages.value = loaded;

      // 恢复 Agent 对话上下文（最近 10 轮）
      if (llmMessages.length > 0) {
        agentEngine.restoreContext(llmMessages, 10);
      }

      // 恢复当前 pending 状态（如果最后一条是 pending）
      const lastMsg = loaded[loaded.length - 1];
      if (lastMsg?.status === 'pending' && lastMsg.data) {
        pendingRecord.value = lastMsg.data as Record<string, unknown>;
        pendingAction.value = 'create_record';
      }
    } catch {
      // No history
    }
  }

  /**
   * 持久化消息到数据库
   */
  async function persistMessage(msg: ChatMessage, llmMessages?: LLMMessage[]) {
    try {
      const persistedData: PersistedChatData = {};

      // 存储 LLM 对话消息（用于上下文恢复）
      if (llmMessages?.length) {
        persistedData.llmMessages = llmMessages;
      }

      // 存储推理步骤（用于历史消息展示思考过程）
      if (msg.steps?.length) {
        persistedData._steps = msg.steps;
      }

      // 存储记录数据（用于卡片展示）
      if (msg.data) {
        persistedData.record = msg.data as Record<string, unknown>;
      }

      // 存储操作结果
      if (msg.status === 'confirmed' || msg.status === 'success') {
        persistedData.result = {
          success: true,
          action: pendingAction.value || undefined,
          message: msg.content,
        };
      } else if (msg.status === 'cancelled') {
        persistedData.result = {
          success: false,
          action: pendingAction.value || undefined,
          message: msg.content,
        };
      }

      const dataStr = Object.keys(persistedData).length > 0 ? JSON.stringify(persistedData) : null;
      await saveChatMessage(sessionId, msg.role, msg.content || null, dataStr);
    } catch {
      // Ignore
    }
  }

  /**
   * 发送消息（主流程）
   */
  async function sendMessage(
    text: string,
    messagesRef: HTMLElement | null,
    imageBase64?: string,
    imageFullSrc?: string,
  ): Promise<void> {
    if ((!text.trim() && !imageBase64) || sending.value) return;
    sending.value = true;

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: text,
      imageSrc: imageFullSrc,
    };
    messages.value.push(userMsg);
    await scrollToBottom(messagesRef);
    await persistMessage(userMsg, [{ role: 'user', content: text }]);

    // 添加 AI 消息（loading 状态）
    const aiMsg: ChatMessage = {
      id: genId(),
      role: 'ai',
      content: '',
      loading: true,
      steps: [],
    };

    // 收集本轮 LLM 消息
    const currentLlmMessages: LLMMessage[] = [];

    try {
      await agentEngine.loadContext();
      messages.value.push(aiMsg);
      await scrollToBottom(messagesRef);

      const result = await agentEngine.processMessage(text, imageBase64, (step) => {
        const existingStep = aiMsg.steps!.find(s => s.id === step.id);
        if (existingStep) {
          Object.assign(existingStep, step);
        } else {
          aiMsg.steps!.push(step);
        }
      }, {
        lastConfirmedRecord: lastConfirmedRecord.value,
      });

      // 收集 LLM 消息
      const history = agentEngine.getHistory();
      currentLlmMessages.push(...history.slice(-2)); // 只存本轮的 user + assistant

      // 处理完成
      aiMsg.loading = false;
      aiMsg.content = result.finalReply;
      aiMsg.render = result.toolResult?.render || 'text';
      aiMsg.data = result.toolResult?.data as Record<string, unknown>;

      // 处理确认卡片
      if (result.action && ['create_record', 'create_trip_record', 'record_trip_payment'].includes(result.action) && result.toolResult?.render === 'card') {
        aiMsg.status = 'pending';
        pendingRecord.value = result.toolResult?.data as Record<string, unknown> | null;
        pendingAction.value = result.action;
      }

      // 处理高风险修正
      if (result.action === 'correct_record' && result.toolResult?.render === 'correctionCard') {
        aiMsg.status = 'pending';
        pendingRecord.value = result.toolResult?.data as Record<string, unknown> | null;
        pendingAction.value = 'confirm_correction';
      }

      // 低风险修正
      if (result.action === 'correct_record' && result.toolResult?.render === 'text') {
        const data = result.toolResult?.data as { updatedRecord?: AccountRecord } | undefined;
        if (data?.updatedRecord) lastConfirmedRecord.value = data.updatedRecord;
      }

      // 处理追问
      if (result.action === 'ask_follow_up') {
        aiMsg.render = 'followUp';
        aiMsg.data = result.toolResult?.data as Record<string, unknown> || {};
        awaitingFollowUp.value = true;
        const data = aiMsg.data as { question?: string; missingFields?: string[]; originalFields?: Record<string, unknown> } | undefined;
        pendingFollowUp.value = data
          ? { question: data.question || '', missingFields: data.missingFields || [], originalFields: data.originalFields || {} }
          : null;
      }

      await persistMessage(aiMsg, currentLlmMessages);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : (typeof e === 'string' ? e : '未知错误');
      console.error('[ChatStore] Error processing message:', errorMsg, e);
      aiMsg.loading = false;
      aiMsg.content = errorMsg;
      aiMsg.render = 'text';
      aiMsg.status = 'success';
      await persistMessage(aiMsg, currentLlmMessages);
    } finally {
      sending.value = false;
      await scrollToBottom(messagesRef);
    }
  }

  /**
   * 确认记录
   */
  async function confirmRecord(msg: ChatMessage): Promise<void> {
    if (!pendingRecord.value) return;

    const record = pendingRecord.value;
    const action = pendingAction.value || 'create_record';

    if (action === 'create_record') {
      const isDuplicate = await checkDuplicate(record);
      if (isDuplicate) return;
    }

    originalParse.value = { ...record };

    try {
      await agentEngine.loadContext();

      const toolName = action === 'confirm_correction' ? 'confirm_correction' : action.replace('create_', 'confirm_');
      const toolArgs = action === 'confirm_correction'
        ? (record.pendingUpdate as Record<string, unknown>)
        : record;
      const toolResult = await toolRegistry.execute(toolName, toolArgs, {
        userMessage: msg.content,
        lastConfirmedRecord: lastConfirmedRecord.value,
      });

      msg.content = toolResult.success
        ? (toolResult.message || '已确认')
        : (toolResult.error || '确认失败');
      msg.render = toolResult.render || 'text';
      msg.data = toolResult.data as Record<string, unknown>;
      msg.status = 'confirmed';
      msg.steps = undefined; // 清除思考过程

      const confirmedData = toolResult.data as AccountRecord | { updatedRecord?: AccountRecord } | undefined;
      if (toolResult.success && confirmedData) {
        if ('updatedRecord' in confirmedData && confirmedData.updatedRecord) {
          lastConfirmedRecord.value = confirmedData.updatedRecord;
        } else if ('id' in confirmedData) {
          lastConfirmedRecord.value = confirmedData as AccountRecord;
        }
      }

      if (originalParse.value) {
        await saveLearningIfNeeded(originalParse.value, record);
      }

      pendingRecord.value = null;
      pendingAction.value = null;
      originalParse.value = null;

      await persistMessage(msg);
    } catch (e: unknown) {
      msg.content = e instanceof Error ? e.message : '确认失败';
      msg.render = 'text';
      await persistMessage(msg);
    }
  }

  /**
   * 取消记录
   */
  function cancelRecord(msg: ChatMessage): void {
    msg.status = 'cancelled';
    msg.render = 'text';
    msg.content = '好的，请重新输入你的记账信息。';
    msg.data = undefined;
    msg.steps = undefined;
    pendingRecord.value = null;
    pendingAction.value = null;
  }

  /**
   * 编辑字段
   */
  function startEditField(field: string): void {
    editingField.value = field;
  }

  function applyFieldEdit(value: string): void {
    if (editingField.value && pendingRecord.value) {
      const field = editingField.value;
      pendingRecord.value[field] = field === 'amount' ? parseFloat(value) : value;
    }
    editingField.value = null;
  }

  /**
   * 回复追问
   */
  async function answerFollowUp(answer: string, messagesRef: HTMLElement | null): Promise<void> {
    if (!awaitingFollowUp.value || !pendingFollowUp.value) return;

    const followUp = pendingFollowUp.value;
    const missingField = followUp.missingFields[0];

    const mergedFields = { ...followUp.originalFields };
    if (missingField === 'amount') {
      const amountMatch = answer.match(/(\d+\.?\d*)/);
      if (amountMatch) mergedFields.amount = parseFloat(amountMatch[1]);
    } else {
      mergedFields[missingField] = answer;
    }

    awaitingFollowUp.value = false;
    pendingFollowUp.value = null;

    const synthesized = buildSynthesizedInput(mergedFields);
    await sendMessage(synthesized, messagesRef);
  }

  async function checkDuplicate(record: Record<string, unknown>): Promise<boolean> {
    try {
      const { getRecords } = await import('@/api/tauri');
      const dateStr = (record.datetime as string || '').substring(0, 10) || new Date().toISOString().substring(0, 10);
      const records = await getRecords({
        page: 1,
        pageSize: 100,
        datetimeGte: `${dateStr} 00:00:00`,
        datetimeLte: `${dateStr} 23:59:59`,
      });

      const amount = typeof record.amount === 'number' ? record.amount : parseFloat(String(record.amount));

      for (const r of records.data) {
        const sameAmount = Math.abs((r.amount || 0) - amount) < 0.01;
        const sameType = r.type === record.type;
        const sameDate = r.datetime && r.datetime.substring(0, 10) === dateStr;

        if (sameAmount && sameType && sameDate) {
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  async function saveLearningIfNeeded(
    original: Record<string, unknown>,
    corrected: Record<string, unknown>,
  ): Promise<void> {
    try {
      const { saveCorrection } = await import('@/api/tauri');
      for (const field of ['category', 'payment_method', 'payment']) {
        const oldVal = original[field];
        const newVal = corrected[field];
        if (oldVal && newVal && String(oldVal) !== String(newVal)) {
          await saveCorrection(String(oldVal), field === 'payment' ? 'payment_method' : field, String(newVal));
        }
      }
    } catch {
      // Ignore
    }
  }

  function buildSynthesizedInput(fields: Record<string, unknown>): string {
    const parts: string[] = [];
    if (fields.datetime) parts.push(fields.datetime as string);
    if (fields.type) parts.push(fields.type === '支出' ? '花费' : '收入');
    if (fields.amount) parts.push(`${fields.amount}元`);
    if (fields.category) parts.push(fields.category as string);
    if (fields.note) parts.push(fields.note as string);
    return parts.join(' ');
  }

  function clearMessages() {
    messages.value = [];
    nextId = 1;
    pendingRecord.value = null;
    pendingAction.value = null;
    awaitingFollowUp.value = false;
    pendingFollowUp.value = null;
    editingField.value = null;
    originalParse.value = null;
    lastConfirmedRecord.value = null;
    sessionId = generateSessionId(); // 清空时生成新 session
  }

  async function clearHistory() {
    try {
      await clearChatHistory();
      clearMessages();
      agentEngine.clearHistory();
      agentEngine.clearLLMLogs();
    } catch {
      // Ignore
    }
  }

  return {
    messages, isOpen, sending, ocrLoading,
    pendingRecord, pendingAction, lastConfirmedRecord, awaitingFollowUp, pendingFollowUp, editingField,
    genId, loadHistory, sendMessage, confirmRecord, cancelRecord,
    startEditField, applyFieldEdit, answerFollowUp, clearMessages, clearHistory,
  };
});
