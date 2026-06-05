<template>
  <div class="followup-card">
    <div class="followup-question">{{ question }}</div>
    <div class="followup-fields" v-if="!readonly">
      <el-button
        v-for="field in missingFields"
        :key="field"
        size="small"
        @click="$emit('selectField', field)"
      >
        {{ fieldLabels[field] || field }}
      </el-button>
    </div>
    <div v-else class="status-text" style="color: #909399; font-size: 12px; margin-top: 8px;">
      已过期
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  question: string;
  missingFields: string[];
  readonly?: boolean;
}>();

defineEmits<{
  selectField: [field: string];
}>();

const fieldLabels: Record<string, string> = {
  amount: '金额',
  type: '类型',
  category: '分类',
  account: '账户',
  payment: '支付方式',
  datetime: '时间',
  note: '备注',
  trip_id: '申请单号',
  start_date: '出发日期',
  end_date: '返程日期',
  days: '出差天数',
};
</script>

<style scoped>
.followup-card {
  background: #fffbe6;
  border: 1px solid #ffe58f;
  border-radius: 8px;
  padding: 12px;
}

.followup-question {
  font-weight: 500;
  margin-bottom: 8px;
  color: #333;
}

.followup-fields {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>
