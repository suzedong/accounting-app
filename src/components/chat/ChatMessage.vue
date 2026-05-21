<template>
  <div class="message" :class="role">
    <div class="bubble">
      <!-- User message -->
      <template v-if="role === 'user'">
        {{ content }}
      </template>

      <!-- AI message -->
      <template v-else>
        <!-- Loading state -->
        <ChatThinking v-if="loading" text="思考中..." />

        <!-- Text response -->
        <template v-else-if="render === 'text'">
          {{ content }}
        </template>

        <!-- Card (record confirmation) -->
        <template v-else-if="render === 'card' && data">
          <ConfirmCard
            :fields="data"
            :title="title || '我帮你整理了一下，请确认：'"
            :readonly="status === 'confirmed' || status === 'cancelled'"
            @confirm="$emit('cardAction', 'confirm')"
            @edit="$emit('cardAction', 'edit')"
            @cancel="$emit('cardAction', 'cancel')"
          />
        </template>

        <!-- Follow-up (missing fields) -->
        <template v-else-if="render === 'followUp' && data">
          <FollowUpCard
            :question="content"
            :missing-fields="data.missingFields || []"
            @select-field="$emit('followUpSelect', $event)"
          />
        </template>

        <!-- List (query records) -->
        <template v-else-if="render === 'list' && data">
          <div class="result-list">
            <div class="list-title">{{ content }}</div>
            <div v-for="r in data" :key="r.id" class="list-item">
              <span class="item-time">{{ formatShortDate(r.datetime) }}</span>
              <span class="item-category">{{ r.category }}</span>
              <span class="item-amount" :class="r.type === '收入' ? 'text-success' : 'text-danger'">
                {{ r.type === '收入' ? '+' : '-' }}{{ r.amount.toFixed(2) }}
              </span>
            </div>
          </div>
        </template>

        <!-- Chart (stats/budget) -->
        <template v-else-if="render === 'chart' && data">
          <div class="result-chart">
            <div class="chart-title">{{ content }}</div>

            <!-- Stats summary -->
            <template v-if="data.expense_total !== undefined">
              <el-row :gutter="12">
                <el-col :span="12">
                  <div class="stat-box">
                    <div class="stat-label">支出</div>
                    <div class="stat-value text-danger">¥{{ data.expense_total.toFixed(2) }}</div>
                    <div class="stat-count">{{ data.expense_count }} 笔</div>
                  </div>
                </el-col>
                <el-col :span="12">
                  <div class="stat-box">
                    <div class="stat-label">收入</div>
                    <div class="stat-value text-success">¥{{ data.income_total.toFixed(2) }}</div>
                    <div class="stat-count">{{ data.income_count }} 笔</div>
                  </div>
                </el-col>
              </el-row>
              <div class="stat-box balance-box">
                <div class="stat-label">结余</div>
                <div class="stat-value" :class="data.balance >= 0 ? 'text-success' : 'text-danger'">
                  ¥{{ data.balance.toFixed(2) }}
                </div>
              </div>
            </template>

            <!-- Budget analysis -->
            <template v-else-if="data.budget_monthly !== undefined">
              <div class="budget-box">
                <el-progress :percentage="Math.min(data.usage_rate, 100)" :color="budgetProgressColor(data.usage_rate)" />
                <div class="budget-details">
                  <div class="budget-row">
                    <span>预算</span><span>¥{{ data.budget_monthly.toFixed(2) }}</span>
                  </div>
                  <div class="budget-row">
                    <span>已用</span><span>¥{{ data.actual_expense.toFixed(2) }} ({{ data.usage_rate.toFixed(1) }}%)</span>
                  </div>
                  <div class="budget-row">
                    <span>剩余</span><span :class="data.remaining < 0 ? 'text-danger' : 'text-success'">¥{{ data.remaining.toFixed(2) }}</span>
                  </div>
                  <div class="budget-row">
                    <span>日均</span><span>¥{{ data.daily_avg.toFixed(2) }}/天</span>
                  </div>
                  <div class="budget-row">
                    <span>状态</span>
                    <el-tag :type="budgetTagType(data.status)" size="small">{{ data.status }}</el-tag>
                  </div>
                </div>
              </div>
            </template>

            <!-- Category stats (array) -->
            <template v-else-if="Array.isArray(data)">
              <div v-for="c in data.slice(0, 8)" :key="c.category" class="category-row">
                <span class="cat-name">{{ c.category }}</span>
                <span class="cat-amount text-danger">¥{{ c.total.toFixed(2) }}</span>
                <span class="cat-count">{{ c.count }} 笔</span>
              </div>
            </template>
          </div>
        </template>

        <!-- Fallback -->
        <template v-else>
          {{ content || JSON.stringify(data) }}
        </template>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import ChatThinking from './ChatThinking.vue';
import ConfirmCard from './ConfirmCard.vue';
import FollowUpCard from './FollowUpCard.vue';

defineProps<{
  role: 'user' | 'ai';
  content: string;
  data?: any;
  render?: string;
  title?: string;
  loading?: boolean;
  status?: string;
}>();

defineEmits<{
  cardAction: [action: 'confirm' | 'edit' | 'cancel'];
  followUpSelect: [field: string];
}>();

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
</script>

<style scoped>
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
