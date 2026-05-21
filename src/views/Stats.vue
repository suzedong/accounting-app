<template>
  <div class="stats-page">
    <!-- 周期选择器 -->
    <div class="period-selector">
      <span class="period-label">统计周期：</span>
      <el-button-group>
        <el-button
          v-for="p in periods"
          :key="p.value"
          :type="period === p.value ? 'primary' : 'default'"
          size="small"
          @click="setPeriod(p.value)"
        >
          {{ p.label }}
        </el-button>
      </el-button-group>
    </div>

    <!-- 汇总卡片 -->
    <el-row :gutter="20" class="stats-row">
      <el-col :span="8">
        <el-card class="stat-card expense">
          <template #header>总支出</template>
          <div class="value text-danger">{{ formatMoney(summary.expense_total || 0) }}</div>
          <div class="count">{{ summary.expense_count || 0 }} 笔</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="stat-card income">
          <template #header>总收入</template>
          <div class="value text-success">{{ formatMoney(summary.income_total || 0) }}</div>
          <div class="count">{{ summary.income_count || 0 }} 笔</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="stat-card balance">
          <template #header>结余</template>
          <div class="value" :style="{ color: balance >= 0 ? '#52c41a' : '#ff4d4f' }">
            {{ formatMoney(balance) }}
          </div>
          <div class="count">{{ periodName }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 图表区域 -->
    <el-row :gutter="20" v-loading="loading">
      <el-col :span="12">
        <el-card>
          <template #header>支出分类排行</template>
          <CategoryBarChart v-if="categoryData.length" :data="categoryData" type="支出" />
          <el-empty v-else description="暂无数据" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card>
          <template #header>账户类型分析</template>
          <div v-if="accountData.length" class="account-analysis">
            <div class="account-pie">
              <AccountPieChart :data="accountData" />
            </div>
            <div class="account-details">
              <div
                v-for="a in accountData"
                :key="a.account"
                class="account-detail-item"
              >
                <span class="account-name">{{ a.account }}</span>
                <div class="account-detail-right">
                  <span class="account-amount">{{ formatMoney(a.total) }}</span>
                  <span class="account-percent">{{ getPercent(a.total) }}%</span>
                </div>
              </div>
              <div class="account-detail-item account-total">
                <span class="account-name">总计</span>
                <div class="account-detail-right">
                  <span class="account-total-value">{{ formatMoney(accountTotalAmount) }}</span>
                  <span class="account-count">{{ accountData.length }} 个账户</span>
                </div>
              </div>
            </div>
          </div>
          <el-empty v-else description="暂无数据" />
        </el-card>
      </el-col>
    </el-row>

    <el-card style="margin-top: 20px" v-loading="loading">
      <template #header>月度收支趋势</template>
      <MonthlyTrendChart v-if="trendData.length" :data="trendData" />
      <el-empty v-else description="暂无数据" />
    </el-card>

    <el-card style="margin-top: 20px" v-loading="loading">
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
import { ref, computed, onMounted, watch } from 'vue';
import { getStatsSummary, getStatsByCategory, getStatsByAccount, getMonthlyTrend, getComparison } from '@/api/tauri';
import { getDateRange } from '@/utils/dateRange';
import { formatMoney } from '@/utils/formatters';
import CategoryBarChart from '@/components/stats/CategoryBarChart.vue';
import AccountPieChart from '@/components/stats/AccountPieChart.vue';
import MonthlyTrendChart from '@/components/stats/MonthlyTrendChart.vue';
import ComparisonChart from '@/components/stats/ComparisonChart.vue';

const periods = [
  { label: '今日', value: 'day' },
  { label: '近 7 天', value: 'week' },
  { label: '本月', value: 'month' },
  { label: '本年', value: 'year' },
];

const period = ref('month');
const loading = ref(false);

const summary = ref({ expense_total: 0, expense_count: 0, income_total: 0, income_count: 0 });
const categoryData = ref<any[]>([]);
const accountData = ref<any[]>([]);
const trendData = ref<any[]>([]);
const comparison = ref<any>(null);

const periodName = ref('本月');

const balance = computed(() => (summary.value.income_total || 0) - (summary.value.expense_total || 0));
const accountTotalAmount = computed(() => accountData.value.reduce((sum, a) => sum + a.total, 0));

function getPercent(amount: number): string {
  return accountTotalAmount.value > 0 ? ((amount / accountTotalAmount.value) * 100).toFixed(1) : '0.0';
}

async function loadData() {
  const { dateFrom, periodName: name } = getDateRange(period.value as any);
  periodName.value = name;
  loading.value = true;
  try {
    const summaryResult = await getStatsSummary(dateFrom);
    summary.value = summaryResult;

    categoryData.value = await getStatsByCategory(dateFrom, '支出');
    accountData.value = await getStatsByAccount(dateFrom);
    trendData.value = await getMonthlyTrend(6);
    comparison.value = await getComparison();
  } catch (e) {
    console.error('Failed to load stats', e);
  } finally {
    loading.value = false;
  }
}

function setPeriod(p: string) {
  period.value = p;
  loadData();
}

watch(period, () => loadData());

onMounted(async () => {
  await loadData();
});
</script>

<style scoped>
.stats-page {
  max-width: 100%;
}

/* Period selector */
.period-selector {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 20px;
  padding: 16px 20px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  flex-wrap: wrap;
}

.period-label {
  font-weight: 500;
  color: #666;
  white-space: nowrap;
}

/* Summary cards */
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

.stat-card.expense {
  border-left: 4px solid #ff6b6b;
}

.stat-card.income {
  border-left: 4px solid #52c41a;
}

.stat-card.balance {
  border-left: 4px solid #1890ff;
}

.text-danger {
  color: #ff4d4f;
}

.text-success {
  color: #52c41a;
}

/* Account analysis */
.account-analysis {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: center;
}

.account-detail-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid #eee;
}

.account-name {
  font-weight: 500;
  color: #333;
}

.account-detail-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.account-amount {
  font-weight: bold;
  color: #333;
}

.account-percent {
  color: #999;
  font-size: 0.9em;
}

.account-total {
  background: #f8f9fa;
  padding: 12px;
  border-radius: 8px;
  border-bottom: none;
  margin-top: 10px;
}

.account-total .account-name {
  font-weight: bold;
}

.account-total-value {
  font-weight: bold;
  color: #667eea;
}

.account-count {
  color: #999;
  font-size: 0.9em;
}

/* Mobile */
@media (max-width: 768px) {
  .period-selector {
    flex-direction: column;
    align-items: stretch;
  }

  .account-analysis {
    grid-template-columns: 1fr;
  }

  .stat-card .value {
    font-size: 1.5em;
  }
}
</style>
