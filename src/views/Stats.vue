<template>
  <div class="stats-page">
    <h2>统计分析</h2>

    <el-row :gutter="20">
      <el-col :span="12">
        <el-card>
          <template #header>按分类（支出）</template>
          <CategoryBarChart v-if="categoryData.length" :data="categoryData" type="支出" />
          <el-empty v-else description="暂无数据" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>按账户</template>
          <AccountPieChart v-if="accountData.length" :data="accountData" />
          <el-empty v-else description="暂无数据" />
        </el-card>
      </el-col>
    </el-row>

    <el-card style="margin-top: 20px">
      <template #header>月度趋势</template>
      <MonthlyTrendChart v-if="trendData.length" :data="trendData" />
      <el-empty v-else description="暂无数据" />
    </el-card>

    <el-card style="margin-top: 20px">
      <template #header>本月 vs 上月对比</template>
      <ComparisonChart
        v-if="comparison"
        :current="comparison.current"
        :previous="comparison.previous"
      />
      <el-empty v-else description="暂无数据" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getStatsByCategory, getStatsByAccount, getMonthlyTrend, getComparison } from '@/api/tauri';
import { getDateRange } from '@/utils/dateRange';
import CategoryBarChart from '@/components/stats/CategoryBarChart.vue';
import AccountPieChart from '@/components/stats/AccountPieChart.vue';
import MonthlyTrendChart from '@/components/stats/MonthlyTrendChart.vue';
import ComparisonChart from '@/components/stats/ComparisonChart.vue';

const categoryData = ref<any[]>([]);
const accountData = ref<any[]>([]);
const trendData = ref<any[]>([]);
const comparison = ref<any>(null);

onMounted(async () => {
  const { dateFrom } = getDateRange('month');
  try {
    categoryData.value = await getStatsByCategory(dateFrom, '支出');
    accountData.value = await getStatsByAccount(dateFrom);
    trendData.value = await getMonthlyTrend(6);
    comparison.value = await getComparison();
  } catch (e) {
    console.error('Failed to load stats', e);
  }
});
</script>

<style scoped>
.stats-page { max-width: 100%; }
h2 { font-size: 1.5em; margin-bottom: 20px; color: #333; }
</style>
