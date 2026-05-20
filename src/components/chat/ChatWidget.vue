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
          <div class="message ai">
            <div class="bubble">你好！我是 AI 记账助手。请告诉我你的消费或收入。</div>
          </div>
        </div>
        <div class="input-area">
          <el-input
            v-model="inputText"
            placeholder="输入消费或收入..."
            @keyup.enter="sendMessage"
            resize="none"
            :autosize="{ minRows: 1, maxRows: 4 }"
          >
            <template #append>
              <el-button @click="sendMessage" :loading="sending">
                <el-icon><Promotion /></el-icon>
              </el-button>
            </template>
          </el-input>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ChatDotRound, Promotion } from '@element-plus/icons-vue';

const isOpen = ref(false);
const inputText = ref('');
const sending = ref(false);
const messagesRef = ref<HTMLElement | null>(null);

async function sendMessage() {
  if (!inputText.value.trim()) return;
  sending.value = true;
  try {
    // Phase 3: implement AI dispatch + execute
    console.log('Send message:', inputText.value);
  } finally {
    inputText.value = '';
    sending.value = false;
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

.message {
  margin-bottom: 16px;
  display: flex;
}

.message.ai {
  justify-content: flex-start;
}

.message.user {
  justify-content: flex-end;
}

.bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.5;
}

.message.ai .bubble {
  background: #f0f2f5;
  color: #333;
}

.message.user .bubble {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.input-area {
  padding: 12px 16px;
  border-top: 1px solid #ebeef5;
}
</style>
