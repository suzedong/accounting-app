<template>
  <div class="chat-widget">
    <!-- Floating button -->
    <el-button
      v-if="!isOpen"
      class="chat-fab"
      circle
      size="large"
      @click="isOpen = true"
    >
      <el-icon :size="24"><ChatDotRound /></el-icon>
    </el-button>

    <!-- Chat panel -->
    <el-drawer
      v-if="isOpen"
      v-model="isOpen"
      title="AI 对话"
      direction="rtl"
      size="420px"
      class="chat-drawer"
    >
      <div class="chat-container">
        <!-- Panel switcher -->
        <div class="panel-switcher">
          <el-button size="small" :type="activePanel === 'chat' ? 'primary' : ''" text @click="activePanel = 'chat'">对话</el-button>
          <el-button size="small" :type="activePanel === 'debug' ? 'primary' : ''" text @click="activePanel = 'debug'">调试</el-button>
          <el-button size="small" :type="activePanel === 'rules' ? 'primary' : ''" text @click="openRulesPanel">设置</el-button>
          <el-button size="small" text @click="clearHistory" title="清空对话">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>

        <!-- Chat panel -->
        <div v-show="activePanel === 'chat'" class="chat-scroll">
          <div class="messages" ref="messagesRef">
          <!-- Welcome page (shown when no messages) -->
          <div v-if="messages.length === 0" class="welcome">
            <div class="welcome-icon">🤖</div>
            <div class="welcome-title">你好！我是你的 AI 记账助手</div>
            <div class="welcome-sub">告诉我你的收支情况，我会帮你记录</div>
            <div class="quick-actions">
              <el-button size="small" @click="sendQuick('今天中午吃饭花了35元')">今天吃饭35元</el-button>
              <el-button size="small" @click="sendQuick('收入5000工资')">工资收入5000</el-button>
              <el-button size="small" @click="sendQuick('昨天打车25支付宝')">昨天打车25</el-button>
            </div>
          </div>

          <!-- Thinking process (active) -->
          <div v-if="thinkingVisible" class="message ai thinking-active" :id="thinkingMsgId ?? undefined">
            <div class="thinking-bubble">
              <ChatThinking
                thinking-steps="intent"
                :intent-label="thinkingIntent"
                :confidence="thinkingConfidence"
                :detail-fields="thinkingDetails"
              />
            </div>
          </div>

          <ChatMessage
            v-for="msg in messages"
            :key="msg.id"
            :role="msg.role"
            :content="msg.content"
            :image-src="msg.imageSrc"
            :data="msg.data"
            :render="msg.render"
            :title="msg.title"
            :loading="msg.loading"
            :status="msg.status"
            :skill="msg.skill"
            @card-action="handleCardAction(msg, $event)"
            @follow-up-select="handleFollowUpSelect(msg, $event)"
          />
        </div>

        <!-- Chat input with image support -->
        <ChatInput
          v-model:sending="sending"
          v-model:ocr-loading="ocrLoading"
          @send="onSend"
        />
        </div>

        <!-- Debug panel -->
        <div v-show="activePanel === 'debug'" class="panel-content">
          <DebugPanel
            :dispatch-result="debugDispatch"
            :action-result="debugAction"
            :message-count="messages.length"
            :messages-summary="messagesSummary"
            :last-error="debugLastError"
            @close="activePanel = 'chat'"
          />
        </div>

        <!-- Rules panel -->
        <div v-show="activePanel === 'rules'" class="panel-content">
          <RulesPanel
            :prompt-content="promptContent"
            :preferences="preferences"
            :learning-data="learningData"
            :saving="promptSaving"
            @close="activePanel = 'chat'"
            @save="handleSaveRule"
            @clear-learning="handleClearLearning"
            @refresh-prompt="handleRefreshPrompt"
            @refresh-preferences="handleRefreshPreferences"
            @refresh-learning="handleRefreshLearning"
          />
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ChatDotRound, Delete } from '@element-plus/icons-vue';
import ChatMessage from './ChatMessage.vue';
import ChatInput from './ChatInput.vue';
import ChatThinking from './ChatThinking.vue';
import { dispatchLLM } from '@/ai/dispatch';
import { executeAction } from '@/ai/actions';
import { getChatHistory, saveChatMessage, saveCorrection, deleteCorrection, clearCorrections, clearChatHistory, getSystemPrompt, updateSystemPrompt, getAllPreferences, updatePreference, getLearningCorrections, getCategories, getPaymentMethods, getRecords } from '@/api/tauri';
import { useOCR } from '@/composables/useOCR';
import type { SkillMeta } from '@/types';
import DebugPanel from './DebugPanel.vue';
import RulesPanel from './RulesPanel.vue';

interface ChatMsg {
  id: number;
  role: 'user' | 'ai';
  content: string;
  imageSrc?: string;  // base64 data URL for user image messages
  data?: Record<string, unknown>;
  render?: string;
  title?: string;
  loading?: boolean;
  status?: 'pending' | 'confirmed' | 'cancelled' | 'success';
  skill?: SkillMeta;  // skill metadata for AI messages
}

const isOpen = ref(false);
const sending = ref(false);
const ocrLoading = ref(false);
const messages = ref<ChatMsg[]>([]);
const messagesRef = ref<HTMLElement | null>(null);
let nextId = 1;

const { recognize } = useOCR();

// Thinking process state
const thinkingVisible = ref(false);
const thinkingMsgId = ref<string | null>(null);
const thinkingIntent = ref('');
const thinkingConfidence = ref(0);
const thinkingDetails = ref<Array<{ label: string; value: string }>>([]);
const thinkingSkillName = ref('');

// Conversation state
const conversationState = ref<{
  waitingForConfirm: boolean;
  pendingRecord: Record<string, unknown> | null;
  pendingAction: string | null;
  awaitingFollowUp: boolean;
  pendingFollowUp: {
    question: string;
    missingFields: string[];
    originalFields: Record<string, unknown>;
  } | null;
  editingField: string | null;
  originalParse: Record<string, unknown> | null;
  recordSkill: SkillMeta | null;
}>({
  waitingForConfirm: false,
  pendingRecord: null,
  pendingAction: null,
  awaitingFollowUp: false,
  pendingFollowUp: null,
  editingField: null,
  originalParse: null,
  recordSkill: null,
});

// Debug / Rules panel state
const activePanel = ref<'chat' | 'debug' | 'rules'>('chat');
const debugDispatch = ref<Record<string, unknown> | null>(null);
const debugAction = ref<Record<string, unknown> | null>(null);
const debugLastError = ref<string | null>(null);
const promptContent = ref('');
const promptSaving = ref(false);
const learningData = ref<Array<{ id: number; keyword: string; field: string; value: string }>>([]);
const preferences = ref<Array<{ key: string; value: string }>>([]);
const currentPromptName = ref('dispatch');

onMounted(async () => {
  try {
    const res = await getChatHistory(50);
    for (const m of res.data.reverse()) {
      const parsedData = m.data ? JSON.parse(m.data) : {};
      const skillMeta = m.skill ? JSON.parse(m.skill) : null;
      messages.value.push({
        id: nextId++,
        role: m.role as 'user' | 'ai',
        content: m.content || '',
        data: parsedData,
        render: parsedData._render || 'text',
        title: parsedData._title,
        status: parsedData._status || (m.role === 'ai' ? 'success' : undefined),
        skill: skillMeta,
      });
    }

    // Restore conversation state from pending messages
    const lastPending = [...messages.value].reverse().find(m => m.status === 'pending' && m.render === 'card');
    if (lastPending) {
      conversationState.value.waitingForConfirm = true;
      conversationState.value.pendingRecord = lastPending.data || null;
      conversationState.value.recordSkill = lastPending.skill || null;
    }
  } catch {
    // No history or not yet configured
  }
});

async function scrollToBottom() {
  await nextTick();
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  }
}

async function persistMessage(msg: ChatMsg) {
  try {
    const dataObj: Record<string, unknown> = { ...msg.data };
    if (msg.render) dataObj._render = msg.render;
    if (msg.title) dataObj._title = msg.title;
    if (msg.status) dataObj._status = msg.status;
    await saveChatMessage(
      msg.role,
      msg.content,
      Object.keys(dataObj).length > 0 ? JSON.stringify(dataObj) : null,
      msg.skill ? JSON.stringify(msg.skill) : null,
      msg.skill?.confidence || null,
    );
  } catch {
    // Ignore persistence errors
  }
}

async function onSend(text: string, imageBase64?: string, imageFullSrc?: string) {
  const fullSrc = imageFullSrc || (imageBase64 ? `data:image/png;base64,${imageBase64}` : undefined);
  await handleSend(text, imageBase64, fullSrc || undefined);
}

async function handleSend(text: string, imageBase64?: string, imageFullSrc?: string) {
  // If we're editing a field on a pending record
  if (conversationState.value.editingField && conversationState.value.pendingRecord) {
    const field = conversationState.value.editingField;
    conversationState.value.pendingRecord[field] = text;
    conversationState.value.editingField = null;
    messages.value.push({
      id: nextId++,
      role: 'user',
      content: `修改${getFieldLabel(field)}为：${text}`,
    });
    messages.value.push({
      id: nextId++,
      role: 'ai',
      content: `已更新${getFieldLabel(field)}`,
      render: 'text',
      status: 'success',
    });
    await scrollToBottom();
    return;
  }

  // If we're in a follow-up flow
  if (conversationState.value.awaitingFollowUp && conversationState.value.pendingFollowUp) {
    const followUp = conversationState.value.pendingFollowUp;
    const missingField = followUp.missingFields[0];

    // Merge the user's answer into original fields
    const mergedFields = { ...followUp.originalFields };
    if (missingField === 'amount') {
      const amountMatch = text.match(/(\d+\.?\d*)/);
      if (amountMatch) mergedFields.amount = parseFloat(amountMatch[1]);
    } else if (missingField) {
      mergedFields[missingField] = text;
    }

    // Save learning correction if the answer changed an original guess
    const original = followUp.originalFields[missingField];
    if (original) {
      const answer = missingField === 'amount'
        ? (mergedFields.amount as unknown)
        : text;
      await saveLearningCorrection(original, missingField, answer);
    }

    conversationState.value.awaitingFollowUp = false;
    conversationState.value.pendingFollowUp = null;

    // Re-dispatch with merged fields
    const synthesized = buildSynthesizedInput(mergedFields);
    await dispatchAndProcess(synthesized, mergedFields, imageBase64, imageFullSrc);
    return;
  }

  // Normal flow: dispatch LLM
  await dispatchAndProcess(text, null, imageBase64, imageFullSrc);
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

function getFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    amount: '金额', type: '类型', category: '分类',
    account: '账户', payment: '支付方式', datetime: '时间', note: '备注',
    trip_id: '申请单号', start_date: '出发日期', end_date: '返程日期',
    days: '出差天数', notes: '备注',
  };
  return labels[field] || field;
}

/**
 * 构建最近对话上下文（用于多轮对话理解）
 */
function buildConversationContext(): string {
  const recent = messages.value.slice(-6);
  const parts: string[] = [];
  for (const m of recent) {
    if (m.role === 'user') {
      parts.push(`用户: ${m.content}`);
    } else if (m.status === 'pending') {
      const fields = m.data;
      if (fields) {
        const fieldParts: string[] = [];
        if (fields.amount) fieldParts.push(`${fields.amount}元`);
        if (fields.type) fieldParts.push(fields.type as string);
        if (fields.category) fieldParts.push(fields.category as string);
        if (fields.trip_id) fieldParts.push(`出差: ${fields.trip_id}`);
        parts.push(`AI(待确认): ${fieldParts.join(' / ')}`);
      }
    } else if (m.content && !m.loading) {
      const text = m.content.length > 80 ? m.content.substring(0, 80) + '...' : m.content;
      parts.push(`AI: ${text}`);
    }
  }
  return parts.join('\n');
}

/**
 * 保存学习修正
 */
async function saveLearningCorrection(
  originalValue: unknown,
  field: string,
  correctedValue: unknown,
) {
  if (!originalValue || !correctedValue) return;
  if (String(originalValue) === String(correctedValue)) return;
  if (!['category', 'payment_method', 'payment'].includes(field)) return;

  try {
    const keyword = String(originalValue);
    const value = String(correctedValue);
    await saveCorrection(keyword, field === 'payment' ? 'payment_method' : field, value);
  } catch {
    // Ignore learning errors
  }
}

// ==================== Thinking Process UI ====================

function showThinking(intentLabel: string, confidence: number, details: Array<{ label: string; value: string }> = []) {
  thinkingVisible.value = true;
  thinkingMsgId.value = `thinking_${Date.now()}`;
  thinkingIntent.value = intentLabel;
  thinkingConfidence.value = confidence;
  thinkingDetails.value = details;
  nextTick(() => scrollToBottom());
}

function updateThinking(intentLabel: string, confidence: number, details: Array<{ label: string; value: string }>) {
  thinkingIntent.value = intentLabel;
  thinkingConfidence.value = confidence;
  thinkingDetails.value = details;
  nextTick(() => scrollToBottom());
}

function collapseThinking(skillName: string) {
  thinkingSkillName.value = skillName;
  thinkingVisible.value = false;
  thinkingMsgId.value = null;
}

function hideThinking() {
  thinkingVisible.value = false;
  thinkingMsgId.value = null;
}

// ==================== Duplicate Detection ====================

async function checkDuplicate(record: Record<string, unknown>): Promise<{ isDuplicate: boolean; existingRecord?: Record<string, unknown> }> {
  try {
    const dateStr = (record.datetime as string || '').substring(0, 10) || new Date().toISOString().substring(0, 10);
    const records = await getRecords({
      page: 1,
      pageSize: 100,
      datetimeGte: `${dateStr} 00:00:00`,
      datetimeLte: `${dateStr} 23:59:59`,
    });

    const amount = typeof record.amount === 'number' ? record.amount : parseFloat(String(record.amount));

    for (const r of records.data) {
      const recordObj = r as unknown as Record<string, unknown>;
      const sameAmount = Math.abs((r.amount || 0) - amount) < 0.01;
      const sameType = r.type === record.type;
      const sameDate = r.datetime && r.datetime.substring(0, 10) === dateStr;

      if (sameAmount && sameType && sameDate) {
        return { isDuplicate: true, existingRecord: recordObj };
      }
    }
    return { isDuplicate: false };
  } catch (e) {
    console.error('检查重复失败:', e);
    return { isDuplicate: false };
  }
}

// ==================== Dynamic Field Selection ====================

async function loadCategories(type?: string): Promise<string[]> {
  try {
    const cats = await getCategories(type);
    return cats.length > 0 ? cats : ['餐饮', '交通出行', '购物', '通信费', '生活杂费', '其他'];
  } catch {
    return ['餐饮', '交通出行', '购物', '通信费', '生活杂费', '其他'];
  }
}

async function loadPaymentMethods(): Promise<string[]> {
  try {
    const methods = await getPaymentMethods();
    return methods.length > 0 ? methods : ['微信支付', '支付宝', '信用卡', '现金'];
  } catch {
    return ['微信支付', '支付宝', '信用卡', '现金'];
  }
}

// ==================== Main dispatch loop ====================

async function dispatchAndProcess(
  text: string,
  mergedFields: Record<string, unknown> | null,
  imageBase64?: string,
  imageFullSrc?: string,
) {
  let inputText = text;

  // OCR processing if image provided
  if (imageBase64) {
    ocrLoading.value = true;
    try {
      const ocrText = await recognize(imageBase64);
      if (ocrText.trim()) {
        inputText = text ? `${text} ${ocrText.trim()}` : ocrText.trim();
      }
    } catch {
      // Use user's text if OCR fails
    } finally {
      ocrLoading.value = false;
    }
  }

  if (!inputText || sending.value) return;
  sending.value = true;

  // Add user message (with optional image thumbnail)
  const userMsg: ChatMsg = {
    id: nextId++,
    role: 'user',
    content: inputText,
    imageSrc: imageFullSrc,
  };
  messages.value.push(userMsg);
  await scrollToBottom();
  await persistMessage(userMsg);

  try {
    // Build conversation context
    const conversationContext = buildConversationContext();

    const dispatchResult = await dispatchLLM(inputText, conversationContext);

    // Update debug state
    debugDispatch.value = {
      action: dispatchResult.action,
      params: dispatchResult.params,
      render: dispatchResult.render,
      title: dispatchResult.title,
      confidence: dispatchResult.confidence,
    };
    debugLastError.value = null;

    // Step 1: Show thinking - intent recognition
    const intentLabel = (dispatchResult as any)._intent || dispatchResult.title || dispatchResult.action;
    const detailFields = buildThinkingDetailFields(intentLabel, dispatchResult.params);
    showThinking(intentLabel, dispatchResult.confidence, detailFields);
    await new Promise(r => setTimeout(r, 300));

    // Step 2: Update thinking - show recognized details
    updateThinking(intentLabel, dispatchResult.confidence, detailFields);
    await new Promise(r => setTimeout(r, 200));

    // Step 3: Show skill execution
    const skill = dispatchResult._skill || { name: dispatchResult.action, displayName: '处理中', confidence: dispatchResult.confidence };
    thinkingSkillName.value = skill.displayName;

    // If merged fields from follow-up, merge into dispatch params
    if (mergedFields && dispatchResult.params?.fields) {
      dispatchResult.params.fields = {
        ...(dispatchResult.params.fields as Record<string, unknown>),
        ...mergedFields,
      };
    }

    const actionResult = await executeAction(dispatchResult);

    // Update debug state
    debugAction.value = {
      success: actionResult.success,
      render: actionResult.render,
      message: actionResult.message,
    };

    // Collapse thinking - show final result
    collapseThinking(skill.displayName);

    // Add AI message with skill metadata
    const aiMsg: ChatMsg = {
      id: nextId++,
      role: 'ai',
      content: actionResult.message,
      data: actionResult.data as Record<string, unknown>,
      render: actionResult.render,
      title: dispatchResult.title,
      skill: dispatchResult._skill,
    };
    messages.value.push(aiMsg);

    // Handle create_record / create_trip_record / record_trip_payment with render=card
    if (['create_record', 'create_trip_record', 'record_trip_payment'].includes(dispatchResult.action) && actionResult.render === 'card') {
      aiMsg.status = 'pending';
      conversationState.value.waitingForConfirm = true;
      conversationState.value.pendingRecord = actionResult.data as Record<string, unknown>;
      conversationState.value.pendingAction = dispatchResult.action;
      conversationState.value.recordSkill = dispatchResult._skill || null;
    }

    // Handle follow-up
    if (dispatchResult.action === 'ask_follow_up') {
      conversationState.value.awaitingFollowUp = true;
      conversationState.value.pendingFollowUp = actionResult.data
        ? {
            question: (actionResult.data as any).question || '',
            missingFields: (actionResult.data as any).missingFields || [],
            originalFields: (actionResult.data as any).originalFields || {},
          }
        : null;
    }

    await persistMessage(aiMsg);
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    debugLastError.value = errMsg;
    hideThinking();
    messages.value.push({
      id: nextId++,
      role: 'ai',
      content: errMsg,
      render: 'text',
      status: 'success',
    });
    await persistMessage(messages.value[messages.value.length - 1]);
  } finally {
    sending.value = false;
    await scrollToBottom();
  }
}

/**
 * Build detail fields for thinking UI based on intent
 */
function buildThinkingDetailFields(intentLabel: string, params: Record<string, unknown>): Array<{ label: string; value: string }> {
  const fields = params?.fields as Record<string, unknown> | undefined;
  if (!fields) return [];

  const detailFields: Array<{ label: string; value: string }> = [];

  if (intentLabel === '记账' || intentLabel === '纠正记录') {
    if (fields.type) detailFields.push({ label: '类型', value: fields.type as string });
    if (fields.amount) detailFields.push({ label: '金额', value: `¥${parseFloat(String(fields.amount)).toFixed(2)}` });
    if (fields.category) detailFields.push({ label: '分类', value: fields.category as string });
    if (fields.account) detailFields.push({ label: '账户', value: fields.account as string });
    if (fields.payment || fields.payment_method) detailFields.push({ label: '支付', value: String(fields.payment || fields.payment_method) });
    if (fields.datetime) detailFields.push({ label: '时间', value: fields.datetime as string });
    if (fields.note) detailFields.push({ label: '备注', value: fields.note as string });
  } else if (intentLabel === '查询记录') {
    if (params.timeRange) detailFields.push({ label: '时间范围', value: params.timeRange as string });
    if (params.type) detailFields.push({ label: '类型', value: params.type === 'expense' ? '支出' : params.type === 'income' ? '收入' : '全部' });
    if (params.category) detailFields.push({ label: '分类', value: params.category as string });
  } else if (intentLabel === '统计分析') {
    const dimMap: Record<string, string> = { category: '分类', account: '账户', trend: '趋势', comparison: '对比' };
    if (params.dimension) detailFields.push({ label: '维度', value: dimMap[params.dimension as string] || params.dimension as string });
    if (params.timeRange) detailFields.push({ label: '时间范围', value: params.timeRange as string });
    if (params.type) detailFields.push({ label: '类型', value: params.type === 'expense' ? '支出' : '收入' });
  } else if (intentLabel === '追问补充') {
    // Show recognized fields
    for (const [k, v] of Object.entries(fields)) {
      if (v) detailFields.push({ label: getFieldLabel(k), value: String(v) });
    }
  }

  return detailFields;
}

function handleCardAction(msg: ChatMsg, action: 'confirm' | 'edit' | 'cancel') {
  if (!conversationState.value.pendingRecord) return;

  if (action === 'confirm') {
    confirmRecord(msg);
  } else if (action === 'edit') {
    showFieldEditor(msg);
  } else if (action === 'cancel') {
    cancelRecord(msg);
  }
}

async function confirmRecord(msg: ChatMsg) {
  const record = conversationState.value.pendingRecord;
  const action = conversationState.value.pendingAction || 'create_record';
  if (!record) return;

  // Check for duplicate before confirming
  if (action === 'create_record') {
    const dupResult = await checkDuplicate(record);
    if (dupResult.isDuplicate) {
      const existing = dupResult.existingRecord;
      ElMessage.warning(`发现重复记录：${existing?.datetime} 已有 ¥${existing?.amount} 的 ${existing?.type}（${existing?.category}）`);
      return;
    }
  }

  // Save original parse for learning
  conversationState.value.originalParse = { ...record };

  try {
    // Map action to confirm type
    let confirmAction = 'confirm_record';
    if (action === 'create_trip_record') confirmAction = 'confirm_trip_record';
    else if (action === 'record_trip_payment') confirmAction = 'confirm_trip_payment';

    const result = await executeAction({
      action: confirmAction,
      params: { fields: record },
      render: 'text',
      title: msg.title || '',
      confidence: 1,
    });

    msg.render = 'text';
    msg.content = result.message;
    msg.data = result.data as Record<string, unknown>;
    msg.status = 'confirmed';
    await persistMessage(msg);

    // Trigger learning if user had modified fields
    if (conversationState.value.originalParse) {
      const orig = conversationState.value.originalParse;
      const corrected = record as Record<string, unknown>;
      if (orig.category && corrected.category !== orig.category) {
        await saveLearningCorrection(orig.category, 'category', corrected.category);
      }
      if ((orig.payment || orig.payment_method) && (corrected.payment || corrected.payment_method) &&
          String(corrected.payment || corrected.payment_method) !== String(orig.payment || orig.payment_method)) {
        await saveLearningCorrection(orig.payment || orig.payment_method, 'payment_method', corrected.payment || corrected.payment_method);
      }
    }

    conversationState.value.waitingForConfirm = false;
    conversationState.value.pendingRecord = null;
    conversationState.value.pendingAction = null;
    conversationState.value.originalParse = null;
    conversationState.value.recordSkill = null;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    ElMessage.error('确认失败：' + errMsg);
  }
}

async function showFieldEditor(_msg: ChatMsg) {
  const record = conversationState.value.pendingRecord;
  if (!record) return;

  // Determine field list based on record type
  const isTripRecord = 'trip_id' in record;
  const fields = isTripRecord
    ? ['trip_id', 'start_date', 'end_date', 'days', 'notes']
    : ['type', 'amount', 'category', 'account', 'payment', 'datetime', 'note'];

  // Preload categories and payment methods for dynamic selection
  const categories = await loadCategories(record.type as string);
  const paymentMethods = await loadPaymentMethods();

  // Show field selection as quick buttons
  const fieldValues = fields.map(f => {
    const val = record[f];
    return `${getFieldLabel(f)}: ${val ?? ''}`;
  });

  messages.value.push({
    id: nextId++,
    role: 'ai',
    content: `请选择要修改的字段：`,
    data: { quickFields: fields, currentValues: fieldValues, categories, paymentMethods },
    render: 'fieldSelect',
    status: 'success',
  });
  await scrollToBottom();
  await persistMessage(messages.value[messages.value.length - 1]);

  // Use ElMessageBox for field selection
  const fieldInput = fieldValues.join('\n');
  ElMessageBox.prompt(
    `当前值：\n${fieldInput}\n\n请输入 字段名=新值（如 category=餐饮）`,
    '修改记录',
    {
      inputPlaceholder: '字段名=新值',
      confirmButtonText: '更新',
      cancelButtonText: '取消',
    },
  ).then(async ({ value }) => {
    const eqIdx = value.indexOf('=');
    if (eqIdx > 0) {
      const fieldName = value.substring(0, eqIdx).trim();
      const newVal = value.substring(eqIdx + 1).trim();
      if (record.hasOwnProperty(fieldName)) {
        const oldValue = record[fieldName];
        const finalVal = fieldName === 'amount' ? parseFloat(newVal) : newVal;
        await saveLearningCorrection(oldValue, fieldName, finalVal);

        if (fieldName === 'amount') {
          record[fieldName] = finalVal;
        } else {
          record[fieldName] = newVal;
        }
        messages.value.push({
          id: nextId++,
          role: 'ai',
          content: `已更新${getFieldLabel(fieldName)}为：${newVal}`,
          render: 'text',
          status: 'success',
        });
        await scrollToBottom();
      } else {
        ElMessage.warning(`未知字段：${fieldName}`);
      }
    }
  }).catch(() => {
    // User cancelled
  });
}

function cancelRecord(msg: ChatMsg) {
  msg.status = 'cancelled';
  msg.render = 'text';
  msg.content = '好的，请重新输入你的记账信息。';
  msg.data = undefined;
  persistMessage(msg);

  conversationState.value.waitingForConfirm = false;
  conversationState.value.pendingRecord = null;
  conversationState.value.pendingAction = null;
}

async function handleFollowUpSelect(_msg: ChatMsg, field: string) {
  conversationState.value.awaitingFollowUp = true;
  messages.value.push({
    id: nextId++,
    role: 'ai',
    content: `请输入${getFieldLabel(field)}：`,
    render: 'text',
    status: 'success',
  });
  await scrollToBottom();
}

function sendQuick(text: string) {
  dispatchAndProcess(text, null, undefined, undefined);
}

const messagesSummary = computed(() => {
  const counts: Record<string, number> = {};
  for (const m of messages.value) {
    const key = `${m.role}/${m.render || 'text'}/${m.status || '-'}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join('\n');
});

async function openRulesPanel() {
  activePanel.value = 'rules';
  await Promise.all([
    handleRefreshPrompt(),
    handleRefreshPreferences(),
    handleRefreshLearning(),
  ]);
}

async function handleRefreshPrompt() {
  try {
    const res = await getSystemPrompt(currentPromptName.value);
    promptContent.value = res.data.content;
  } catch {
    // Ignore errors
  }
}

async function handleRefreshPreferences() {
  try {
    const res = await getAllPreferences();
    preferences.value = res.data;
  } catch {
    preferences.value = [];
  }
}

async function handleRefreshLearning() {
  try {
    const res = await getLearningCorrections();
    learningData.value = res.data;
  } catch {
    learningData.value = [];
  }
}

async function handleSaveRule(type: string, content: string) {
  promptSaving.value = true;
  try {
    if (type === 'dispatch') {
      await updateSystemPrompt(currentPromptName.value, content);
      ElMessage.success('Prompt 已保存');
    } else if (type === 'preference') {
      // content is the full preferences.md format: "- key：value\n- key2：value2"
      // Parse and save each one
      const lines = content.split('\n').filter(l => l.trim().startsWith('- '));
      for (const line of lines) {
        const match = line.match(/^- (.+?)：(.+)$/);
        if (match) {
          await updatePreference(match[1], match[2]);
        }
      }
      ElMessage.success('偏好已保存');
      // Refresh to reflect changes
      await handleRefreshPreferences();
    } else if (type === 'deleteLearning') {
      try {
        const entry = JSON.parse(content);
        // Find the matching entry by keyword+field to get its id
        const match = learningData.value.find(l =>
          l.keyword === entry.keyword && l.field === entry.field && l.value === entry.value
        );
        if (match) {
          await deleteCorrection(match.id);
          learningData.value = learningData.value.filter(l => l.id !== match.id);
          ElMessage.success('已删除');
        }
      } catch (e) {
        ElMessage.error('删除失败：' + (e instanceof Error ? e.message : String(e)));
      }
    }
  } catch (e: unknown) {
    ElMessage.error('保存失败：' + (e instanceof Error ? e.message : String(e)));
  } finally {
    promptSaving.value = false;
  }
}

async function handleClearLearning() {
  try {
    ElMessageBox.confirm('确定清空所有学习数据？', '确认', {
      type: 'warning',
    }).then(async () => {
      await clearCorrections();
      learningData.value = [];
      ElMessage.success('学习数据已清空');
    });
  } catch {
    // User cancelled
  }
}

async function clearHistory() {
  try {
    ElMessageBox.confirm('确定清空对话历史？', '确认', {
      type: 'warning',
    }).then(async () => {
      messages.value = [];
      nextId = 1;
      conversationState.value = {
        waitingForConfirm: false, pendingRecord: null, pendingAction: null,
        awaitingFollowUp: false, pendingFollowUp: null, editingField: null,
        originalParse: null, recordSkill: null,
      };
      await clearChatHistory();
      ElMessage.success('对话历史已清空');
    });
  } catch {
    // User cancelled
  }
}
</script>

<style scoped>
.chat-fab {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 999;
  width: 56px;
  height: 56px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.chat-fab :deep(.el-icon) {
  color: white;
}

.chat-drawer :deep(.el-drawer__header) {
  margin-bottom: 0;
  padding: 16px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.chat-drawer :deep(.el-drawer__title) {
  color: white;
}

.chat-drawer :deep(.el-drawer__close-btn) {
  color: white;
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Panel switcher */
.panel-switcher {
  display: flex;
  gap: 2px;
  padding: 4px 8px;
  border-bottom: 1px solid #ebeef5;
  background: #fafafa;
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.chat-scroll {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* Welcome */
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
  text-align: center;
}

.welcome-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.welcome-title {
  font-size: 1.1em;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}

.welcome-sub {
  color: #999;
  font-size: 0.9em;
  margin-bottom: 20px;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

/* Thinking active */
.thinking-active {
  animation: thinking-fade-in 0.3s ease;
}

.thinking-bubble {
  max-width: 90%;
}

@keyframes thinking-fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.text-success { color: #52c41a; }
.text-danger { color: #ff4d4f; }
</style>
