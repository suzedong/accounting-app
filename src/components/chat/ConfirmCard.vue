<template>
  <div class="confirm-card">
    <div class="card-header">{{ title || '请确认' }}</div>
    <div class="card-body">
      <!-- Regular record fields -->
      <template v-if="!isTripRecord">
        <div v-if="fields.type" class="card-field">
          <span class="label">类型</span>
          <el-tag :type="fields.type === '收入' ? 'success' : 'danger'" size="small">
            {{ fields.type }}
          </el-tag>
        </div>
        <div v-if="fields.amount" class="card-field">
          <span class="label">金额</span>
          <span class="value amount" :class="fields.type === '收入' ? 'text-success' : 'text-danger'">
            ¥{{ formatAmount(fields.amount) }}
          </span>
        </div>
        <div v-if="fields.category" class="card-field">
          <span class="label">分类</span>
          <span class="value">{{ fields.category }}</span>
        </div>
        <div v-if="fields.account" class="card-field">
          <span class="label">账户</span>
          <span class="value">{{ fields.account }}</span>
        </div>
        <div v-if="fields.payment" class="card-field">
          <span class="label">支付</span>
          <span class="value">{{ fields.payment }}</span>
        </div>
        <div v-if="fields.datetime" class="card-field">
          <span class="label">时间</span>
          <span class="value">{{ formatDateTime(fields.datetime) }}</span>
        </div>
        <div v-if="fields.note" class="card-field">
          <span class="label">备注</span>
          <span class="value">{{ fields.note }}</span>
        </div>
      </template>

      <!-- Trip record fields -->
      <template v-else>
        <div v-if="fields.trip_id" class="card-field">
          <span class="label">申请单号</span>
          <span class="value">{{ fields.trip_id }}</span>
        </div>
        <div v-if="fields.start_date" class="card-field">
          <span class="label">出发日期</span>
          <span class="value">{{ fields.start_date }}</span>
        </div>
        <div v-if="fields.end_date" class="card-field">
          <span class="label">返程日期</span>
          <span class="value">{{ fields.end_date }}</span>
        </div>
        <div v-if="fields.days" class="card-field">
          <span class="label">出差天数</span>
          <span class="value">{{ fields.days }} 天</span>
        </div>
        <div v-if="fields.trip_allowance" class="card-field">
          <span class="label">差旅补助</span>
          <span class="value">¥{{ formatAmount(fields.trip_allowance) }}（100元/天）</span>
        </div>
        <div v-if="fields.transport_allowance" class="card-field">
          <span class="label">交通补助</span>
          <span class="value">¥{{ formatAmount(fields.transport_allowance) }}（30元/天）</span>
        </div>
        <div v-if="fields.total" class="card-field">
          <span class="label">合计</span>
          <span class="value amount text-danger">¥{{ formatAmount(fields.total) }}</span>
        </div>
        <div v-if="fields.notes" class="card-field">
          <span class="label">备注</span>
          <span class="value">{{ fields.notes }}</span>
        </div>
      </template>
    </div>
    <div v-if="!readonly" class="card-actions">
      <el-button size="small" type="success" @click="$emit('confirm')">
        <el-icon><Check /></el-icon> 确认
      </el-button>
      <el-button size="small" @click="$emit('edit')">
        <el-icon><Edit /></el-icon> 修改
      </el-button>
      <el-button size="small" type="info" @click="$emit('cancel')">
        <el-icon><Close /></el-icon> 取消
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Check, Edit, Close } from '@element-plus/icons-vue';

const props = defineProps<{
  fields: Record<string, unknown>;
  title?: string;
  readonly?: boolean;
}>();

const isTripRecord = computed(() => 'trip_id' in props.fields);

defineEmits<{
  confirm: [];
  edit: [];
  cancel: [];
}>();

function formatAmount(val: unknown): string {
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? String(val) : n.toFixed(2);
}

function formatDateTime(val: unknown): string {
  if (typeof val !== 'string' || !val) return '';
  // Show date + time (first 16 chars: YYYY-MM-DD HH:mm)
  return val.length > 16 ? val.substring(0, 16) : val;
}
</script>

<style scoped>
.confirm-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  min-width: 260px;
}

.card-header {
  font-weight: 600;
  margin-bottom: 8px;
  color: #333;
  font-size: 0.95em;
}

.card-field {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 0.9em;
}

.card-field .label {
  color: #999;
}

.card-field .amount {
  font-weight: 600;
}

.card-actions {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
}

.text-success { color: #52c41a; }
.text-danger { color: #ff4d4f; }
</style>
