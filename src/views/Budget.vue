<template>
  <div class="budget-page">
    <div class="page-header">
      <h2>预算管理</h2>
      <el-button @click="showEditBudget">修改月度预算</el-button>
    </div>

    <!-- 月度预算执行列表 -->
    <el-card v-loading="loading">
      <template #header>月度预算执行</template>
      <div class="monthly-list">
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
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getAllConfig, setConfig, getRecords } from '@/api/tauri';
import { formatMoney } from '@/utils/formatters';

const loading = ref(false);
const budgetMonthly = ref(3500);

interface MonthlyStat {
  month: string;
  budget: number;
  actual: number;
  remaining: number;
  usageRate: number;
  status: string;
}
const monthlyStats = ref<MonthlyStat[]>([]);

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

    await loadMonthlyStats();
  } catch (e) {
    console.error('Failed to load budget analysis', e);
  } finally {
    loading.value = false;
  }
}

async function loadMonthlyStats() {
  const now = new Date();
  const months: MonthlyStat[] = [];

  // Get all months from the earliest record to current month
  // First, find the earliest record year
  const result = await getRecords({ page: 1, pageSize: 10000, sort: 'datetime_asc' });
  const allRecords = result.data || [];

  if (allRecords.length === 0) {
    monthlyStats.value = [];
    return;
  }

  const earliestDate = allRecords[0]?.datetime || '';
  let startYear: number;
  let startMonth: number;

  if (earliestDate) {
    const parts = earliestDate.substring(0, 7).split('-');
    startYear = parseInt(parts[0]);
    startMonth = parseInt(parts[1]);
  } else {
    startYear = now.getFullYear();
    startMonth = 1;
  }

  // Generate month list from earliest to current
  let year = startYear;
  let month = startMonth;

  while (year < now.getFullYear() || (year === now.getFullYear() && month <= now.getMonth() + 1)) {
    const monthLabel = `${year}-${String(month).padStart(2, '0')}`;
    const datetimeGte = `${monthLabel}-01 00:00:00`;
    const nextM = month === 12 ? 1 : month + 1;
    const nextY = month === 12 ? year + 1 : year;
    const datetimeLte = `${nextY}-${String(nextM).padStart(2, '0')}-01 00:00:00`;

    const personalExpense = allRecords.filter(r =>
      r.type === '支出'
      && (r.account === '个人' || !r.account)
      && r.datetime >= datetimeGte
      && r.datetime < datetimeLte
    );
    const actual = personalExpense.reduce((sum, r) => sum + (r.amount || 0), 0);

    let status: string;
    if (actual > budgetMonthly.value) status = '超支';
    else if (actual > budgetMonthly.value * 0.8) status = '紧张';
    else status = '正常';

    months.push({
      month: monthLabel,
      budget: budgetMonthly.value,
      actual,
      remaining: budgetMonthly.value - actual,
      usageRate: budgetMonthly.value > 0 ? (actual / budgetMonthly.value) * 100 : 0,
      status,
    });

    if (month === 12) {
      month = 1;
      year++;
    } else {
      month++;
    }
  }

  // Reverse: newest first
  monthlyStats.value = months.reverse();
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

/* Monthly list */
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
