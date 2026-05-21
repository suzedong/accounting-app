<template>
  <div class="home-page">
    <div class="page-header">
      <h2>首页</h2>
      <p class="subtitle">AI 记账 - 智能记账，轻松管理财务</p>
    </div>

    <el-alert v-if="error" type="error" :closable="false" style="margin-bottom: 16px">
      <strong>加载失败：</strong>{{ error }}
    </el-alert>

    <!-- 统计卡片 -->
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

    <!-- 类别分析 -->
    <el-card class="chart-card" v-loading="loading">
      <template #header>类别分析</template>
      <el-row :gutter="16">
        <el-col v-for="c in categories" :key="c.category" :span="6">
          <div class="category-item">
            <div class="icon">{{ categoryIcons[c.category] || '📦' }}</div>
            <div class="name">{{ c.category }}</div>
            <div class="amount text-danger">{{ formatMoney(c.total) }}</div>
            <div class="count">{{ c.count }} 笔</div>
          </div>
        </el-col>
      </el-row>
      <el-empty v-if="categories.length === 0 && !loading" description="暂无数据" />
    </el-card>

    <!-- 账户分析 -->
    <el-card class="chart-card" v-loading="loading">
      <template #header>账户分析</template>
      <el-row :gutter="20">
        <el-col v-for="a in accounts" :key="a.account" :span="6">
          <div class="category-item">
            <div class="name">{{ a.account }}</div>
            <div class="amount">{{ formatMoney(a.total) }}</div>
            <div class="count">{{ a.count }} 笔</div>
          </div>
        </el-col>
        <el-col :span="6">
          <div class="category-item highlight">
            <div class="name">总计</div>
            <div class="amount text-primary">{{ formatMoney(accountTotal) }}</div>
            <div class="count">{{ accounts.length }} 个账户</div>
          </div>
        </el-col>
      </el-row>
      <el-empty v-if="accounts.length === 0 && !loading" description="暂无数据" />
    </el-card>

    <!-- 预算执行 -->
    <el-card class="chart-card" v-loading="loading">
      <template #header>预算执行</template>
      <div v-if="budget" class="budget-analysis">
        <el-row :gutter="15" style="margin-bottom: 20px">
          <el-col :span="6">
            <div class="budget-stat">
              <div class="label">每月预算</div>
              <div class="value text-primary">{{ formatMoney(budgetMonthly) }}</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="budget-stat">
              <div class="label">已过天数</div>
              <div class="value">{{ budget.days }} 天</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="budget-stat">
              <div class="label">剩余天数</div>
              <div class="value">{{ budget.remaining_days }} 天</div>
            </div>
          </el-col>
          <el-col :span="6">
            <div class="budget-stat">
              <div class="label">预算执行</div>
              <div class="value" :style="{ color: statusColors[budget.status] }">{{ budget.status }}</div>
            </div>
          </el-col>
        </el-row>

        <div class="budget-progress">
          <div class="progress-header">
            <span>已用：{{ formatMoney(budget.actual_expense) }}</span>
            <span class="progress-percent" :style="{ color: statusColors[budget.status] }">
              {{ budget.usage_rate.toFixed(1) }}%
            </span>
          </div>
          <el-progress
            :percentage="Math.min(budget.usage_rate, 100)"
            :stroke-width="20"
            :color="statusColors[budget.status]"
            :show-text="false"
          />
          <div class="progress-footer">
            <span>剩余预算：{{ formatMoney(budget.remaining) }}</span>
            <span>日均消费：{{ formatMoney(budget.daily_avg) }}</span>
          </div>
        </div>

        <div class="budget-tip" :style="{
          background: budget.status === '超支' ? '#ffe6e6' : budget.status === '紧张' ? '#fff3cd' : '#e6f7e6',
          borderLeftColor: statusColors[budget.status] || '#666',
        }">
          <div class="tip-title">{{ budget.status === '超支' ? '预算超支' : budget.status === '紧张' ? '预算紧张' : '预算正常' }}</div>
          <div class="tip-content">{{ budgetTip }}</div>
        </div>
      </div>
      <el-empty v-if="!budget && !loading" description="暂无数据" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { getStatsSummary, getStatsByCategory, getStatsByAccount, getBudgetAnalysis } from '@/api/tauri';
import { formatMoney } from '@/utils/formatters';
import { getDateRange } from '@/utils/dateRange';

const stats = ref({ expense_total: 0, expense_count: 0, income_total: 0, income_count: 0, balance: 0 });
const categories = ref<any[]>([]);
const accounts = ref<any[]>([]);
const budget = ref<any>(null);
const loading = ref(false);
const error = ref('');

// 预算金额（后续从配置读取）
const budgetMonthly = ref(3500);

const categoryIcons: Record<string, string> = {
  '餐饮': '🍽️', '交通出行': '🚗', '购物': '🛒', '生活杂费': '🏠',
  '家庭支出': '👨‍👩‍👧', '医疗': '💊', '娱乐': '🎮', '学习': '📚',
  '人情往来': '🎁', '零食水果': '🍎', '数码': '💻', '服饰': '👕', '其他': '📦',
};

const statusColors: Record<string, string> = {
  '超支': '#FF6B6B', '紧张': '#FFC107', '正常': '#52C41A',
};

const accountTotal = computed(() => accounts.value.reduce((sum, a) => sum + a.total, 0));

const budgetTip = computed(() => {
  if (!budget.value) return '';
  const b = budget.value;
  if (b.status === '超支') {
    return `已超支 ${formatMoney(Math.abs(b.remaining))}！本月剩余 ${b.remaining_days} 天，建议立即控制非必要支出。`;
  }
  if (b.status === '紧张') {
    return `预算使用已达 ${b.usage_rate.toFixed(1)}%，剩余 ${formatMoney(b.remaining)}。建议剩余 ${b.remaining_days} 天内的日均消费控制在 ${formatMoney(b.daily_remaining)} 以内。`;
  }
  return `预算执行正常！剩余 ${formatMoney(b.remaining)}，剩余 ${b.remaining_days} 天还可日均消费 ${formatMoney(b.daily_remaining)}。`;
});

onMounted(async () => {
  const { dateFrom } = getDateRange('month');
  loading.value = true;
  try {
    const summary = await getStatsSummary(dateFrom);
    stats.value = summary;

    categories.value = await getStatsByCategory(dateFrom, '支出');
    accounts.value = await getStatsByAccount(dateFrom);

    try {
      budget.value = await getBudgetAnalysis('month', budgetMonthly.value);
    } catch {
      // Budget analysis may fail if no data
    }
  } catch (e) {
    error.value = String(e);
    console.error('[Home] Failed to load stats:', e);
  } finally {
    loading.value = false;
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

.category-item .icon {
  font-size: 1.5em;
  margin-bottom: 8px;
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

.category-item.highlight {
  background: #e8f4fd;
  border: 1px solid #b3d8ff;
}

.text-danger { color: #ff4d4f; }
.text-primary { color: #1890ff; }

/* Budget analysis */
.budget-analysis {
  padding: 0 4px;
}

.budget-stat {
  text-align: center;
}

.budget-stat .label {
  color: #666;
  font-size: 0.9em;
  margin-bottom: 5px;
}

.budget-stat .value {
  font-size: 1.5em;
  font-weight: bold;
  color: #667eea;
}

.budget-progress {
  background: #f8f9fa;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
}

.progress-percent {
  font-weight: bold;
}

.progress-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 0.9em;
  color: #666;
}

.budget-tip {
  padding: 15px;
  border-radius: 8px;
  border-left: 4px solid #666;
}

.tip-title {
  font-weight: bold;
  margin-bottom: 5px;
  font-size: 1em;
}

.tip-content {
  font-size: 0.95em;
}
</style>
