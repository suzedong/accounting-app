import { defineStore } from 'pinia';
import { ref, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { agentEngine } from '@/ai/agent-engine';
import { toolRegistry } from '@/ai/tool-registry';
import { getChatHistory, saveChatMessage, clearChatHistory, getConfig } from '@/api/tauri';
import { clearIpcLogs } from '@/utils/invoke-logger';
import type { ChatMessage, PersistedChatData, LLMMessage } from '@/types/chat';
import type { AccountRecord, TripRecord } from '@/types';

/** 生成 session ID（应用启动时一次） */
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/** 从持久化数据推导 UI 渲染类型 */
function deriveRenderType(data: PersistedChatData): string {
  if (data.correction) return 'correctionCard';
  if (data.deletion) return 'deleteCard';
  if (data.followUp) return 'followUp';
  // 已取消的记录不显示卡片
  if (data.record && !data.result && !data.record?._cancelled) return 'card';
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
  // 非最后一条且无 result → 不显示状态标签
  if (!isLastMessage) return undefined;
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
  const lastConfirmedTrip = ref<TripRecord | null>(null);
  // "上一条"过期保护：记录内部写入时间戳；超过 TTL 后再读时返回 null 并清空
  let lastConfirmedRecordSavedAt = 0;
  let lastConfirmedTripSavedAt = 0;
  // TTL：分钟；默认 30，可通过 app_config.last_confirmed_ttl_minutes 覆盖
  let lastConfirmedTtlMs = 30 * 60 * 1000;
  // 强制确认修正：从 app_config.force_confirm_corrections 读取（"1" 表示开启）
  let forceConfirmCorrections = false;

  /** 记录"上一条"（含时间戳，供跨会话过期判定） */
  function setLastConfirmedRecord(rec: AccountRecord | null, savedAt: number = Date.now()) {
    lastConfirmedRecord.value = rec;
    lastConfirmedRecordSavedAt = rec ? savedAt : 0;
  }
  function setLastConfirmedTrip(trip: TripRecord | null, savedAt: number = Date.now()) {
    lastConfirmedTrip.value = trip;
    lastConfirmedTripSavedAt = trip ? savedAt : 0;
  }
  /** 读取"上一条"记账；若已过期则清空并返回 null（强制降级为候选/确认） */
  function getFreshLastConfirmedRecord(): AccountRecord | null {
    if (!lastConfirmedRecord.value) return null;
    if (Date.now() - lastConfirmedRecordSavedAt > lastConfirmedTtlMs) {
      lastConfirmedRecord.value = null;
      lastConfirmedRecordSavedAt = 0;
      agentEngine.setLastConfirmedRecordContext(null);
      return null;
    }
    return lastConfirmedRecord.value;
  }
  function getFreshLastConfirmedTrip(): TripRecord | null {
    if (!lastConfirmedTrip.value) return null;
    if (Date.now() - lastConfirmedTripSavedAt > lastConfirmedTtlMs) {
      lastConfirmedTrip.value = null;
      lastConfirmedTripSavedAt = 0;
      return null;
    }
    return lastConfirmedTrip.value;
  }

  /** 从 app_config 加载 TTL 与强制确认开关，失败时保留默认值 */
  async function loadLastConfirmedTtl() {
    try {
      const val = await getConfig('last_confirmed_ttl_minutes');
      const minutes = parseInt(val, 10);
      if (!Number.isNaN(minutes) && minutes > 0) {
        lastConfirmedTtlMs = minutes * 60 * 1000;
      }
    } catch { /* 未设置则用默认值 */ }
    try {
      const val = await getConfig('force_confirm_corrections');
      forceConfirmCorrections = val === '1' || val === 'true';
    } catch { /* 未设置则默认关闭 */ }
  }
  const awaitingFollowUp = ref(false);
  const pendingFollowUp = ref<{
    question: string;
    missingFields: string[];
    originalFields: Record<string, unknown>;
  } | null>(null);
  const editingField = ref<string | null>(null);
  const originalParse = ref<Record<string, unknown> | null>(null);
  
  // 记录更新通知（用于通知其他页面刷新）
  const recordUpdated = ref(0);

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
      // 先加载 "上一条" TTL 配置，供后续恢复时判定
      await loadLastConfirmedTtl();

      const res = await getChatHistory(limit);
      console.log(`[ChatStore] Loaded ${res.data.length} messages from history`);
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

        loaded.push({
          id: genId(),
          role: m.role as 'user' | 'ai',
          content: m.content || '',
          data: (persistedData.record || persistedData.correction || persistedData.deletion || persistedData.followUp) as Record<string, unknown> | undefined,
          render,
          status,
          steps: persistedData._steps,
          createdAt: m.created_at,
        });

        // 恢复"上一条"引用（含时间戳，供 TTL 过期判定）
        if (persistedData.result?.success) {
          const action = persistedData.result.action;
          const savedAt = parseCreatedAt(m.created_at);
          // 记账域：新建 / 修正 confirm
          if (['confirm_record', 'confirm_correction'].includes(action || '')) {
            const rec = (persistedData.record as unknown as AccountRecord) || null;
            if (rec && 'id' in rec) {
              setLastConfirmedRecord(rec, savedAt);
              agentEngine.setLastConfirmedRecordContext(rec);
            }
          }
          // 差旅域：新建 / 修正 / 发放（成功后视为"最近处理过的一条差旅"）
          else if (['create_trip_record', 'confirm_trip_record', 'confirm_trip_correction', 'record_trip_payment', 'confirm_trip_payment'].includes(action || '')) {
            const rec = (persistedData.record as unknown as TripRecord) || null;
            if (rec && 'id' in rec) {
              setLastConfirmedTrip(rec, savedAt);
            }
          }
          // 删除：清空对应域引用
          else if (action === 'confirm_delete') {
            setLastConfirmedRecord(null);
            agentEngine.setLastConfirmedRecordContext(null);
          } else if (action === 'confirm_trip_delete') {
            setLastConfirmedTrip(null);
          }
        }
      }

      messages.value = loaded;

      // 恢复 Agent 对话上下文（最近 10 轮）
      if (llmMessages.length > 0) {
        agentEngine.restoreContext(llmMessages, 10);
      }

      // 触发一次 TTL 检查：若恢复出的引用已过期，读取时会自动清空
      getFreshLastConfirmedRecord();
      getFreshLastConfirmedTrip();

      // 恢复当前 pending 状态（如果最后一条是 pending）
      const lastMsg = loaded[loaded.length - 1];
      if (lastMsg?.status === 'pending' && lastMsg.data) {
        pendingRecord.value = lastMsg.data as Record<string, unknown>;
        // 从推理步骤中推断 action，没有则回退到 create_record
        const intentStep = lastMsg.steps?.find(s => s.id === 'intent');
        const inferredAction = intentStep?.detail?.action;
        pendingAction.value = inferredAction || 'create_record';
      }
    } catch {
      // No history
    }
  }

  /** 解析持久化消息里 created_at（形如 "2026-07-08 15:00:00"），转为 epoch ms；解析失败返回 0（表示未知，将立即过期） */
  function parseCreatedAt(createdAt?: string): number {
    if (!createdAt) return 0;
    // 本地时间字符串，直接给 Date 解析（跨平台 Safari/Chromium 都能识别 "YYYY-MM-DD HH:mm:ss" 变体，也支持 ISO）
    const ts = new Date(createdAt.replace(' ', 'T')).getTime();
    return Number.isFinite(ts) ? ts : 0;
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

      // 存储记录数据（按 render 类型分派到对应字段，便于 deriveRenderType 恢复）
      if (msg.data) {
        if (msg.render === 'correctionCard') {
          persistedData.correction = msg.data as PersistedChatData['correction'];
        } else if (msg.render === 'deleteCard') {
          persistedData.deletion = msg.data as PersistedChatData['deletion'];
        } else {
          persistedData.record = msg.data as Record<string, unknown>;
        }
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
    } catch (e) {
      console.error('[ChatStore] Failed to persist message:', e);
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
    const now = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).replace(/\//g, '-');
    
    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content: text,
      imageSrc: imageFullSrc,
      createdAt: now,
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
      createdAt: now,
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
        lastConfirmedRecord: getFreshLastConfirmedRecord(),
        lastConfirmedTrip: getFreshLastConfirmedTrip(),
        forceConfirmCorrections,
      });

      // 收集 LLM 消息
      const history = agentEngine.getHistory();
      currentLlmMessages.push(...history.slice(-2)); // 只存本轮的 user + assistant

      // 处理完成
      aiMsg.loading = false;
      aiMsg.content = result.finalReply;
      aiMsg.render = result.toolResult?.render || 'text';
      aiMsg.data = result.toolResult?.data as Record<string, unknown>;

      // 处理确认卡片（含 record_trip_payment 单命中路径 与 confirm_trip_payment_selected 候选选中后）
      if (
        result.action &&
        ['create_record', 'create_trip_record', 'record_trip_payment', 'confirm_trip_payment_selected'].includes(result.action) &&
        result.toolResult?.render === 'card'
      ) {
        aiMsg.status = 'pending';
        pendingRecord.value = result.toolResult?.data as Record<string, unknown> | null;
        // confirm_trip_payment_selected 走 record_trip_payment 一样的确认路径
        pendingAction.value = result.action === 'confirm_trip_payment_selected' ? 'record_trip_payment' : result.action;
      }

      // 处理候选记录选择（含记账 correct/delete、差旅 update/delete、差旅发放多命中）
      if (
        result.action &&
        ['correct_record', 'delete_record', 'update_trip_record', 'delete_trip_record', 'record_trip_payment'].includes(result.action) &&
        result.toolResult?.render === 'candidateSelect'
      ) {
        aiMsg.status = 'pending';
        aiMsg.render = 'candidateSelect';
        pendingRecord.value = result.toolResult?.data as Record<string, unknown> | null;
        pendingAction.value = 'select_record';
      }

      // 处理高风险修正（记账 & 差旅共用 correctionCard 分支，通过 data.domain 区分）
      if (
        result.action &&
        ['correct_record', 'update_trip_record'].includes(result.action) &&
        result.toolResult?.render === 'correctionCard'
      ) {
        aiMsg.status = 'pending';
        pendingRecord.value = result.toolResult?.data as Record<string, unknown> | null;
        pendingAction.value = result.action === 'update_trip_record' ? 'confirm_trip_correction' : 'confirm_correction';
      }

      // 低风险修正（成功后更新 lastConfirmedRecord / lastConfirmedTrip）
      if (result.action === 'correct_record' && result.toolResult?.render === 'text') {
        const data = result.toolResult?.data as { updatedRecord?: AccountRecord } | undefined;
        if (data?.updatedRecord) {
          setLastConfirmedRecord(data.updatedRecord);
          agentEngine.setLastConfirmedRecordContext(data.updatedRecord);
        }
      }
      if (result.action === 'update_trip_record' && result.toolResult?.render === 'text') {
        const data = result.toolResult?.data as { updatedRecord?: TripRecord } | undefined;
        if (data?.updatedRecord) {
          setLastConfirmedTrip(data.updatedRecord);
          recordUpdated.value++;
        }
      }

      // 处理删除（记账）
      if (result.action === 'delete_record') {
        if (result.toolResult?.render === 'deleteCard') {
          aiMsg.status = 'pending';
          pendingRecord.value = result.toolResult?.data as Record<string, unknown> | null;
          pendingAction.value = 'confirm_delete';
        } else if (result.toolResult?.render === 'text') {
          setLastConfirmedRecord(null);
          agentEngine.setLastConfirmedRecordContext(null);
          recordUpdated.value++;
        }
      }

      // 处理删除（差旅）
      if (result.action === 'delete_trip_record') {
        if (result.toolResult?.render === 'deleteCard') {
          aiMsg.status = 'pending';
          pendingRecord.value = result.toolResult?.data as Record<string, unknown> | null;
          pendingAction.value = 'confirm_trip_delete';
        } else if (result.toolResult?.render === 'text') {
          setLastConfirmedTrip(null);
          recordUpdated.value++;
        }
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
    // 防御：如果 pendingAction 丢失，根据 record 字段特征推断
    let action = pendingAction.value;
    if (!action) {
      if ('tripId' in record && 'matchType' in record) action = 'record_trip_payment';
      else if ('trip_id' in record && 'days' in record) action = 'create_trip_record';
      // 差旅域优先判定（_domain='trip' 由 tool-registry 写入）
      else if (record._domain === 'trip' && 'pendingDelete' in record) action = 'confirm_trip_delete';
      else if (record._domain === 'trip' && 'pendingUpdate' in record) action = 'confirm_trip_correction';
      else if ('pendingDelete' in record) action = 'confirm_delete';
      else if ('pendingUpdate' in record) action = 'confirm_correction';
      else action = 'create_record';
    }

    if (action === 'create_record') {
      // 检查重复记录
      const duplicateId = await checkDuplicate(record);
      if (duplicateId != null) {
        // 发现重复记录，提示用户并触发列表闪烁
        ElMessage.warning('发现重复记录，请确认是否已录入');
        window.dispatchEvent(new CustomEvent('records:highlight-duplicate', { detail: { id: duplicateId } }));
        return;
      }
    }

    originalParse.value = { ...record };

    try {
      await agentEngine.loadContext();

      // 工具名映射：确认动作 → 目标工具
      const toolName = (() => {
        switch (action) {
          case 'confirm_correction': return 'confirm_correction';
          case 'confirm_delete': return 'confirm_delete';
          case 'confirm_trip_correction': return 'confirm_trip_correction';
          case 'confirm_trip_delete': return 'confirm_trip_delete';
          case 'record_trip_payment': return 'confirm_trip_payment';
          default: return action.replace('create_', 'confirm_');
        }
      })();
      // 参数映射：不同确认工具需要的入参形状不同
      const toolArgs = (() => {
        if (action === 'confirm_correction') return record.pendingUpdate as Record<string, unknown>;
        if (action === 'confirm_delete') return record.pendingDelete as Record<string, unknown>;
        if (action === 'confirm_trip_correction') {
          const pu = record.pendingUpdate as { recordId: number; fields: Record<string, unknown> };
          return { tripId: pu.recordId, fields: pu.fields };
        }
        if (action === 'confirm_trip_delete') {
          const pd = record.pendingDelete as { recordId: number };
          return { tripId: pd.recordId };
        }
        return record;
      })();
      const toolResult = await toolRegistry.execute(toolName, toolArgs, {
        userMessage: msg.content,
        lastConfirmedRecord: getFreshLastConfirmedRecord(),
        lastConfirmedTrip: getFreshLastConfirmedTrip(),
        forceConfirmCorrections,
      });

      msg.content = toolResult.success
        ? (toolResult.message || '已确认')
        : (toolResult.error || '确认失败');
      msg.render = toolResult.render || 'text';
      msg.data = toolResult.data as Record<string, unknown>;
      msg.status = 'confirmed';

      // 存储确认对话的 LLM 消息（用于上下文恢复）
      const confirmLlmMessages: LLMMessage[] = [
        { role: 'user', content: '确认' },
        { role: 'assistant', content: msg.content },
      ];

      const confirmedData = toolResult.data as (AccountRecord | TripRecord | { updatedRecord?: AccountRecord | TripRecord; deletedRecord?: Record<string, unknown>; domain?: string }) | undefined;
      if (toolResult.success && confirmedData) {
        // 差旅域优先分派（若 tool 返回带 domain='trip'）
        const isTrip = (confirmedData as { domain?: string }).domain === 'trip' || action === 'confirm_trip_correction' || action === 'confirm_trip_delete';
        if (action === 'confirm_trip_delete') {
          setLastConfirmedTrip(null);
          recordUpdated.value++;
        } else if (action === 'confirm_delete') {
          setLastConfirmedRecord(null);
          agentEngine.setLastConfirmedRecordContext(null);
          recordUpdated.value++;
        } else if ('updatedRecord' in confirmedData && confirmedData.updatedRecord) {
          if (isTrip) {
            setLastConfirmedTrip(confirmedData.updatedRecord as TripRecord);
          } else {
            setLastConfirmedRecord(confirmedData.updatedRecord as AccountRecord);
            agentEngine.setLastConfirmedRecordContext(confirmedData.updatedRecord);
          }
          recordUpdated.value++;
        } else if ('id' in confirmedData) {
          if (isTrip) {
            setLastConfirmedTrip(confirmedData as TripRecord);
          } else {
            setLastConfirmedRecord(confirmedData as AccountRecord);
            agentEngine.setLastConfirmedRecordContext(confirmedData);
          }
          recordUpdated.value++;
        }
      }

      if (originalParse.value) {
        await saveLearningIfNeeded(originalParse.value, record);
      }

      // 临时保留 pendingAction，让 persistMessage 写入 result.action，写完再清
      pendingRecord.value = null;
      originalParse.value = null;

      await persistMessage(msg, confirmLlmMessages);
      pendingAction.value = null;
    } catch (e: unknown) {
      msg.content = e instanceof Error ? e.message : '确认失败';
      msg.render = 'text';
      await persistMessage(msg, [{ role: 'assistant', content: msg.content }]);
    }
  }

  /**
   * 取消记录
   */
  async function cancelRecord(msg: ChatMessage): Promise<void> {
    // 修改原消息为取消状态
    msg.status = 'cancelled';
    msg.render = 'text';
    msg.content = '好的，请重新输入你的记账信息。';
    // 标记原消息已被取消（用于历史加载时跳过卡片）
    if (msg.data) {
      msg.data._cancelled = true;
    }
    msg.steps = undefined;
    pendingRecord.value = null;
    pendingAction.value = null;

    // 保存取消状态到数据库（更新原消息）
    await persistMessage(msg, []);
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

  async function checkDuplicate(record: Record<string, unknown>): Promise<number | null> {
    try {
      const { getRecords } = await import('@/api/tauri');
      const datetime = (record.datetime as string) || new Date().toISOString().replace('T', ' ').substring(0, 19);
      
      // 精确到秒的重复检查：比较完整的时间戳（年月日时分秒）
      const records = await getRecords({
        page: 1,
        pageSize: 100,
      });

      const amount = typeof record.amount === 'number' ? record.amount : parseFloat(String(record.amount));
      const recordType = record.type;
      const recordDatetime = datetime;

      for (const r of records.data) {
        const sameAmount = Math.abs((r.amount || 0) - amount) < 0.01;
        const sameType = r.type === recordType;
        // 精确到秒的比较（完整时间戳）
        const sameDatetime = r.datetime && r.datetime.substring(0, 19) === recordDatetime.substring(0, 19);

        if (sameAmount && sameType && sameDatetime) {
          // 发现重复记录
          console.log('[重复检查] 发现重复:', { id: r.id, amount, datetime: recordDatetime, type: recordType });
          return r.id ?? null;
        }
      }
      return null;
    } catch (e) {
      console.error('[重复检查] 失败:', e);
      // 检查失败时，不阻止用户确认（返回 null 允许继续）
      return null;
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
    setLastConfirmedRecord(null);
    setLastConfirmedTrip(null);
    sessionId = generateSessionId(); // 清空时生成新 session
  }

  async function clearHistory() {
    try {
      await clearChatHistory();
      clearMessages();
      agentEngine.clearHistory();
      agentEngine.clearLLMLogs();
      agentEngine.setLastConfirmedRecordContext(null);
      // 清空调试控制台的所有日志
      clearIpcLogs();
    } catch {
      // Ignore
    }
  }

  async function callTool(name: string, args: unknown): Promise<{ success: boolean; message?: string; error?: string; data?: unknown } | undefined> {
    try {
      await agentEngine.loadContext();
      const result = await toolRegistry.execute(name, args, {
        userMessage: '',
        lastConfirmedRecord: getFreshLastConfirmedRecord(),
        lastConfirmedTrip: getFreshLastConfirmedTrip(),
        forceConfirmCorrections,
      });
      return result;
    } catch (e) {
      console.error('[ChatStore] callTool error:', e);
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return {
    messages, isOpen, sending, ocrLoading,
    pendingRecord, pendingAction, lastConfirmedRecord, lastConfirmedTrip,
    awaitingFollowUp, pendingFollowUp, editingField,
    recordUpdated,
    genId, loadHistory, sendMessage, confirmRecord, cancelRecord, callTool,
    startEditField, applyFieldEdit, answerFollowUp, clearMessages, clearHistory,
    // 让 Settings 页保存后即时热更新（无需重启）
    setForceConfirmCorrections: (v: boolean) => { forceConfirmCorrections = v; },
    setLastConfirmedTtlMinutes: (m: number) => { if (m > 0) lastConfirmedTtlMs = m * 60 * 1000; },
  };
});
