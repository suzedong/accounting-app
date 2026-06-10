<template>
  <div class="chat-widget">
    <!-- Floating button -->
    <el-button
      v-if="!isOpen"
      class="chat-fab"
      circle
      size="large"
      @click="handleFabClick"
    >
      <el-icon :size="24"><ChatDotRound /></el-icon>
    </el-button>

    <!-- Chat panel -->
    <teleport to="body">
    <div v-if="isOpen" class="chat-overlay" @click.self="closeDrawer">
      <div class="chat-panel" :class="{ 'chat-panel-open': isOpen }">
        <div class="chat-panel-header">
          <span class="drawer-title">AI 对话</span>
          <div class="drawer-actions">
            <el-button size="small" text @click="openDevConsole" title="开发者控制台">
              <el-icon><Monitor /></el-icon>
            </el-button>
            <el-button size="small" text @click="openSettingsDialog" title="设置">
              <el-icon><Setting /></el-icon>
            </el-button>
            <el-button size="small" text @click="handleClearHistory" title="清空对话">
              <el-icon><Delete /></el-icon>
            </el-button>
            <el-button size="small" text @click="closeDrawer" title="关闭">
              <el-icon><Close /></el-icon>
            </el-button>
          </div>
        </div>

        <div class="chat-container">
          <div class="chat-scroll">
            <div class="messages" ref="messagesRef">
              <!-- Welcome page -->
              <div v-if="messages.length === 0" class="welcome">
                <div class="welcome-icon">
                  <el-icon :size="40"><ChatDotRound /></el-icon>
                </div>
                <div class="welcome-title">你好！我是你的 AI 记账助手</div>
                <div class="welcome-sub">告诉我你的收支情况，我会帮你记录</div>
                <div class="quick-actions">
                  <el-button size="small" @click="sendQuick('今天中午吃饭花了35元')">今天吃饭35元</el-button>
                  <el-button size="small" @click="sendQuick('收入5000工资')">工资收入5000</el-button>
                  <el-button size="small" @click="sendQuick('昨天打车25支付宝')">昨天打车25</el-button>
                </div>
              </div>

              <!-- Messages -->
              <template v-for="msg in messages" :key="msg.id">
                <!-- User message -->
                <div v-if="msg.role === 'user'" class="message user">
                  <div class="message-bubble user-bubble">
                    <img v-if="msg.imageSrc" :src="msg.imageSrc" class="message-image" />
                    <span>{{ msg.content }}</span>
                  </div>
                </div>

                <!-- AI message -->
                <div v-else class="message ai">
                  <div class="message-bubble ai-bubble">
                    <!-- 思考中（loading 状态） -->
                    <div v-if="msg.loading" class="thinking-indicator">
                      <span class="spinner">⟳</span>
                      <span>{{ currentStepLabel(msg.steps) }}...</span>
                    </div>

                    <!-- 思考过程（有 steps 时显示，可折叠） -->
                    <div v-else-if="msg.steps?.length" class="thinking-section">
                      <div class="thinking-header" @click="toggleThinking(msg.id)">
                        <el-icon class="thinking-chevron" :class="{ rotated: thinkingExpanded[msg.id] }">
                          <ArrowDown />
                        </el-icon>
                        <span class="thinking-label">{{ formatThinkingLabel(msg.steps) }}</span>
                      </div>
                      <div v-show="thinkingExpanded[msg.id]" class="thinking-body">
                        <StepList :steps="msg.steps" />
                      </div>
                    </div>

                    <!-- 最终回复文本 -->
                    <p v-if="msg.content" class="ai-text">{{ msg.content }}</p>

                    <!-- 已取消标记 -->
                    <div v-if="msg.status === 'cancelled'" class="status-tag cancelled">
                      <el-icon><CircleClose /></el-icon> 已取消
                    </div>

                    <!-- Confirmation card -->
                    <div v-if="msg.data && msg.render !== 'correctionCard'" class="thinking-section">
                      <div class="thinking-header" @click="toggleCardExpand(msg.id)">
                        <el-icon class="thinking-chevron" :class="{ rotated: cardExpanded[msg.id] !== false }">
                          <ArrowDown />
                        </el-icon>
                        <span class="thinking-label">
                          {{ getCardStatusLabel(msg) }}
                        </span>
                      </div>
                      <div v-show="cardExpanded[msg.id] !== false" class="thinking-body">
                        <ConfirmCard
                          :fields="msg.data"
                          :readonly="msg.status !== 'pending'"
                          @confirm="handleCardAction(msg, 'confirm')"
                          @cancel="handleCardAction(msg, 'cancel')"
                          @save="handleCardSave(msg, $event)"
                        />
                      </div>
                    </div>

                    <!-- Correction confirmation card -->
                    <CorrectionConfirmCard
                      v-if="msg.data && msg.render === 'correctionCard'"
                      :readonly="msg.status !== 'pending'"
                      :target-record="(msg.data as Record<string, unknown>).targetRecord as Record<string, unknown> || {}"
                      :changes="(msg.data as Record<string, unknown>).changes as Array<{ field: string; label: string; oldValue: unknown; newValue: unknown }> || []"
                      :reason="(msg.data as Record<string, unknown>).reason as string || ''"
                      @confirm="handleCardAction(msg, 'confirm')"
                      @cancel="handleCardAction(msg, 'cancel')"
                    />

                    <!-- Follow-up card -->
                    <FollowUpCard
                      v-if="msg.render === 'followUp' && msg.data"
                      :readonly="msg.status !== 'pending'"
                      :question="(msg.data as Record<string, unknown>).question as string || ''"
                      :missing-fields="(msg.data as Record<string, unknown>).missingFields as string[] || []"
                      @select-field="handleFollowUpSelect(msg, $event)"
                    />
                  </div>
                </div>
              </template>
            </div>

            <!-- Chat input -->
            <ChatInput
              v-model:sending="sending"
              v-model:ocr-loading="ocrLoading"
              @send="onSend"
            />
          </div>
        </div>
      </div>
    </div>
    </teleport>

    <!-- Settings dialog -->
    <el-dialog v-model="showSettingsDialog" title="设置" width="600px" class="settings-dialog">
      <SettingsPanel
        :prompt-content="promptContent"
        :preferences-content="preferencesContent"
        :learning-data="learningData"
        :saving="promptSaving"
        @close="showSettingsDialog = false"
        @save="handleSaveRule"
        @clear-learning="handleClearLearning"
        @refresh-prompt="handleRefreshPrompt"
        @refresh-preferences="handleRefreshPreferences"
        @refresh-learning="handleRefreshLearning"
      />
      <template #footer>
        <el-button size="small" text @click="openSettingsDialog">刷新</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, watch, reactive } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ChatDotRound, Close, Delete, Setting, Monitor, ArrowDown, CircleClose } from '@element-plus/icons-vue';
import { storeToRefs } from 'pinia';
import ChatInput from './ChatInput.vue';
import ConfirmCard from './ConfirmCard.vue';
import CorrectionConfirmCard from './CorrectionConfirmCard.vue';
import FollowUpCard from './FollowUpCard.vue';
import StepList from './StepList.vue';
import SettingsPanel from './SettingsPanel.vue';
import { useChatStore } from '@/stores/chat';
import { getSystemPrompt, getLearningCorrections, updateSystemPrompt, deleteCorrection, clearCorrections } from '@/api/tauri';
import type { Step } from '@/types/chat';

const chat = useChatStore();
const { messages, isOpen, sending, ocrLoading } = storeToRefs(chat);
const messagesRef = ref<HTMLElement | null>(null);

// 思考过程折叠状态
const thinkingExpanded = reactive<Record<number, boolean>>({});
// 卡片折叠状态
const cardExpanded = reactive<Record<number, boolean>>({});

function toggleThinking(msgId: number) {
  thinkingExpanded[msgId] = !thinkingExpanded[msgId];
}

function toggleCardExpand(msgId: number) {
  // 默认展开，点击后折叠；再次点击展开
  cardExpanded[msgId] = cardExpanded[msgId] === undefined ? false : !cardExpanded[msgId];
}

function getCardStatusLabel(msg: { status?: string }): string {
  if (msg.status === 'cancelled') return '已取消';
  // 已确认的记录在加载历史时 status 为 'success'
  if (msg.status === 'confirmed' || msg.status === 'success') return '已保存';
  return '记录详情';
}

function formatThinkingLabel(steps: Step[]): string {
  const completed = steps.filter(s => s.status === 'success');
  if (completed.length === 0) return '思考过程';
  // 显示所有步骤标题，用 · 分隔
  return steps.map(s => s.title).join(' · ');
}

function currentStepLabel(steps: Step[] | undefined): string {
  if (!steps) return '处理中';
  const running = steps.find(s => s.status === 'running');
  return running ? running.title : '处理中';
}

// 兜底：isOpen 被外部设为 false 时恢复滚动
watch(isOpen, (val) => {
  if (!val) document.body.style.overflow = '';
});

function handleFabClick() {
  isOpen.value = true;
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  isOpen.value = false;
  document.body.style.overflow = '';
}

// Settings dialog state
const showSettingsDialog = ref(false);
let rulesDataLoaded = false;
const promptContent = ref('');
const preferencesContent = ref('');
const promptSaving = ref(false);
const learningData = ref<Array<{ id: number; keyword: string; field: string; value: string }>>([]);

onMounted(async () => {
  await chat.loadHistory(50);
});

// 监听消息变化，自动滚动到底部
watch(messages, async () => {
  await scrollToBottom();
}, { deep: true });

async function scrollToBottom() {
  // 等待 DOM 更新
  await nextTick();
  
  // 尝试多次滚动，确保滚动到底部
  const maxAttempts = 5;
  const delay = 50; // 每次尝试间隔 50ms
  
  for (let i = 0; i < maxAttempts; i++) {
    if (messagesRef.value) {
      messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
      // 检查是否已经滚动到底部
      const isAtBottom = messagesRef.value.scrollHeight - messagesRef.value.scrollTop <= messagesRef.value.clientHeight + 10;
      if (isAtBottom) {
        break;
      }
    }
    // 等待一段时间后重试
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

async function onSend(text: string, imageBase64?: string, imageFullSrc?: string) {
  // If in field editing mode
  if (chat.editingField) {
    chat.applyFieldEdit(text);
    messages.value.push({
      id: chat.genId(),
      role: 'ai',
      content: '已更新字段',
      render: 'text',
      status: 'success',
    });
    await scrollToBottom();
    return;
  }

  // If in follow-up mode
  if (chat.awaitingFollowUp) {
    await chat.answerFollowUp(text, messagesRef.value);
    return;
  }

  // Normal flow
  await chat.sendMessage(text, messagesRef.value, imageBase64, imageFullSrc);
}

function sendQuick(text: string) {
  chat.sendMessage(text, messagesRef.value);
}

async function handleCardAction(msg: typeof messages.value[0], action: 'confirm' | 'cancel') {
  if (action === 'confirm') {
    await chat.confirmRecord(msg);
  } else if (action === 'cancel') {
    await chat.cancelRecord(msg);
  }
}

async function handleCardSave(msg: typeof messages.value[0], editedFields: Record<string, unknown>) {
  // Merge edited fields into the message data and confirm
  msg.data = { ...msg.data, ...editedFields };
  // Update pendingRecord to match
  chat.pendingRecord = { ...editedFields };
  await chat.confirmRecord(msg);
}

function handleFollowUpSelect(_msg: typeof messages.value[0], field: string) {
  chat.startEditField(field);
}

function openDevConsole() {
  window.dispatchEvent(new CustomEvent('dev-console-toggle'));
}

async function openSettingsDialog() {
  showSettingsDialog.value = true;
  if (!rulesDataLoaded) {
    await Promise.all([
      handleRefreshPrompt(),
      handleRefreshPreferences(),
      handleRefreshLearning(),
    ]);
    rulesDataLoaded = true;
  }
}

async function handleRefreshPrompt() {
  try {
    const res = await getSystemPrompt('dispatch');
    promptContent.value = res.data.content;
  } catch { /* ignore */ }
}

async function handleRefreshPreferences() {
  try {
    const res = await getSystemPrompt('preferences');
    preferencesContent.value = res.data.content;
  } catch {
    preferencesContent.value = '';
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
      await updateSystemPrompt('dispatch', content);
      ElMessage.success('Dispatch Prompt 已保存');
    } else if (type === 'preferences') {
      await updateSystemPrompt('preferences', content);
      ElMessage.success('用户偏好已保存');
    } else if (type === 'deleteLearning') {
      const entry = JSON.parse(content);
      const match = learningData.value.find(l =>
        l.keyword === entry.keyword && l.field === entry.field && l.value === entry.value,
      );
      if (match) {
        await deleteCorrection(match.id);
        learningData.value = learningData.value.filter(l => l.id !== match.id);
        ElMessage.success('已删除');
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
    await ElMessageBox.confirm('确定清空所有学习数据？', '确认', { type: 'warning' });
    await clearCorrections();
    learningData.value = [];
    ElMessage.success('学习数据已清空');
  } catch {
    // User cancelled
  }
}

async function handleClearHistory() {
  try {
    await ElMessageBox.confirm('确定清空对话历史？', '确认', { type: 'warning' });
    await chat.clearHistory();
    ElMessage.success('对话历史已清空');
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
  z-index: 2001;
  width: 56px;
  height: 56px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  border: none !important;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4) !important;
}

.chat-fab :deep(.el-icon) {
  color: white;
}

/* Overlay */
.chat-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.3);
  z-index: 2001;
  display: flex;
  justify-content: flex-end;
  align-items: stretch;
}

.chat-panel {
  width: 420px;
  max-width: 90vw;
  height: 100vh;
  background: #fff;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  transform: translateX(100%);
  transition: transform 0.3s ease;
}

.chat-panel-open {
  transform: translateX(0);
}

.chat-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 14px 20px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}

.drawer-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.drawer-actions {
  display: flex;
  gap: 4px;
}

.drawer-actions :deep(.el-button) {
  color: #909399;
}

.drawer-actions :deep(.el-button:hover) {
  color: #667eea;
  background: #f5f5f5;
}

.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
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
  padding: 32px 20px 20px;
  text-align: center;
  background: linear-gradient(180deg, #f5f7ff 0%, transparent 100%);
  border-radius: 12px;
  margin: 8px;
}

.welcome-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
}

.welcome-icon :deep(.el-icon) {
  color: white;
}

.welcome-title {
  font-size: 1.1em;
  font-weight: 600;
  color: #333;
  margin-bottom: 4px;
}

.welcome-sub {
  color: #999;
  font-size: 0.85em;
  margin-bottom: 16px;
}

.quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}

.quick-actions :deep(.el-button) {
  border-radius: 16px;
  font-size: 0.85em;
}

/* Messages */
.message {
  margin-bottom: 12px;
}

.message.user {
  display: flex;
  justify-content: flex-end;
}

.message-bubble {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
}

.user-bubble {
  background: #667eea;
  color: white;
  border-bottom-right-radius: 4px;
}

.user-bubble .message-image {
  max-width: 100%;
  border-radius: 8px;
  margin-bottom: 4px;
}

.ai-bubble {
  background: #f5f5f5;
  color: #333;
  border-bottom-left-radius: 4px;
}

.ai-text {
  margin: 4px 0 0;
}

.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  margin-top: 8px;

  &.cancelled {
    background: #f5f5f5;
    color: #909399;
  }
}

/* Thinking indicator (loading state) */
.thinking-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #909399;
  font-size: 13px;
  padding: 4px 0;
}

.spinner {
  animation: spin 1s linear infinite;
  display: inline-block;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Thinking section (collapsed/expandable) */
.thinking-section {
  background: #ededed;
  border-radius: 8px;
  margin: 4px 0;
  overflow: hidden;
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
  color: #8c8c8c;
  transition: background 0.15s;
}

.thinking-header:hover {
  background: rgba(0, 0, 0, 0.04);
}

.thinking-chevron {
  font-size: 12px;
  transition: transform 0.2s;
  flex-shrink: 0;
}

.thinking-chevron.rotated {
  transform: rotate(180deg);
}

.thinking-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thinking-body {
  padding: 0 4px 8px;
}

.settings-dialog :deep(.el-dialog__body) {
  padding: 0;
}
</style>
