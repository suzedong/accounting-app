<template>
  <div class="correction-card">
    <div class="card-header">{{ readonly ? '已保存' : '请确认修改（尚未保存）' }}</div>

    <div class="section-title">目标记录</div>
    <div class="record-summary">
      <div>{{ formatDateTime(targetRecord.datetime) }}</div>
      <div>
        <el-tag :type="targetRecord.type === '收入' ? 'success' : 'danger'" size="small">
          {{ targetRecord.type || '支出' }}
        </el-tag>
        <span class="amount">¥{{ formatAmount(targetRecord.amount) }}</span>
      </div>
      <div>{{ targetRecord.category || '其他' }} / {{ targetRecord.note || '无备注' }}</div>
      <div>账户：{{ targetRecord.account || '个人' }}</div>
      <div>支付方式：{{ targetRecord.payment_method || '未指定' }}</div>
    </div>

    <div class="section-title">修改内容</div>
    <div class="changes-list">
      <div v-for="change in changes" :key="change.field" class="change-row">
        <span class="change-label">{{ change.label }}</span>
        <span class="old-value">{{ formatValue(change.oldValue) }}</span>
        <span class="arrow">→</span>
        <span class="new-value">{{ formatValue(change.newValue) }}</span>
      </div>
    </div>

    <div v-if="reason" class="reason">原因：{{ reason }}</div>
    <div v-if="!readonly" class="save-hint">点击"确认修改"后才会更新账本</div>

    <div class="card-actions" v-if="!readonly">
      <el-button size="small" type="success" @click="$emit('confirm')">
        <el-icon><Check /></el-icon> 确认修改
      </el-button>
      <el-button size="small" type="info" @click="$emit('cancel')">
        <el-icon><Close /></el-icon> 取消
      </el-button>
    </div>
    <div v-else class="status-text" style="color: #909399; font-size: 12px; margin-top: 8px;">
      已过期
    </div>
  </div>
</template>

<script setup lang="ts">
interface CorrectionChange {
  field: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
}

defineProps<{
  targetRecord: Record<string, unknown>;
  changes: CorrectionChange[];
  reason?: string;
  readonly?: boolean;
}>();

defineEmits<{
  confirm: [];
  cancel: [];
}>();

function formatAmount(val: unknown): string {
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? String(val || '0') : n.toFixed(2);
}

function formatDateTime(val: unknown): string {
  if (typeof val !== 'string' || !val) return '';
  return val.length > 16 ? val.substring(0, 16) : val;
}

function formatValue(val: unknown): string {
  if (val === undefined || val === null || val === '') return '空';
  if (typeof val === 'number') return val.toFixed(2).replace(/\.00$/, '');
  return String(val);
}
</script>

<style scoped>
.correction-card {
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

.section-title {
  font-weight: 600;
  color: #606266;
  margin: 10px 0 6px;
  font-size: 13px;
}

.record-summary {
  background: #f8fafc;
  border-radius: 6px;
  padding: 8px;
  display: grid;
  gap: 4px;
  font-size: 13px;
  color: #4b5563;
}

.amount {
  margin-left: 8px;
  font-weight: 600;
  color: #ff4d4f;
}

.changes-list {
  display: grid;
  gap: 6px;
}

.change-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.change-label {
  min-width: 56px;
  color: #6b7280;
}

.old-value {
  color: #909399;
  text-decoration: line-through;
}

.arrow {
  color: #c0c4cc;
}

.new-value {
  color: #67c23a;
  font-weight: 600;
}

.reason {
  margin-top: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  background: #fff7e6;
  color: #b45309;
  font-size: 12px;
}

.save-hint {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
  color: #909399;
  font-size: 12px;
}

.card-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
</style>
