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
          <template v-for="msg in messages" :key="msg.id">
            <!-- User message -->
            <div v-if="msg.role === 'user'" class="message user">
              <div class="bubble">{{ msg.content }}</div>
            </div>
            <!-- AI message -->
            <div v-else class="message ai">
              <div class="bubble">
                <!-- Loading state -->
                <span v-if="msg.loading" class="loading-dots">思考中...</span>

                <!-- Text response -->
                <template v-else-if="msg.render === 'text'">
                  {{ msg.content }}
                </template>

                <!-- Card (record confirmation) -->
                <template v-else-if="msg.render === 'card' && msg.data">
                  <div class="result-card">
                    <div class="card-title">{{ msg.title || '已创建记录' }}</div>
                    <div class="card-body">
                      <div class="card-field" v-if="msg.data.datetime">
                        <span class="label">时间</span>
                        <span class="value">{{ msg.data.datetime }}</span>
                      </div>
                      <div class="card-field" v-if="msg.data.type">
                        <span class="label">类型</span>
                        <el-tag :type="msg.data.type === '收入' ? 'success' : 'danger'" size="small">
                          {{ msg.data.type }}
                        </el-tag>
                      </div>
                      <div class="card-field" v-if="msg.data.category">
                        <span class="label">分类</span>
                        <span class="value">{{ msg.data.category }}</span>
                      </div>
                      <div class="card-field" v-if="msg.data.amount">
                        <span class="label">金额</span>
                        <span class="value amount" :class="msg.data.type === '收入' ? 'text-success' : 'text-danger'">
                          ¥{{ msg.data.amount.toFixed(2) }}
                        </span>
                      </div>
                      <div class="card-field" v-if="msg.data.account">
                        <span class="label">账户</span>
                        <span class="value">{{ msg.data.account }}</span>
                      </div>
                      <div class="card-field" v-if="msg.data.note">
                        <span class="label">备注</span>
                        <span class="value">{{ msg.data.note }}</span>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- List (query records) -->
                <template v-else-if="msg.render === 'list' && msg.data">
                  <div class="result-list">
                    <div class="list-title">{{ msg.content }}</div>
                    <div v-for="r in msg.data" :key="r.id" class="list-item">
                      <span class="item-time">{{ formatShortDate(r.datetime) }}</span>
                      <span class="item-category">{{ r.category }}</span>
                      <span class="item-amount" :class="r.type === '收入' ? 'text-success' : 'text-danger'">
                        {{ r.type === '收入' ? '+' : '-' }}{{ r.amount.toFixed(2) }}
                      </span>
                    </div>
                  </div>
                </template>

                <!-- Chart (stats/budget) -->
                <template v-else-if="msg.render === 'chart' && msg.data">
                  <div class="result-chart">
                    <div class="chart-title">{{ msg.content }}</div>
                    <!-- Stats summary -->
                    <template v-if="msg.data.expense_total !== undefined">
                      <el-row :gutter="12">
                        <el-col :span="12">
                          <div class="stat-box">
                            <div class="stat-label">支出</div>
                            <div class="stat-value text-danger">¥{{ msg.data.expense_total.toFixed(2) }}</div>
                            <div class="stat-count">{{ msg.data.expense_count }} 笔</div>
                          </div>
                        </el-col>
                        <el-col :span="12">
                          <div class="stat-box">
                            <div class="stat-label">收入</div>
                            <div class="stat-value text-success">¥{{ msg.data.income_total.toFixed(2) }}</div>
                            <div class="stat-count">{{ msg.data.income_count }} 笔</div>
                          </div>
                        </el-col>
                      </el-row>
                      <div class="stat-box balance-box">
                        <div class="stat-label">结余</div>
                        <div class="stat-value" :class="msg.data.balance >= 0 ? 'text-success' : 'text-danger'">
                          ¥{{ msg.data.balance.toFixed(2) }}
                        </div>
                      </div>
                    </template>
                    <!-- Budget analysis -->
                    <template v-else-if="msg.data.budget_monthly !== undefined">
                      <div class="budget-box">
                        <el-progress :percentage="Math.min(msg.data.usage_rate, 100)" :color="budgetProgressColor(msg.data.usage_rate)" />
                        <div class="budget-details">
                          <div class="budget-row">
                            <span>预算</span><span>¥{{ msg.data.budget_monthly.toFixed(2) }}</span>
                          </div>
                          <div class="budget-row">
                            <span>已用</span><span>¥{{ msg.data.actual_expense.toFixed(2) }} ({{ msg.data.usage_rate.toFixed(1) }}%)</span>
                          </div>
                          <div class="budget-row">
                            <span>剩余</span><span :class="msg.data.remaining < 0 ? 'text-danger' : 'text-success'">¥{{ msg.data.remaining.toFixed(2) }}</span>
                          </div>
                          <div class="budget-row">
                            <span>日均</span><span>¥{{ msg.data.daily_avg.toFixed(2) }}/天</span>
                          </div>
                          <div class="budget-row">
                            <span>状态</span>
                            <el-tag :type="budgetTagType(msg.data.status)" size="small">{{ msg.data.status }}</el-tag>
                          </div>
                        </div>
                      </div>
                    </template>
                    <!-- Category stats -->
                    <template v-else-if="Array.isArray(msg.data)">
                      <div v-for="c in msg.data.slice(0, 8)" :key="c.category" class="category-row">
                        <span class="cat-name">{{ c.category }}</span>
                        <span class="cat-amount text-danger">¥{{ c.total.toFixed(2) }}</span>
                        <span class="cat-count">{{ c.count }} 笔</span>
                      </div>
                    </template>
                  </div>
                </template>

                <!-- Fallback -->
                <template v-else>
                  {{ msg.content || JSON.stringify(msg.data) }}
                </template>
              </div>
            </div>
          </template>
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
import { ref, nextTick, onMounted } from 'vue';
import { ChatDotRound, Promotion } from '@element-plus/icons-vue';
import { dispatchLLM } from '@/ai/dispatch';
import { executeAction } from '@/ai/actions';
import { getChatHistory, saveChatMessage } from '@/api/tauri';

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
const inputText = ref('');
const sending = ref(false);
const messages = ref<ChatMsg[]>([]);
const messagesRef = ref<HTMLElement | null>(null);
let nextId = 1;

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

function formatShortDate(datetime: string) {
  if (!datetime) return '';
  const parts = datetime.split(' ');
  return parts[1] ? `${parts[0]} ${parts[1].substring(0, 5)}` : parts[0];
}

function budgetProgressColor(rate: number) {
  if (rate > 100) return '#ff4d4f';
  if (rate > 80) return '#faad14';
  return '#52c41a';
}

function budgetTagType(status: string) {
  if (status === '超支') return 'danger';
  if (status === '紧张') return 'warning';
  return 'success';
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

async function sendMessage() {
  const text = inputText.value.trim();
  if (!text || sending.value) return;

  sending.value = true;
  inputText.value = '';

  // Add user message
  messages.value.push({ id: nextId++, role: 'user', content: text });
  await scrollToBottom();
  await persistMessage('user', text);

  // Add loading AI message
  const aiMsg: ChatMsg = { id: nextId++, role: 'ai', content: '', loading: true };
  messages.value.push(aiMsg);
  await scrollToBottom();

  try {
    // Call LLM dispatch
    const dispatchResult = await dispatchLLM(text);

    // Execute the action
    const actionResult = await executeAction(dispatchResult);

    // Update AI message with result
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
  max-width: 90%;
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.5;
  word-break: break-word;
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

.loading-dots {
  color: #999;
  font-style: italic;
}

/* Result card */
.result-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  min-width: 260px;
}

.card-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: #333;
}

.card-field {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 0.9em;
}

.card-field .label {
  color: #999;
}

.card-field .amount {
  font-weight: 600;
}

/* Result list */
.result-list {
  min-width: 260px;
}

.list-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.list-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 0.9em;
}

.item-time {
  color: #999;
  font-size: 0.85em;
}

.item-category {
  flex: 1;
  margin: 0 8px;
}

.item-amount {
  font-weight: 600;
}

/* Result chart */
.result-chart {
  min-width: 260px;
}

.chart-title {
  font-weight: 600;
  margin-bottom: 8px;
}

.stat-box {
  background: white;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
  margin-bottom: 8px;
}

.stat-label {
  color: #999;
  font-size: 0.85em;
}

.stat-value {
  font-size: 1.3em;
  font-weight: 600;
}

.stat-count {
  color: #999;
  font-size: 0.8em;
  margin-top: 2px;
}

.balance-box {
  margin-top: 4px;
}

/* Budget */
.budget-box {
  background: white;
  border-radius: 8px;
  padding: 12px;
}

.budget-details {
  margin-top: 8px;
}

.budget-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 0.9em;
}

/* Category rows */
.category-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background: white;
  border-radius: 4px;
  margin-bottom: 4px;
  font-size: 0.9em;
}

.cat-name {
  flex: 1;
}

.cat-amount {
  font-weight: 600;
  margin: 0 8px;
}

.cat-count {
  color: #999;
  font-size: 0.85em;
}

.text-success { color: #52c41a; }
.text-danger { color: #ff4d4f; }
</style>
