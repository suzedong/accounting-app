<template>
  <div class="budget-page">
    <div class="page-header">
      <h2>预算管理</h2>
      <el-button @click="showEditBudget">修改月度预算</el-button>
    </div>

    <!-- Budget Overview -->
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

    <!-- Progress -->
    <el-card class="progress-card">
      <template #header>预算执行进度</template>
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
    </el-card>

    <!-- Budget Analysis -->
    <el-card class="analysis-card" v-if="budgetAnalysis">
      <template #header>预算分析</template>
      <el-row :gutter="20">
        <el-col :span="12">
          <div class="analysis-item">
            <div class="label">预算使用率</div>
            <div class="value">{{ usageRate.toFixed(1) }}%</div>
          </div>
        </el-col>
        <el-col :span="12">
          <div class="analysis-item">
            <div class="label">日均消费</div>
            <div class="value">{{ formatMoney(dailyAvg) }}</div>
          </div>
        </el-col>
      </el-row>
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
import { getBudgetAnalysis, getAllConfig, setConfig } from '@/api/tauri';
import { formatMoney } from '@/utils/formatters';

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
  try {
    const config = await getAllConfig();
    budgetMonthly.value = config.budget_monthly || 3500;
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
  } catch (e) {
    console.error('Failed to load budget analysis', e);
  }
});

function showEditBudget() {
  newBudget.value = budgetMonthly.value;
  budgetDialogVisible.value = true;
}

async function handleSaveBudget() {
  budgetMonthly.value = newBudget.value;
  try {
    await setConfig('budget_monthly', budgetMonthly.value.toString());
    const analysis = await getBudgetAnalysis('month', budgetMonthly.value);
    actualExpense.value = analysis.actual_expense;
    usageRate.value = analysis.usage_rate;
    remaining.value = analysis.remaining;
    remainingDays.value = analysis.remaining_days;
    dailyAvg.value = analysis.daily_avg;
    dailyRemaining.value = analysis.daily_remaining;
    budgetStatus.value = analysis.status;
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

.progress-card {
  margin-bottom: 20px;
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

.analysis-card {
  margin-bottom: 20px;
}

.analysis-item {
  text-align: center;
  padding: 12px;
}

.analysis-item .label {
  color: #666;
  font-size: 0.9em;
  margin-bottom: 8px;
}

.analysis-item .value {
  font-size: 1.5em;
  font-weight: 600;
  color: #333;
}
</style>
