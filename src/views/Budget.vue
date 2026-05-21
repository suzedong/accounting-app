<template>
  <div class="budget-page">
    <div class="page-header">
      <h2>预算管理</h2>
      <el-button @click="showEditBudget">修改月度预算</el-button>
    </div>

    <!-- 年度总览 -->
    <el-card class="yearly-summary" v-loading="loading">
      <el-row :gutter="20">
        <el-col :span="6">
          <div class="yearly-item">
            <div class="label">年度总预算</div>
            <div class="value">{{ formatMoney(yearlyTotalBudget) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="yearly-item">
            <div class="label">实际支出</div>
            <div class="value text-danger">{{ formatMoney(yearlyActual) }}</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="yearly-item">
            <div class="label">结余</div>
            <div class="value" :class="yearlyRemaining >= 0 ? 'text-success' : 'text-danger'">
              {{ formatMoney(yearlyRemaining) }}
            </div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="yearly-item">
            <div class="label">预算执行率</div>
            <div class="value">{{ yearlyUsageRate.toFixed(1) }}%</div>
          </div>
        </el-col>
      </el-row>
    </el-card>

    <!-- 本月预算 -->
    <el-card class="current-budget-card">
      <template #header>本月预算执行</template>
      <el-row :gutter="20" class="summary-row">
        <el-col :span="6">
          <el-card class="stat-card budget-total">
            <template #header>月度预算</template>
            <div class="value">{{ formatMoney(budgetMonthly) }}</div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stat-card expense-total">
            <template #header>本月支出</template>
            <div class="value">{{ formatMoney(actualExpense) }}</div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stat-card remaining">
            <template #header>剩余可用</template>
            <div class="value" :class="remaining < 0 ? 'over' : ''">{{ formatMoney(remaining) }}</div>
          </el-card>
        </el-col>
        <el-col :span="6">
          <el-card class="stat-card daily">
            <template #header>日均剩余</template>
            <div class="value">{{ formatMoney(dailyRemaining) }}</div>
            <div class="count">{{ remainingDays }} 天剩余</div>
          </el-card>
        </el-col>
      </el-row>

      <div class="progress-section">
        <el-progress
          :percentage="Math.min(usageRate, 100)"
          :color="progressColor"
          :stroke-width="24"
          :text-inside="true"
        />
        <div class="status-badge">
          <el-tag :type="statusType" size="large">{{ budgetStatus }}</el-tag>
          <span class="detail">
            本月已花费 {{ formatMoney(actualExpense) }}，剩余 {{ formatMoney(remaining) }}
          </span>
        </div>
      </div>
    </el-card>

    <!-- 月度执行列表 -->
    <el-card class="monthly-list-card">
      <template #header>月度预算执行</template>
      <div class="monthly-list" v-loading="loading">
        <div
          v-for="m in monthlyStats"
          :key="m.month"
          class="month-item"
          :class="{ 'status-over': m.status === '超支', 'status-warning': m.status === '紧张' }"
        >
          <div class="month-item-grid">
            <div class="month-name">{{ m.month }}</div>
            <div class="month-bar-area">
              <div class="month-row">
                <span>{{ formatMoney(m.actual) }} / {{ formatMoney(m.budget) }}</span>
                <span class="month-status" :class="{
                  'text-over': m.status === '超支',
                  'text-warning': m.status === '紧张',
                  'text-ok': m.status === '正常'
                }">{{ m.status }}</span>
              </div>
              <div class="month-bar-container">
                <div class="month-bar" :class="m.remaining >= 0 ? 'bg-ok' : 'bg-over'"
                     :style="{ width: Math.min(m.usageRate, 100) + '%' }"></div>
              </div>
            </div>
            <div class="month-remaining">
              <div class="month-remaining-label">结余</div>
              <div class="month-remaining-value"
                   :style="{ color: m.remaining >= 0 ? '#52c41a' : '#ff4d4f' }">
                {{ formatMoney(m.remaining) }}
              </div>
            </div>
          </div>
        </div>
        <el-empty v-if="monthlyStats.length === 0 && !loading" description="暂无数据" />
      </div>
    </el-card>

    <!-- Budget Edit Dialog -->
    <el-dialog v-model="budgetDialogVisible" title="修改月度预算" width="400px">
      <el-form label-width="80px">
        <el-form-item label="预算金额">
          <el-input-number v-model="newBudget" :min="0" :precision="0" :step="500" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="budgetDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveBudget">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getBudgetAnalysis, getAllConfig, setConfig, getRecords, getMonthlyTrend } from '@/api/tauri';
import { formatMoney } from '@/utils/formatters';

const loading = ref(false);
const budgetMonthly = ref(3500);
const actualExpense = ref(0);
const usageRate = ref(0);
const remaining = ref(0);
const days = ref(0);
const remainingDays = ref(0);
const dailyAvg = ref(0);
const dailyRemaining = ref(0);
const budgetStatus = ref('正常');
const budgetAnalysis = ref<any>(null);

// Yearly summary
const yearlyTotalBudget = ref(0);
const yearlyActual = ref(0);
const yearlyRemaining = ref(0);
const yearlyUsageRate = ref(0);

// Monthly stats
interface MonthlyStat {
  month: string;
  budget: number;
  actual: number;
  remaining: number;
  usageRate: number;
  status: string;
}
const monthlyStats = ref<MonthlyStat[]>([]);

const progressColor = computed(() => {
  if (usageRate.value > 100) return '#ff4d4f';
  if (usageRate.value > 80) return '#faad14';
  return '#52c41a';
});

const statusType = computed(() => {
  switch (budgetStatus.value) {
    case '超支': return 'danger';
    case '紧张': return 'warning';
    default: return 'success';
  }
});

const newBudget = ref(3500);
const budgetDialogVisible = ref(false);

onMounted(async () => {
  await loadAll();
});

async function loadAll() {
  loading.value = true;
  try {
    const config = await getAllConfig();
    budgetMonthly.value = config.budget_monthly || 3500;

    // Current month analysis
    const analysis = await getBudgetAnalysis('month', budgetMonthly.value);
    budgetAnalysis.value = analysis;
    actualExpense.value = analysis.actual_expense;
    usageRate.value = analysis.usage_rate;
    remaining.value = analysis.remaining;
    days.value = analysis.days;
    remainingDays.value = analysis.remaining_days;
    dailyAvg.value = analysis.daily_avg;
    dailyRemaining.value = analysis.daily_remaining;
    budgetStatus.value = analysis.status;

    // Yearly summary
    await loadYearlySummary();

    // Monthly execution list
    await loadMonthlyStats();
  } catch (e) {
    console.error('Failed to load budget analysis', e);
  } finally {
    loading.value = false;
  }
}

async function loadYearlySummary() {
  const now = new Date();
  const year = now.getFullYear();
  yearlyTotalBudget.value = budgetMonthly.value * 12;

  // Get all records for the year (personal account expenses only)
  const datetimeGte = `${year}-01-01 00:00:00`;
  const datetimeLte = `${year}-12-31 23:59:59`;
  const result = await getRecords({ page: 1, pageSize: 10000, datetimeGte, datetimeLte });
  const personalExpense = (result.data || []).filter(r =>
    r.type === '支出' && (r.account === '个人' || !r.account)
  );
  yearlyActual.value = personalExpense.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
  yearlyRemaining.value = yearlyTotalBudget.value - yearlyActual.value;
  yearlyUsageRate.value = yearlyTotalBudget.value > 0
    ? (yearlyActual.value / yearlyTotalBudget.value) * 100
    : 0;
}

async function loadMonthlyStats() {
  const now = new Date();
  const months: MonthlyStat[] = [];

  // Get past 6 months (including current)
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const datetimeGte = `${monthLabel}-01 00:00:00`;
    const nextD = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const datetimeLte = `${nextD.getFullYear()}-${String(nextD.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;

    const result = await getRecords({ page: 1, pageSize: 10000, datetimeGte, datetimeLte });
    const personalExpense = (result.data || []).filter(r =>
      r.type === '支出' && (r.account === '个人' || !r.account)
    );
    const actual = personalExpense.reduce((sum: number, r: any) => sum + (r.amount || 0), 0);
    const isCurrentMonth = i === 0;
    const budget = isCurrentMonth ? budgetMonthly.value : budgetMonthly.value;

    // For past months, compute status based on actual expense
    let status: string;
    if (actual > budget) status = '超支';
    else if (actual > budget * 0.8) status = '紧张';
    else status = '正常';

    months.push({
      month: monthLabel,
      budget,
      actual,
      remaining: budget - actual,
      usageRate: budget > 0 ? (actual / budget) * 100 : 0,
      status,
    });
  }

  monthlyStats.value = months;
}

function showEditBudget() {
  newBudget.value = budgetMonthly.value;
  budgetDialogVisible.value = true;
}

async function handleSaveBudget() {
  budgetMonthly.value = newBudget.value;
  try {
    await setConfig('budget_monthly', budgetMonthly.value.toString());
    await loadAll();
    ElMessage.success('预算已更新');
    budgetDialogVisible.value = false;
  } catch (e) {
    console.error('Failed to save budget', e);
  }
}
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  font-size: 1.5em;
  color: #333;
}

/* Yearly summary */
.yearly-summary {
  margin-bottom: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
}

.yearly-summary :deep(.el-card__body) {
  padding: 20px;
}

.yearly-item {
  text-align: center;
  color: white;
}

.yearly-item .label {
  opacity: 0.9;
  font-size: 0.9em;
  margin-bottom: 8px;
}

.yearly-item .value {
  font-size: 1.5em;
  font-weight: bold;
}

.summary-row {
  margin-bottom: 20px;
}

.stat-card .value {
  font-size: 1.8em;
  font-weight: bold;
}

.stat-card .count {
  color: #999;
  font-size: 0.9em;
  margin-top: 4px;
}

.budget-total .value { color: #1890ff; }
.expense-total .value { color: #ff4d4f; }
.remaining .value { color: #52c41a; }
.remaining .over { color: #ff4d4f; }
.daily .value { color: #722ed1; }

.progress-section {
  padding: 0 4px;
}

.status-badge {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail {
  color: #666;
  font-size: 0.95em;
}

/* Monthly list */
.monthly-list-card {
  margin-bottom: 20px;
}

.monthly-list {
  display: grid;
  gap: 10px;
}

.month-item {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  border-left: 4px solid #52c41a;
}

.month-item.status-over {
  border-left-color: #ff4d4f;
}

.month-item.status-warning {
  border-left-color: #faad14;
}

.month-item-grid {
  display: grid;
  grid-template-columns: 100px 1fr 150px;
  gap: 15px;
  align-items: center;
}

.month-name {
  font-weight: bold;
  color: #333;
}

.month-bar-area {
  width: 100%;
}

.month-row {
  display: flex;
  justify-content: space-between;
  font-size: 0.9em;
}

.month-status {
  font-weight: 500;
}

.month-bar-container {
  background: #e0e0e0;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  margin-top: 5px;
}

.month-bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}

.bg-ok { background: #52c41a; }
.bg-over { background: #ff4d4f; }

.month-remaining {
  text-align: right;
}

.month-remaining-label {
  font-size: 0.85em;
  color: #666;
}

.month-remaining-value {
  font-size: 1.2em;
  font-weight: bold;
}

/* Utility */
.text-success { color: #52c41a; }
.text-danger { color: #ff4d4f; }
.text-ok { color: #52c41a; }
.text-warning { color: #faad14; }
.text-over { color: #ff4d4f; }

/* Mobile */
@media (max-width: 768px) {
  .month-item-grid {
    grid-template-columns: 1fr;
  }
  .month-remaining {
    text-align: left;
  }
}
</style>
