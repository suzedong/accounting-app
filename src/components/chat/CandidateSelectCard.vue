<template>
  <div class="candidate-select-card">
    <div class="card-header">请选择要修改的记录</div>

    <div class="candidates-list">
      <div
        v-for="candidate in candidates"
        :key="candidate.id"
        class="candidate-item"
        @click="handleSelect(candidate.id)"
      >
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
interface CorrectionTarget {
  id: number;
  datetime: string;
  type: string;
  category: string;
  amount: number;
  note: string;
}

defineProps<{
  candidates: CorrectionTarget[];
  readonly?: boolean;
}>();

const emit = defineEmits<{
  select: [recordId: number];
  cancel: [];
}>();

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