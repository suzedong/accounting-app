<template>
  <div class="record-card">
    <div class="card-title">{{ title || '已创建记录' }}</div>
    <div class="card-body">
      <div v-if="record.datetime" class="card-field">
        <span class="label">时间</span>
        <span class="value">{{ record.datetime }}</span>
      </div>
      <div v-if="record.type" class="card-field">
        <span class="label">类型</span>
        <el-tag :type="record.type === '收入' ? 'success' : 'danger'" size="small">
          {{ record.type }}
        </el-tag>
      </div>
      <div v-if="record.category" class="card-field">
        <span class="label">分类</span>
        <span class="value">{{ record.category }}</span>
      </div>
      <div v-if="record.amount" class="card-field">
        <span class="label">金额</span>
        <span class="value amount" :class="record.type === '收入' ? 'text-success' : 'text-danger'">
          ¥{{ typeof record.amount === 'number' ? record.amount.toFixed(2) : record.amount }}
        </span>
      </div>
      <div v-if="record.account" class="card-field">
        <span class="label">账户</span>
        <span class="value">{{ record.account }}</span>
      </div>
      <div v-if="record.note" class="card-field">
        <span class="label">备注</span>
        <span class="value">{{ record.note }}</span>
      </div>
      <div class="card-field">
        <span class="label">支付方式</span>
        <span class="value">{{ record.payment_method || '未指定' }}</span>
      </div>
    </div>
    <div v-if="showActions" class="card-actions">
      <el-button size="small" @click="$emit('correct')">
        <el-icon><Edit /></el-icon> 修正
      </el-button>
      <el-button size="small" type="danger" @click="$emit('delete')">
        <el-icon><Delete /></el-icon> 删除
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Edit, Delete } from '@element-plus/icons-vue';

defineProps<{
  record: Record<string, unknown>;
  title?: string;
  showActions?: boolean;
}>();

defineEmits<{
  correct: [];
  delete: [];
}>();
</script>

<style scoped>
.record-card {
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

.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
}

.text-success { color: #52c41a; }
.text-danger { color: #ff4d4f; }
</style>
