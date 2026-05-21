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

          <ChatMessage
            v-for="msg in messages"
            :key="msg.id"
            :role="msg.role"
            :content="msg.content"
            :data="msg.data"
            :render="msg.render"
            :title="msg.title"
            :loading="msg.loading"
            :status="msg.status"
            @card-action="handleCardAction(msg, $event)"
            @follow-up-select="handleFollowUpSelect(msg, $event)"
          />
        </div>

        <!-- Chat input with image support -->
        <ChatInput
          v-model:sending="sending"
          v-model:ocr-loading="ocrLoading"
          @send="handleSend"
        />
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ChatDotRound } from '@element-plus/icons-vue';
import ChatMessage from './ChatMessage.vue';
import ChatInput from './ChatInput.vue';
import { dispatchLLM } from '@/ai/dispatch';
import { executeAction } from '@/ai/actions';
import { getChatHistory, saveChatMessage } from '@/api/tauri';
import { useOCR } from '@/composables/useOCR';

interface ChatMsg {
  id: number;
  role: 'user' | 'ai';
  content: string;
  data?: Record<string, unknown>;
  render?: string;
  title?: string;
  loading?: boolean;
  status?: 'pending' | 'confirmed' | 'cancelled' | 'success';
}

const isOpen = ref(false);
const sending = ref(false);
const ocrLoading = ref(false);
const messages = ref<ChatMsg[]>([]);
const messagesRef = ref<HTMLElement | null>(null);
let nextId = 1;

const { recognize } = useOCR();

// Conversation state
const conversationState = ref<{
  waitingForConfirm: boolean;
  pendingRecord: Record<string, unknown> | null;
  awaitingFollowUp: boolean;
  pendingFollowUp: {
    question: string;
    missingFields: string[];
    originalFields: Record<string, unknown>;
  } | null;
  editingField: string | null;
}>({
  waitingForConfirm: false,
  pendingRecord: null,
  awaitingFollowUp: false,
  pendingFollowUp: null,
  editingField: null,
});

onMounted(async () => {
  try {
    const res = await getChatHistory(50);
    for (const m of res.data.reverse()) {
      const parsedData = m.data ? JSON.parse(m.data) : {};
      messages.value.push({
        id: nextId++,
        role: m.role as 'user' | 'ai',
        content: m.content || '',
        data: parsedData,
        render: parsedData._render || 'text',
        title: parsedData._title,
        status: parsedData._status || (m.role === 'ai' ? 'success' : undefined),
      });
    }

    // Restore conversation state from pending messages
    const lastPending = [...messages.value].reverse().find(m => m.status === 'pending' && m.render === 'card');
    if (lastPending) {
      conversationState.value.waitingForConfirm = true;
      conversationState.value.pendingRecord = lastPending.data || null;
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
      null,
      null,
    );
  } catch {
    // Ignore persistence errors
  }
}

async function handleSend(text: string, imageBase64?: string) {
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

    conversationState.value.awaitingFollowUp = false;
    conversationState.value.pendingFollowUp = null;

    // Re-dispatch with merged fields
    const synthesized = buildSynthesizedInput(mergedFields);
    await dispatchAndProcess(synthesized, mergedFields, imageBase64);
    return;
  }

  // Normal flow: dispatch LLM
  await dispatchAndProcess(text, null, imageBase64);
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
  };
  return labels[field] || field;
}

async function dispatchAndProcess(
  text: string,
  mergedFields: Record<string, unknown> | null,
  imageBase64?: string,
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

  // Add user message
  const userMsg: ChatMsg = { id: nextId++, role: 'user', content: inputText };
  messages.value.push(userMsg);
  await scrollToBottom();
  await persistMessage(userMsg);

  // Add loading AI message
  const aiMsg: ChatMsg = { id: nextId++, role: 'ai', content: '', loading: true };
  messages.value.push(aiMsg);
  await scrollToBottom();

  try {
    const dispatchResult = await dispatchLLM(inputText);

    // If there are merged fields from follow-up, merge into dispatch params
    if (mergedFields && dispatchResult.params?.fields) {
      dispatchResult.params.fields = {
        ...(dispatchResult.params.fields as Record<string, unknown>),
        ...mergedFields,
      };
    }

    const actionResult = await executeAction(dispatchResult);

    aiMsg.loading = false;
    aiMsg.render = actionResult.render;
    aiMsg.content = actionResult.message;
    aiMsg.data = actionResult.data as Record<string, unknown>;
    aiMsg.title = dispatchResult.title;

    // Handle create_record with render=card: set pending state
    if (dispatchResult.action === 'create_record' && actionResult.render === 'card') {
      aiMsg.status = 'pending';
      conversationState.value.waitingForConfirm = true;
      conversationState.value.pendingRecord = actionResult.data as Record<string, unknown>;
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
    aiMsg.loading = false;
    aiMsg.content = errMsg;
    aiMsg.render = 'text';
    aiMsg.status = 'success';
    await persistMessage(aiMsg);
  } finally {
    sending.value = false;
    await scrollToBottom();
  }
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
  if (!record) return;

  try {
    const result = await executeAction({
      action: 'confirm_record',
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

    conversationState.value.waitingForConfirm = false;
    conversationState.value.pendingRecord = null;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    ElMessage.error('确认失败：' + errMsg);
  }
}

function showFieldEditor(_msg: ChatMsg) {
  const record = conversationState.value.pendingRecord;
  if (!record) return;

  const fields = ['type', 'amount', 'category', 'account', 'payment', 'datetime', 'note'];
  const options = fields.map(f => `「${getFieldLabel(f)}」`).join('、');

  messages.value.push({
    id: nextId++,
    role: 'ai',
    content: `请选择要修改的字段，直接输入新值：${options}`,
    render: 'text',
    status: 'success',
  });
  scrollToBottom();

  // Set editing state — next user input will be treated as field edit
  conversationState.value.editingField = null; // Will be determined by context

  // Use ElMessageBox to let user pick a field
  ElMessageBox.prompt(
    `当前值：\n类型: ${record.type}\n金额: ${record.amount}\n分类: ${record.category}\n账户: ${record.account}\n支付: ${record.payment}\n时间: ${record.datetime}\n备注: ${record.note}\n\n请输入 字段名=新值（如 category=餐饮）`,
    '修改记录',
    {
      inputPlaceholder: '字段名=新值',
      confirmButtonText: '更新',
      cancelButtonText: '取消',
    },
  ).then(({ value }) => {
    const eqIdx = value.indexOf('=');
    if (eqIdx > 0) {
      const fieldName = value.substring(0, eqIdx).trim();
      const newVal = value.substring(eqIdx + 1).trim();
      if (record.hasOwnProperty(fieldName)) {
        if (fieldName === 'amount') {
          record[fieldName] = parseFloat(newVal);
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
        scrollToBottom();
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
  scrollToBottom();
}

function sendQuick(text: string) {
  handleSend(text);
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

.text-success { color: #52c41a; }
.text-danger { color: #ff4d4f; }
</style>
