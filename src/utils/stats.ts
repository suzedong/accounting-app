import type { AccountRecord } from '@/types';

/**
 * 按分类聚合统计
 */
export function groupByCategory(
  records: AccountRecord[],
  type: '收入' | '支出' = '支出',
): Array<{ category: string; total: number; count: number }> {
  const map = new Map<string, { total: number; count: number }>();

  for (const r of records) {
    if (r.type !== type) continue;
    const cat = r.category || '未分类';
    const entry = map.get(cat) || { total: 0, count: 0 };
    entry.total += r.amount;
    entry.count += 1;
    map.set(cat, entry);
  }

  return Array.from(map.entries())
    .map(([category, { total, count }]) => ({ category, total: Math.round(total * 100) / 100, count }))
    .sort((a, b) => b.total - a.total);
}

/**
 * 按账户聚合统计
 */
export function groupByAccount(
  records: AccountRecord[],
): Array<{ account: string; total: number; count: number }> {
  const map = new Map<string, { total: number; count: number }>();

  for (const r of records) {
    const acc = r.account || '未知';
    const entry = map.get(acc) || { total: 0, count: 0 };
    entry.total += r.amount;
    entry.count += 1;
    map.set(acc, entry);
  }

  return Array.from(map.entries())
    .map(([account, { total, count }]) => ({ account, total: Math.round(total * 100) / 100, count }))
    .sort((a, b) => b.total - a.total);
}

/**
 * 汇总统计
 */
export function computeSummary(records: AccountRecord[]) {
  let incomeTotal = 0;
  let incomeCount = 0;
  let expenseTotal = 0;
  let expenseCount = 0;

  for (const r of records) {
    if (r.type === '收入') {
      incomeTotal += r.amount;
      incomeCount += 1;
    } else {
      expenseTotal += r.amount;
      expenseCount += 1;
    }
  }

  return {
    income_total: Math.round(incomeTotal * 100) / 100,
    income_count: incomeCount,
    expense_total: Math.round(expenseTotal * 100) / 100,
    expense_count: expenseCount,
    balance: Math.round((incomeTotal - expenseTotal) * 100) / 100,
  };
}

/**
 * 月度趋势
 */
export function computeMonthlyTrend(
  records: AccountRecord[],
  months = 12,
): Array<{ month: string; income: number; expense: number }> {
  const now = new Date();
  const monthlyMap = new Map<string, { income: number; expense: number }>();

  // Initialize last N months
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyMap.set(key, { income: 0, expense: 0 });
  }

  for (const r of records) {
    const month = r.datetime.substring(0, 7); // YYYY-MM
    if (!monthlyMap.has(month)) continue;
    const entry = monthlyMap.get(month)!;
    if (r.type === '收入') entry.income += r.amount;
    else entry.expense += r.amount;
  }

  return Array.from(monthlyMap.entries()).map(([month, { income, expense }]) => ({
    month,
    income: Math.round(income * 100) / 100,
    expense: Math.round(expense * 100) / 100,
  }));
}

/**
 * 本月 vs 上月对比
 */
export function computeComparison(records: AccountRecord[]) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const current = { income: 0, expense: 0, balance: 0 };
  const previous = { income: 0, expense: 0, balance: 0 };

  for (const r of records) {
    const month = r.datetime.substring(0, 7);
    if (month === currentMonth) {
      if (r.type === '收入') current.income += r.amount;
      else current.expense += r.amount;
    } else if (month === previousMonth) {
      if (r.type === '收入') previous.income += r.amount;
      else previous.expense += r.amount;
    }
  }

  current.balance = current.income - current.expense;
  previous.balance = previous.income - previous.expense;

  return {
    current: {
      label: '本月',
      income: Math.round(current.income * 100) / 100,
      expense: Math.round(current.expense * 100) / 100,
      balance: Math.round(current.balance * 100) / 100,
    },
    previous: {
      label: '上月',
      income: Math.round(previous.income * 100) / 100,
      expense: Math.round(previous.expense * 100) / 100,
      balance: Math.round(previous.balance * 100) / 100,
    },
  };
}

/**
 * 预算执行计算
 */
export function computeBudgetExecution(
  records: AccountRecord[],
  budgetMonthly: number,
) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const currentDay = now.getDate();
  const remainingDays = daysInMonth - currentDay;

  let actualExpense = 0;
  for (const r of records) {
    if (r.datetime.substring(0, 7) === currentMonth && r.type === '支出') {
      actualExpense += r.amount;
    }
  }

  actualExpense = Math.round(actualExpense * 100) / 100;
  const usageRate = Math.round((actualExpense / budgetMonthly) * 1000) / 10;
  const remaining = Math.round((budgetMonthly - actualExpense) * 100) / 100;
  const dailyAvg = currentDay > 0 ? Math.round((actualExpense / currentDay) * 100) / 100 : 0;
  const dailyRemaining = remainingDays > 0 ? Math.round((remaining / remainingDays) * 100) / 100 : 0;

  let status: '正常' | '紧张' | '超支' = '正常';
  if (usageRate > 100) status = '超支';
  else if (usageRate > 80) status = '紧张';

  return {
    budget_monthly: budgetMonthly,
    actual_expense: actualExpense,
    usage_rate: usageRate,
    remaining,
    days: daysInMonth,
    remaining_days: remainingDays,
    daily_avg: dailyAvg,
    daily_remaining: dailyRemaining,
    status,
  };
}
