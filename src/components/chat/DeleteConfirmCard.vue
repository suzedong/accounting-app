<template>
  <div class="delete-card">
    <div class="card-header">{{ readonly ? '已删除' : '请确认删除（尚未执行）' }}</div>

    <div class="section-title">目标记录</div>
    <div v-if="!isTrip" class="record-summary">
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
    <div v-else class="record-summary">
      <div>出差编号：{{ targetRecord.trip_id || '（未填）' }}</div>
      <div>{{ (targetRecord.start_date as string || '').substring(0, 10) }} ~ {{ (targetRecord.end_date as string || '').substring(0, 10) }}</div>
      <div>
        <el-tag size="small" type="info">{{ targetRecord.days || 0 }} 天</el-tag>
        <span class="amount">¥{{ formatAmount(targetRecord.total) }}</span>
      </div>
      <div>备注：{{ targetRecord.notes || '无备注' }}</div>
    </div>

    <div v-if="reason" class="reason">原因：{{ reason }}</div>
    <div v-if="!readonly" class="save-hint">删除后无法恢复，点击"确认删除"才会从账本移除</div>

    <div class="card-actions" v-if="!readonly">
      <el-button size="small" type="danger" @click="$emit('confirm')">
        <el-icon><Delete /></el-icon> 确认删除
      </el-button>
      <el-button size="small" type="info" @click="$emit('cancel')">
        <el-icon><Close /></el-icon> 取消
      </el-button>
    </div>
    <div v-else class="status-text">已完成</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Delete, Close } from '@element-plus/icons-vue';

const props = defineProps<{
  targetRecord: Record<string, unknown>;
  reason?: string;
  readonly?: boolean;
  /** 'record' 或 'trip'；未传时按数据特征推断 */
  domain?: 'record' | 'trip';
}>();

defineEmits<{
  confirm: [];
  cancel: [];
}>();

const isTrip = computed(() => {
  if (props.domain === 'trip') return true;
  if (props.domain === 'record') return false;
  const rec = props.targetRecord as { _domain?: string };
  if (rec._domain === 'trip') return true;
  return 'days' in props.targetRecord && ('trip_id' in props.targetRecord || 'total' in props.targetRecord);
});

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
.delete-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  min-width: 280px;
  border: 1px solid #fecaca;
}

.card-header {
  font-weight: 600;
  margin-bottom: 10px;
  color: #dc2626;
  font-size: 0.95em;
}

.section-title {
  font-weight: 600;
  color: #606266;
  margin: 10px 0 6px;
  font-size: 13px;
}

.record-summary {
  background: #fef2f2;
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
  border-top: 1px solid #fee2e2;
  color: #dc2626;
  font-size: 12px;
}

.card-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.status-text {
  color: #909399;
  font-size: 12px;
  margin-top: 8px;
}
</style>
