<template>
  <div class="home-page">
    <div class="page-header">
      <h2>首页</h2>
      <p class="subtitle">AI 记账 - 智能记账，轻松管理财务</p>
    </div>

    <el-row :gutter="20" class="stats-row">
      <el-col :span="8">
        <el-card class="stat-card expense">
          <template #header>本月支出</template>
          <div class="value">{{ formatMoney(stats.expense_total || 0) }}</div>
          <div class="count">{{ stats.expense_count || 0 }} 笔</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="stat-card income">
          <template #header>本月收入</template>
          <div class="value">{{ formatMoney(stats.income_total || 0) }}</div>
          <div class="count">{{ stats.income_count || 0 }} 笔</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="stat-card balance">
          <template #header>本月结余</template>
          <div class="value">{{ formatMoney(stats.balance || 0) }}</div>
          <div class="count">本月</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="chart-card" v-loading="loading">
      <template #header>类别分析</template>
      <el-row :gutter="16">
        <el-col v-for="c in categories" :key="c.category" :span="6">
          <div class="category-item">
            <div class="name">{{ c.category }}</div>
            <div class="amount text-danger">{{ formatMoney(c.total) }}</div>
            <div class="count">{{ c.count }} 笔</div>
          </div>
        </el-col>
      </el-row>
      <el-empty v-if="categories.length === 0" description="暂无数据" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getStatsSummary, getStatsByCategory } from '@/api/tauri';
import { formatMoney } from '@/utils/formatters';
import { getDateRange } from '@/utils/dateRange';

const stats = ref({ expense_total: 0, expense_count: 0, income_total: 0, income_count: 0, balance: 0 });
const categories = ref<any[]>([]);
const loading = ref(false);

onMounted(async () => {
  const { dateFrom } = getDateRange('month');
  try {
    stats.value = await getStatsSummary(dateFrom);
    categories.value = await getStatsByCategory(dateFrom, '支出');
  } catch (e) {
    console.error('Failed to load stats', e);
  }
});
</script>

<style scoped>
.page-header {
  margin-bottom: 20px;
}

.page-header h2 {
  font-size: 1.5em;
  color: #333;
}

.subtitle {
  color: #666;
  margin-top: 4px;
}

.stats-row {
  margin-bottom: 20px;
}

.stat-card .value {
  font-size: 2em;
  font-weight: bold;
}

.stat-card .count {
  color: #999;
  font-size: 0.9em;
  margin-top: 4px;
}

.stat-card.expense { border-left: 4px solid #ff6b6b; }
.stat-card.income { border-left: 4px solid #52c41a; }
.stat-card.balance { border-left: 4px solid #1890ff; }

.chart-card {
  margin-bottom: 20px;
}

.category-item {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  text-align: center;
}

.category-item .name {
  font-weight: 500;
  margin-bottom: 8px;
}

.category-item .amount {
  font-size: 1.2em;
  font-weight: bold;
}

.category-item .count {
  color: #999;
  font-size: 0.85em;
}

.text-danger { color: #ff4d4f; }
</style>
