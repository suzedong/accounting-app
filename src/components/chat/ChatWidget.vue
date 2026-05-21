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
          <ChatMessage
            v-for="msg in messages"
            :key="msg.id"
            :role="msg.role"
            :content="msg.content"
            :data="msg.data"
            :render="msg.render"
            :title="msg.title"
            :loading="msg.loading"
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
  data?: any;
  render?: string;
  title?: string;
  loading?: boolean;
}

const isOpen = ref(false);
const sending = ref(false);
const ocrLoading = ref(false);
const messages = ref<ChatMsg[]>([]);
const messagesRef = ref<HTMLElement | null>(null);
let nextId = 1;

const { recognize } = useOCR();

onMounted(async () => {
  try {
    const res = await getChatHistory(50);
    for (const m of res.data.reverse()) {
      messages.value.push({
        id: nextId++,
        role: m.role as 'user' | 'ai',
        content: m.content || '',
        data: m.data ? JSON.parse(m.data) : undefined,
        render: 'text',
      });
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

async function persistMessage(role: 'user' | 'ai', content: string, data?: unknown) {
  try {
    await saveChatMessage(
      role,
      content,
      data ? JSON.stringify(data) : null,
      null,
      null,
    );
  } catch {
    // Ignore persistence errors
  }
}

async function handleSend(text: string, imageBase64?: string) {
  // If image is provided, try OCR first
  let inputText = text;
  if (imageBase64) {
    ocrLoading.value = true;
    try {
      const ocrText = await recognize(imageBase64);
      if (ocrText.trim()) {
        // Combine OCR text with user text
        inputText = text ? `${text} ${ocrText.trim()}` : ocrText.trim();
      }
    } catch {
      // If OCR fails, just use the user's text
    } finally {
      ocrLoading.value = false;
    }
  }

  if (!inputText || sending.value) return;

  sending.value = true;

  // Add user message
  messages.value.push({ id: nextId++, role: 'user', content: inputText });
  await scrollToBottom();
  await persistMessage('user', inputText);

  // Add loading AI message
  const aiMsg: ChatMsg = { id: nextId++, role: 'ai', content: '', loading: true };
  messages.value.push(aiMsg);
  await scrollToBottom();

  try {
    const dispatchResult = await dispatchLLM(inputText);
    const actionResult = await executeAction(dispatchResult);

    aiMsg.loading = false;
    aiMsg.render = actionResult.render;
    aiMsg.content = actionResult.message;
    aiMsg.data = actionResult.data;
    aiMsg.title = dispatchResult.title;

    await persistMessage('ai', actionResult.message, actionResult.data);
  } catch (e: unknown) {
    aiMsg.loading = false;
    aiMsg.content = e instanceof Error ? e.message : '未知错误';
    aiMsg.render = 'text';
    await persistMessage('ai', aiMsg.content);
  } finally {
    sending.value = false;
    await scrollToBottom();
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

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.text-success { color: #52c41a; }
.text-danger { color: #ff4d4f; }
</style>
