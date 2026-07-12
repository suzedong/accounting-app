<template>
  <div class="stats-page">
    <!-- 月份选择器 -->
    <div class="month-selector">
      <el-button size="small" :icon="ArrowLeft" circle @click="shiftMonth(-1)" />
      <el-date-picker
        v-model="selectedMonth"
        type="month"
        format="YYYY 年 M 月"
        value-format="YYYY-MM"
        :clearable="false"
        :disabled-date="disableFuture"
        style="width: 180px"
      />
      <el-button size="small" :icon="ArrowRight" circle :disabled="isCurrentMonth" @click="shiftMonth(1)" />
      <el-button
        size="small"
        text
        type="primary"
        :disabled="isCurrentMonth"
        @click="jumpToCurrentMonth"
      >
        回到本月
      </el-button>
      <span class="month-hint">{{ isCurrentMonth ? '本月' : monthDiffLabel }}</span>
    </div>

    <!-- 总览：支出 / 收入 / 结余 -->
    <el-row :gutter="20" class="stats-row" v-loading="loading">
      <el-col :span="8">
        <el-card class="stat-card expense">
          <template #header>
            <span>总支出</span>
            <span class="card-count">{{ summary.expense_count || 0 }} 笔</span>
          </template>
          <div class="value text-danger">{{ formatMoney(summary.expense_total || 0) }}</div>
          <div class="mom" :class="momClass(expenseMoM)">
            {{ momLabel(expenseMoM, '支出') }}
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="stat-card income">
          <template #header>
            <span>总收入</span>
            <span class="card-count">{{ summary.income_count || 0 }} 笔</span>
          </template>
          <div class="value text-success">{{ formatMoney(summary.income_total || 0) }}</div>
          <div class="mom" :class="momClass(incomeMoM, true)">
            {{ momLabel(incomeMoM, '收入') }}
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="stat-card balance">
          <template #header>
            <span>结余</span>
            <span class="card-count">{{ selectedMonth }}</span>
          </template>
          <div class="value" :style="{ color: balance >= 0 ? '#52c41a' : '#ff4d4f' }">
            {{ formatMoney(balance) }}
          </div>
          <div class="mom" :class="momClass(balanceMoM, true)">
            {{ momLabel(balanceMoM, '结余') }}
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 个人 vs 家庭 双栏分析 -->
    <el-row :gutter="20" v-loading="loading">
      <el-col :span="12">
        <AccountAnalysisCard
          title="个人消费"
          color="#667eea"
          :summary="personalSummary"
          :prev-total="personalPrevExpense"
          :share="personalShare"
          :categories="personalCategories"
        />
      </el-col>
      <el-col :span="12">
        <AccountAnalysisCard
          title="家庭消费"
          color="#f5a623"
          :summary="familySummary"
          :prev-total="familyPrevExpense"
          :share="familyShare"
          :categories="familyCategories"
        />
      </el-col>
    </el-row>

    <!-- 最近 6 个月 个人 vs 家庭 支出趋势 -->
    <el-card style="margin-top: 20px" v-loading="loading">
      <template #header>
        <div class="trend-header">
          <span>最近 6 个月支出趋势</span>
          <span class="trend-hint">个人 vs 家庭</span>
        </div>
      </template>
      <v-chart
        v-if="trendMonths.length"
        class="trend-chart"
        :option="trendOption"
        autoresize
      />
      <el-empty v-else description="暂无数据" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { ArrowLeft, ArrowRight } from '@element-plus/icons-vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components';
import VChart from 'vue-echarts';
import { getStatsSummary, getStatsByCategory, getMonthlyTrend } from '@/api/tauri';
import { formatMoney } from '@/utils/formatters';
import AccountAnalysisCard from '@/components/stats/AccountAnalysisCard.vue';
import type { StatsSummary, CategoryStat, MonthTrend } from '@/types';

use([CanvasRenderer, LineChart, TooltipComponent, GridComponent, LegendComponent]);

// ============ 月份选择 ============
const now = new Date();
const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const selectedMonth = ref(currentMonthKey);

const isCurrentMonth = computed(() => selectedMonth.value === currentMonthKey);

const monthDiffLabel = computed(() => {
  const [y, m] = selectedMonth.value.split('-').map(Number);
  const diff = (now.getFullYear() - y) * 12 + (now.getMonth() + 1 - m);
  if (diff === 1) return '上月';
  if (diff > 1) return `${diff} 个月前`;
  return '';
});

function disableFuture(date: Date) {
  return date.getTime() > new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();
}

function shiftMonth(delta: number) {
  const [y, m] = selectedMonth.value.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (next > currentMonthKey) return;
  selectedMonth.value = next;
}

function jumpToCurrentMonth() {
  selectedMonth.value = currentMonthKey;
}

// ============ 月份 → 时间范围（本地时间字符串） ============
function monthRange(monthKey: string): { from: string; to: string } {
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${monthKey}-01 00:00:00`,
    to: `${monthKey}-${String(last).padStart(2, '0')} 23:59:59`,
  };
}

function previousMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ============ 数据状态 ============
const loading = ref(false);

const summary = ref<StatsSummary>({
  expense_total: 0,
  expense_count: 0,
  income_total: 0,
  income_count: 0,
  balance: 0,
});
const prevSummary = ref<StatsSummary>({
  expense_total: 0,
  expense_count: 0,
  income_total: 0,
  income_count: 0,
  balance: 0,
});

const personalSummary = ref<StatsSummary>({
  expense_total: 0,
  expense_count: 0,
  income_total: 0,
  income_count: 0,
  balance: 0,
});
const familySummary = ref<StatsSummary>({
  expense_total: 0,
  expense_count: 0,
  income_total: 0,
  income_count: 0,
  balance: 0,
});
const personalPrevExpense = ref(0);
const familyPrevExpense = ref(0);
const personalCategories = ref<CategoryStat[]>([]);
const familyCategories = ref<CategoryStat[]>([]);

const personalTrend = ref<MonthTrend[]>([]);
const familyTrend = ref<MonthTrend[]>([]);

// ============ 派生指标 ============
const balance = computed(
  () => (summary.value.income_total || 0) - (summary.value.expense_total || 0),
);

function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

const expenseMoM = computed(() =>
  pctChange(summary.value.expense_total, prevSummary.value.expense_total),
);
const incomeMoM = computed(() =>
  pctChange(summary.value.income_total, prevSummary.value.income_total),
);
const balanceMoM = computed(() => {
  const prevBal = prevSummary.value.income_total - prevSummary.value.expense_total;
  return pctChange(balance.value, prevBal);
});

const totalExpense = computed(() => summary.value.expense_total || 0);
const personalShare = computed(() =>
  totalExpense.value > 0
    ? (personalSummary.value.expense_total / totalExpense.value) * 100
    : 0,
);
const familyShare = computed(() =>
  totalExpense.value > 0
    ? (familySummary.value.expense_total / totalExpense.value) * 100
    : 0,
);

function momLabel(v: number | null, label: string): string {
  if (v === null) return `上月无${label}`;
  const arrow = v > 0 ? '↑' : v < 0 ? '↓' : '→';
  return `环比 ${arrow} ${Math.abs(v).toFixed(1)}%`;
}

/** 支出型指标：涨=红；收入/结余：涨=绿 */
function momClass(v: number | null, positiveIsGood = false): string {
  if (v === null || v === 0) return 'mom-neutral';
  const good = positiveIsGood ? v > 0 : v < 0;
  return good ? 'mom-good' : 'mom-bad';
}

// ============ 趋势图配置 ============
const trendMonths = computed(() => personalTrend.value.map(t => t.month));

const trendOption = computed(() => {
  const monthMap = new Map<string, { personal: number; family: number }>();
  trendMonths.value.forEach(m => monthMap.set(m, { personal: 0, family: 0 }));
  personalTrend.value.forEach(t => {
    const entry = monthMap.get(t.month);
    if (entry) entry.personal = t.expense;
  });
  familyTrend.value.forEach(t => {
    const entry = monthMap.get(t.month);
    if (entry) entry.family = t.expense;
  });
  const months = trendMonths.value;
  return {
    tooltip: { trigger: 'axis' as const, valueFormatter: (v: number) => `¥${v.toFixed(2)}` },
    legend: { top: 0, data: ['个人支出', '家庭支出'] },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '15%', containLabel: true },
    xAxis: { type: 'category' as const, data: months },
    yAxis: { type: 'value' as const, axisLabel: { formatter: '¥{value}' } },
    series: [
      {
        name: '个人支出',
        type: 'line' as const,
        smooth: true,
        symbol: 'circle',
        symbolSize: 8,
        data: months.map(m => monthMap.get(m)?.personal ?? 0),
        itemStyle: { color: '#667eea' },
        areaStyle: { opacity: 0.15 },
      },
      {
        name: '家庭支出',
        type: 'line' as const,
        smooth: true,
        symbol: 'circle',
        symbolSize: 8,
        data: months.map(m => monthMap.get(m)?.family ?? 0),
        itemStyle: { color: '#f5a623' },
        areaStyle: { opacity: 0.15 },
      },
    ],
  };
});

// ============ 加载数据 ============
async function loadData() {
  const monthKey = selectedMonth.value;
  const { from, to } = monthRange(monthKey);
  const prevKey = previousMonthKey(monthKey);
  const { from: prevFrom, to: prevTo } = monthRange(prevKey);

  loading.value = true;
  try {
    const [
      s,
      prev,
      sPersonal,
      sFamily,
      prevPersonal,
      prevFamily,
      catsPersonal,
      catsFamily,
      trendPersonal,
      trendFamily,
    ] = await Promise.all([
      getStatsSummary(from, to),
      getStatsSummary(prevFrom, prevTo),
      getStatsSummary(from, to, '个人'),
      getStatsSummary(from, to, '家庭'),
      getStatsSummary(prevFrom, prevTo, '个人'),
      getStatsSummary(prevFrom, prevTo, '家庭'),
      getStatsByCategory(from, '支出', to, '个人'),
      getStatsByCategory(from, '支出', to, '家庭'),
      getMonthlyTrend(6, '个人'),
      getMonthlyTrend(6, '家庭'),
    ]);
    summary.value = s;
    prevSummary.value = prev;
    personalSummary.value = sPersonal;
    familySummary.value = sFamily;
    personalPrevExpense.value = prevPersonal.expense_total;
    familyPrevExpense.value = prevFamily.expense_total;
    personalCategories.value = catsPersonal;
    familyCategories.value = catsFamily;
    personalTrend.value = trendPersonal;
    familyTrend.value = trendFamily;
  } catch (e) {
    console.error('Failed to load stats', e);
  } finally {
    loading.value = false;
  }
}

watch(selectedMonth, () => loadData());
onMounted(() => loadData());
</script>

<style scoped>
.stats-page {
  max-width: 100%;
}

/* Month selector */
.month-selector {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  padding: 14px 20px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  flex-wrap: wrap;
}

.month-hint {
  margin-left: auto;
  color: #999;
  font-size: 0.9em;
}

/* Summary cards */
.stats-row {
  margin-bottom: 20px;
}

.stat-card :deep(.el-card__header) {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
}

.card-count {
  color: #999;
  font-size: 0.85em;
  font-weight: normal;
}

.stat-card .value {
  font-size: 2em;
  font-weight: bold;
  line-height: 1.2;
}

.stat-card .mom {
  margin-top: 6px;
  font-size: 0.9em;
}

.mom-good { color: #52c41a; }
.mom-bad { color: #ff4d4f; }
.mom-neutral { color: #999; }

.stat-card.expense { border-left: 4px solid #ff6b6b; }
.stat-card.income { border-left: 4px solid #52c41a; }
.stat-card.balance { border-left: 4px solid #1890ff; }

.text-danger { color: #ff4d4f; }
.text-success { color: #52c41a; }

/* Trend chart */
.trend-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.trend-hint {
  color: #999;
  font-size: 0.9em;
  font-weight: normal;
}

.trend-chart {
  width: 100%;
  height: 380px;
}

/* Mobile */
@media (max-width: 768px) {
  .month-selector {
    justify-content: flex-start;
  }

  .month-hint {
    margin-left: 0;
    flex-basis: 100%;
  }

  .stat-card .value {
    font-size: 1.5em;
  }
}
</style>
