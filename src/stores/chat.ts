import { defineStore } from 'pinia';
import { ref, nextTick } from 'vue';
import { agentEngine } from '@/ai/agent-engine';
import { toolRegistry } from '@/ai/tool-registry';
import { getChatHistory, saveChatMessage, clearChatHistory } from '@/api/tauri';
import type { ChatMessage, Step } from '@/types/chat';

export const useChatStore = defineStore('chat', () => {
  const messages = ref<ChatMessage[]>([]);
  const isOpen = ref(false);
  const sending = ref(false);
  const ocrLoading = ref(false);
  let nextId = 1;

  // 对话状态
  const pendingRecord = ref<Record<string, unknown> | null>(null);
  const pendingAction = ref<string | null>(null);
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

  async function loadHistory(limit = 50) {
    try {
      const res = await getChatHistory(limit);
      const loaded: ChatMessage[] = [];
      for (const m of res.data.reverse()) {
        const parsedData = m.data ? JSON.parse(m.data) : {};
        const steps: Step[] = parsedData._steps || [];
        loaded.push({
          id: genId(),
          role: m.role as 'user' | 'ai',
          content: m.content || '',
          data: parsedData,
          render: parsedData._render || 'text',
          title: parsedData._title,
          status: parsedData._status || (m.role === 'ai' ? 'success' : undefined),
          steps,
        });
      }
      messages.value = loaded;

      // 恢复 pending 状态
      const lastPending = [...loaded].reverse().find(m => m.status === 'pending' && m.render === 'card');
      if (lastPending) {
        pendingRecord.value = lastPending.data || null;
      }
    } catch {
      // No history
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
    await persistMessage(userMsg);

    // 添加 AI loading 消息
    const aiMsg: ChatMessage = {
      id: genId(),
      role: 'ai',
      content: '',
      loading: true,
      steps: [],
    };
    messages.value.push(aiMsg);
    await scrollToBottom(messagesRef);

    try {
      // 初始化 AgentEngine
      await agentEngine.loadContext();

      // 处理消息
      const result = await agentEngine.processMessage(text, imageBase64);

      // 更新 AI 消息
      aiMsg.loading = false;
      aiMsg.steps = result.steps;
      aiMsg.content = result.finalReply;
      aiMsg.render = result.toolResult?.render || 'text';
      aiMsg.data = result.toolResult?.data as Record<string, unknown>;
      aiMsg.status = 'success';

      // 处理确认卡片（create_record 等）
      if (result.action && ['create_record', 'create_trip_record', 'record_trip_payment'].includes(result.action) && result.toolResult?.render === 'card') {
        aiMsg.status = 'pending';
        pendingRecord.value = result.toolResult?.data as Record<string, unknown> | null;
        pendingAction.value = result.action;
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

      await persistMessage(aiMsg);
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : (typeof e === 'string' ? e : '未知错误');
      console.error('[ChatStore] Error processing message:', errorMsg, e);
      aiMsg.loading = false;
      aiMsg.content = errorMsg;
      aiMsg.render = 'text';
      aiMsg.status = 'success';
      await persistMessage(aiMsg);
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

    // 重复检测
    if (action === 'create_record') {
      const isDuplicate = await checkDuplicate(record);
      if (isDuplicate) return;
    }

    // 保存原始解析用于学习
    originalParse.value = { ...record };

    try {
      await agentEngine.loadContext();

      const toolResult = await toolRegistry.execute(action.replace('create_', 'confirm_'), record);

      msg.content = toolResult.success
        ? (toolResult.message || '已确认')
        : (toolResult.error || '确认失败');
      msg.render = toolResult.render || 'text';
      msg.data = toolResult.data as Record<string, unknown>;
      msg.status = 'confirmed';

      // 学习
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

    // 合并字段
    const mergedFields = { ...followUp.originalFields };
    if (missingField === 'amount') {
      const amountMatch = answer.match(/(\d+\.?\d*)/);
      if (amountMatch) mergedFields.amount = parseFloat(amountMatch[1]);
    } else {
      mergedFields[missingField] = answer;
    }

    awaitingFollowUp.value = false;
    pendingFollowUp.value = null;

    // 重新发送消息（带合并字段）
    const synthesized = buildSynthesizedInput(mergedFields);
    await sendMessage(synthesized, messagesRef);
  }

  async function persistMessage(msg: ChatMessage) {
    try {
      const dataObj: Record<string, unknown> = { ...msg.data };
      if (msg.render) dataObj._render = msg.render;
      if (msg.title) dataObj._title = msg.title;
      if (msg.status) dataObj._status = msg.status;
      if (msg.steps?.length) dataObj._steps = msg.steps;
      await saveChatMessage(
        msg.role,
        msg.content,
        Object.keys(dataObj).length > 0 ? JSON.stringify(dataObj) : null,
        null,
        null,
      );
    } catch {
      // Ignore
    }
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
    pendingRecord, pendingAction, awaitingFollowUp, pendingFollowUp, editingField,
    genId, loadHistory, sendMessage, confirmRecord, cancelRecord,
    startEditField, applyFieldEdit, answerFollowUp, clearMessages, clearHistory,
  };
});
