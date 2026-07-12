<template>
  <el-card class="account-card" :style="{ '--accent': color }">
    <template #header>
      <div class="card-header">
        <span class="card-title">
          <span class="dot" :style="{ background: color }" />
          {{ title }}
        </span>
        <span class="card-count">{{ summary.expense_count }} 笔</span>
      </div>
    </template>

    <div class="amount-row">
      <div class="amount" :style="{ color }">{{ formatMoney(summary.expense_total) }}</div>
      <div class="share">占总支出 {{ share.toFixed(1) }}%</div>
    </div>

    <div class="mom-row">
      <span class="mom" :class="momClass">{{ momLabel }}</span>
      <span class="prev-hint">上月 {{ formatMoney(prevTotal) }}</span>
    </div>

    <el-divider style="margin: 12px 0" />

    <div class="category-title">分类排行 · Top 5</div>
    <div v-if="topCategories.length" class="category-list">
      <div v-for="c in topCategories" :key="c.category" class="category-item">
        <div class="category-header">
          <span class="cat-name">{{ c.category || '未分类' }}</span>
          <span class="cat-amount">{{ formatMoney(c.total) }}</span>
        </div>
        <div class="bar-track">
          <div
            class="bar-fill"
            :style="{
              width: `${(c.total / maxCategoryTotal) * 100}%`,
              background: color,
            }"
          />
        </div>
        <div class="category-footer">
          <span>{{ c.count }} 笔</span>
          <span>{{ pctOfTotal(c.total) }}%</span>
        </div>
      </div>
    </div>
    <el-empty v-else description="本月暂无支出" :image-size="60" />
  </el-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatMoney } from '@/utils/formatters';
import type { StatsSummary, CategoryStat } from '@/types';

const props = defineProps<{
  title: string;
  color: string;
  summary: StatsSummary;
  prevTotal: number;
  share: number;
  categories: CategoryStat[];
}>();

const topCategories = computed(() => props.categories.slice(0, 5));

const maxCategoryTotal = computed(
  () => topCategories.value.reduce((max, c) => Math.max(max, c.total), 0) || 1,
);

function pctOfTotal(v: number): string {
  const total = props.summary.expense_total;
  if (total <= 0) return '0.0';
  return ((v / total) * 100).toFixed(1);
}

const momChange = computed<number | null>(() => {
  const cur = props.summary.expense_total;
  const prev = props.prevTotal;
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / Math.abs(prev)) * 100;
});

const momLabel = computed(() => {
  const v = momChange.value;
  if (v === null) return '上月无支出';
  const arrow = v > 0 ? '↑' : v < 0 ? '↓' : '→';
  return `环比 ${arrow} ${Math.abs(v).toFixed(1)}%`;
});

const momClass = computed(() => {
  const v = momChange.value;
  if (v === null || v === 0) return 'mom-neutral';
  // 支出场景：涨=坏（红），跌=好（绿）
  return v < 0 ? 'mom-good' : 'mom-bad';
});
</script>

<style scoped>
.account-card {
  border-top: 3px solid var(--accent);
  height: 100%;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}

.card-count {
  color: #999;
  font-size: 0.85em;
}

.amount-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.amount {
  font-size: 2em;
  font-weight: bold;
  line-height: 1.1;
}

.share {
  color: #666;
  font-size: 0.9em;
}

.mom-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  font-size: 0.9em;
}

.mom-good { color: #52c41a; }
.mom-bad { color: #ff4d4f; }
.mom-neutral { color: #999; }

.prev-hint {
  color: #999;
}

.category-title {
  color: #666;
  font-size: 0.9em;
  margin-bottom: 10px;
  font-weight: 500;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.category-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.category-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.95em;
}

.cat-name {
  color: #333;
  font-weight: 500;
}

.cat-amount {
  color: #333;
  font-weight: 600;
}

.bar-track {
  height: 6px;
  background: #f0f2f5;
  border-radius: 3px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}

.category-footer {
  display: flex;
  justify-content: space-between;
  color: #999;
  font-size: 0.8em;
}
</style>
