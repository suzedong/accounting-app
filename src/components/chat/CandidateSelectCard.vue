<template>
  <div class="candidate-select-card">
    <div class="card-header">{{ headerText }}</div>

    <div class="candidates-list">
      <div
        v-for="candidate in candidates"
        :key="candidate.id"
        class="candidate-item"
        @click="handleSelect(candidate.id)"
      >
        <!-- 记账候选 -->
        <template v-if="!isTrip">
          <div class="candidate-main">
            <el-tag :type="candidate.type === '收入' ? 'success' : 'danger'" size="small">
              {{ candidate.type || '支出' }}
            </el-tag>
            <span class="amount">¥{{ formatAmount(candidate.amount) }}</span>
            <span class="category">{{ candidate.category || '其他' }}</span>
          </div>
          <div class="candidate-meta">
            <span>{{ formatDateTime(candidate.datetime) }}</span>
            <span class="note">{{ candidate.note || '无备注' }}</span>
          </div>
        </template>
        <!-- 差旅候选 -->
        <template v-else>
          <div class="candidate-main">
            <el-tag size="small" type="info">{{ candidate.days || 0 }} 天</el-tag>
            <span class="amount">¥{{ formatAmount(candidate.total) }}</span>
            <span v-if="candidate._matchLabel" class="category">{{ candidate._matchLabel }}</span>
            <span v-else class="category">{{ candidate.trip_id || '无编号' }}</span>
          </div>
          <div class="candidate-meta">
            <span>{{ formatDateRange(candidate.start_date, candidate.end_date) }}</span>
            <span class="note">{{ candidate.notes || candidate.trip_id || '' }}</span>
          </div>
        </template>
        <div class="candidate-select">
          <el-icon class="select-icon"><CircleCheck /></el-icon>
        </div>
      </div>
    </div>

    <div v-if="!readonly" class="card-actions">
      <el-button size="small" type="info" @click="$emit('cancel')">
        <el-icon><Close /></el-icon> 取消
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CircleCheck, Close } from '@element-plus/icons-vue';

interface CandidateItem {
  id: number;
  // 记账
  datetime?: string;
  type?: string;
  category?: string;
  amount?: number;
  note?: string;
  // 差旅
  trip_id?: string;
  start_date?: string;
  end_date?: string;
  days?: number;
  total?: number;
  notes?: string;
  _matchLabel?: string;
  _matchType?: string;
  _domain?: string;
}

const props = defineProps<{
  candidates: CandidateItem[];
  readonly?: boolean;
  /** 'record' 或 'trip'；未传时按首个候选的字段特征推断 */
  domain?: 'record' | 'trip';
}>();

const emit = defineEmits<{
  select: [recordId: number];
  cancel: [];
}>();

const isTrip = computed(() => {
  if (props.domain === 'trip') return true;
  if (props.domain === 'record') return false;
  const first = props.candidates[0];
  if (!first) return false;
  if (first._domain === 'trip') return true;
  return 'days' in first && ('trip_id' in first || 'total' in first);
});

const headerText = computed(() => isTrip.value ? '请选择目标出差记录' : '请选择要修改的记录');

function handleSelect(recordId: number) {
  emit('select', recordId);
}

function formatAmount(val: unknown): string {
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? String(val || '0') : n.toFixed(2);
}

function formatDateTime(val: unknown): string {
  if (typeof val !== 'string' || !val) return '';
  return val.length > 19 ? val.substring(0, 19) : val;
}

function formatDateRange(start?: string, end?: string): string {
  const s = (start || '').substring(0, 10);
  const e = (end || '').substring(0, 10);
  if (!s && !e) return '';
  return `${s} ~ ${e}`;
}
</script>

<style scoped>
.candidate-select-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  min-width: 280px;
}

.card-header {
  font-weight: 600;
  margin-bottom: 10px;
  color: #333;
  font-size: 0.95em;
}

.candidates-list {
  display: grid;
  gap: 8px;
}

.candidate-item {
  display: flex;
  align-items: center;
  padding: 10px;
  border-radius: 6px;
  border: 1px solid #e4e7ed;
  cursor: pointer;
  transition: all 0.2s;
}

.candidate-item:hover {
  border-color: #667eea;
  background: #f5f7fa;
}

.candidate-main {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.amount {
  font-weight: 600;
  color: #ff4d4f;
}

.category {
  color: #6b7280;
  font-size: 13px;
}

.candidate-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  margin-right: 10px;
  font-size: 12px;
  color: #909399;
}

.note {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.candidate-select {
  color: #c0c4cc;
}

.candidate-item:hover .candidate-select {
  color: #667eea;
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
</style>
