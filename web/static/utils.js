/**
 * 记账系统工具函数
 */

// 格式化金额（千分位分隔符）
function formatMoney(amount, currency = '¥') {
    const num = typeof amount === 'number' ? amount : parseFloat(amount);
    if (isNaN(num)) return currency + '0.00';
    return currency + num.toLocaleString('zh-CN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

// 格式化日期时间（处理 ISO 8601 格式）
function formatDatetime(datetimeStr) {
    if (!datetimeStr) return '-';
    // 如果是 ISO 8601 格式（含 T 和 Z），转换为本地时间
    if (datetimeStr.includes('T')) {
        const date = new Date(datetimeStr);
        if (isNaN(date.getTime())) return datetimeStr;
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const h = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }
    // 已经是标准格式，直接返回
    return datetimeStr;
}

// 设置导航链接 active 状态
function setActiveNav(currentPath) {
    const navLinks = document.querySelectorAll('.nav-links a');
    navLinks.forEach(link => {
        const href = link.getAttribute('href');
        // 支持相对路径和绝对路径匹配
        if (href === currentPath || href.endsWith(currentPath)) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// 分页器类
class Paginator {
    constructor(options = {}) {
        this.container = options.container;
        this.total = options.total || 0;
        this.pageSize = options.pageSize || 20;
        this.currentPage = options.currentPage || 1;
        this.onPageChange = options.onPageChange || (() => {});
    }

    getTotalPages() {
        return Math.ceil(this.total / this.pageSize);
    }

    render() {
        const totalPages = this.getTotalPages();
        if (totalPages <= 1) {
            this.container.innerHTML = '';
            return;
        }

        const start = (this.currentPage - 1) * this.pageSize + 1;
        const end = Math.min(this.currentPage * this.pageSize, this.total);

        let html = `
            <div class="pagination">
                <div class="pagination-info">
                    显示 ${start}-${end} 条，共 ${this.total} 条
                </div>
                <div class="pagination-controls">
                    <button onclick="paginator.firstPage()" ${this.currentPage === 1 ? 'disabled' : ''}>
                        ⏮️ 首页
                    </button>
                    <button onclick="paginator.prevPage()" ${this.currentPage === 1 ? 'disabled' : ''}>
                        ◀️ 上一页
                    </button>
                    <span class="pagination-current">
                        第 ${this.currentPage} / ${totalPages} 页
                    </span>
                    <button onclick="paginator.nextPage()" ${this.currentPage === totalPages ? 'disabled' : ''}>
                        下一页 ▶️
                    </button>
                    <button onclick="paginator.lastPage()" ${this.currentPage === totalPages ? 'disabled' : ''}>
                        末页 ⏭️
                    </button>
                    <select onchange="paginator.changePageSize(this.value)" style="margin-left: 15px;">
                        <option value="20" ${this.pageSize === 20 ? 'selected' : ''}>20 条/页</option>
                        <option value="50" ${this.pageSize === 50 ? 'selected' : ''}>50 条/页</option>
                        <option value="100" ${this.pageSize === 100 ? 'selected' : ''}>100 条/页</option>
                    </select>
                </div>
            </div>
        `;

        this.container.innerHTML = html;
    }

    firstPage() {
        if (this.currentPage !== 1) {
            this.currentPage = 1;
            this.onPageChange(this.currentPage, this.pageSize);
            this.render();
        }
    }

    prevPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.onPageChange(this.currentPage, this.pageSize);
            this.render();
        }
    }

    nextPage() {
        const totalPages = this.getTotalPages();
        if (this.currentPage < totalPages) {
            this.currentPage++;
            this.onPageChange(this.currentPage, this.pageSize);
            this.render();
        }
    }

    lastPage() {
        const totalPages = this.getTotalPages();
        if (this.currentPage !== totalPages) {
            this.currentPage = totalPages;
            this.onPageChange(this.currentPage, this.pageSize);
            this.render();
        }
    }

    changePageSize(newSize) {
        this.pageSize = parseInt(newSize);
        this.currentPage = 1;
        this.onPageChange(this.currentPage, this.pageSize);
        this.render();
    }
}

// ==================== 统计计算辅助函数 ====================
// NocoBase 不提供聚合 API 时，前端直接计算统计数据

/**
 * 计算日期范围字符串
 */
function getDateRange(period) {
    const now = new Date();
    let dateFrom;

    switch (period) {
        case 'day':
            dateFrom = formatDate(now, '00:00:00');
            break;
        case 'week': {
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 7);
            dateFrom = formatDate(weekAgo, '00:00:00');
            break;
        }
        case 'month':
            dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
            break;
        case 'year':
            dateFrom = `${now.getFullYear()}-01-01 00:00:00`;
            break;
        default:
            dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
    }

    const periodNames = { day: '今日', week: '近 7 天', month: '本月', year: '本年' };
    return { dateFrom, periodName: periodNames[period] || '本月' };
}

/**
 * 格式化日期
 */
function formatDate(date, timeStr = '00:00:00') {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d} ${timeStr}`;
}

/**
 * 过滤记录
 */
function filterRecords(records, { dateFrom, dateTo, type, category, account }) {
    return records.filter(r => {
        if (dateFrom && r.datetime < dateFrom) return false;
        if (dateTo && r.datetime > dateTo) return false;
        if (type && r.type !== type) return false;
        if (category && r.category !== category) return false;
        if (account && r.account !== account) return false;
        return true;
    });
}

/**
 * 按分类统计
 */
function statsByCategory(records, type) {
    const filtered = records.filter(r => r.type === type);
    const map = {};
    for (const r of filtered) {
        if (!map[r.category]) {
            map[r.category] = { category: r.category, total: 0, count: 0 };
        }
        map[r.category].total += r.amount;
        map[r.category].count += 1;
    }
    return Object.values(map).sort((a, b) => b.total - a.total);
}

/**
 * 计算总收支
 */
function calcTotals(records) {
    let incomeTotal = 0, expenseTotal = 0, incomeCount = 0, expenseCount = 0;
    for (const r of records) {
        if (r.type === '收入') {
            incomeTotal += r.amount;
            incomeCount++;
        } else {
            expenseTotal += r.amount;
            expenseCount++;
        }
    }
    return { incomeTotal, expenseTotal, incomeCount, expenseCount };
}

/**
 * 按账户统计
 */
function statsByAccount(records) {
    const byAccount = {};
    const byType = { '个人': 0, '家庭': 0, '公司': 0 };

    for (const r of records) {
        if (r.type !== '支出') continue;

        if (!byAccount[r.account]) {
            byAccount[r.account] = { account: r.account, total: 0, count: 0 };
        }
        byAccount[r.account].total += r.amount;
        byAccount[r.account].count += 1;

        // 账户类型映射
        const typeMap = { '个人': '个人', '家庭账户': '家庭', '家庭': '家庭', '公司账户': '公司', '公司': '公司' };
        const typeShort = typeMap[r.account] || '其他';
        if (byType.hasOwnProperty(typeShort)) {
            byType[typeShort] += r.amount;
        }
    }

    return {
        byAccount: Object.values(byAccount).sort((a, b) => b.total - a.total),
        byType,
        total: Object.values(byType).reduce((sum, v) => sum + v, 0)
    };
}

/**
 * 预算分析
 */
function analyzeBudget(records, period, budgetMonthly) {
    const now = new Date();
    const calendar = {
        monthRange: (y, m) => new Date(y, m + 1, 0).getDate(),
        isLeap: y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
    };

    let dateFrom, days, totalDays, totalBudget, periodName;

    switch (period) {
        case 'day':
            dateFrom = formatDate(now, '00:00:00');
            periodName = '今日';
            days = 1;
            totalDays = 1;
            totalBudget = budgetMonthly / calendar.monthRange(now.getFullYear(), now.getMonth());
            break;
        case 'week':
            dateFrom = formatDate(new Date(now.getTime() - 7 * 86400000), '00:00:00');
            periodName = '近 7 天';
            days = 7;
            totalDays = 7;
            totalBudget = budgetMonthly / 4.33;
            break;
        case 'month':
            dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
            periodName = '本月';
            days = now.getDate();
            totalDays = calendar.monthRange(now.getFullYear(), now.getMonth());
            totalBudget = budgetMonthly;
            break;
        case 'year':
            dateFrom = `${now.getFullYear()}-01-01 00:00:00`;
            periodName = '本年';
            days = Math.floor((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + 1;
            totalDays = calendar.isLeap(now.getFullYear()) ? 366 : 365;
            totalBudget = budgetMonthly * 12;
            break;
        default:
            dateFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
            periodName = '本月';
            days = now.getDate();
            totalDays = calendar.monthRange(now.getFullYear(), now.getMonth());
            totalBudget = budgetMonthly;
    }

    const remainingDays = totalDays - days + 1;
    const filtered = records.filter(r => r.type === '支出' && r.datetime >= dateFrom);
    const actualExpense = filtered.reduce((sum, r) => sum + r.amount, 0);
    const actualCount = filtered.length;

    const remaining = totalBudget - actualExpense;
    const usageRate = totalBudget > 0 ? (actualExpense / totalBudget * 100) : 0;
    const dailyAvg = days > 0 ? actualExpense / days : 0;
    const dailyRemaining = remainingDays > 0 ? remaining / remainingDays : 0;

    const byCategory = statsByCategory(filtered, '支出');

    return {
        period, periodName, days, totalDays, remainingDays,
        budgetMonthly, totalBudget, actualExpense, actualCount,
        remaining, usageRate, dailyAvg, dailyRemaining, byCategory,
        status: remaining < 0 ? '超支' : usageRate > 80 ? '紧张' : '正常'
    };
}

/**
 * 月度预算统计
 */
function monthlyBudgetStats(records, budgetMonthly) {
    // 获取所有有数据的月份
    const months = [...new Set(records
        .filter(r => r.type === '支出')
        .map(r => r.datetime.substring(0, 7))
    )].sort().reverse();

    if (months.length === 0) return { months: [], yearlySummary: null };

    const monthlyStats = [];
    let yearlyTotalBudget = 0, yearlyActualExpense = 0;

    for (const month of months) {
        const [year, mon] = month.split('-').map(Number);
        const monthStart = `${month}-01 00:00:00`;
        const monthDays = new Date(year, mon, 0).getDate();
        const monthEnd = `${month}-${String(monthDays).padStart(2, '0')} 23:59:59`;

        const monthRecords = records.filter(r =>
            r.type === '支出' && r.datetime >= monthStart && r.datetime <= monthEnd
        );
        const actualExpense = monthRecords.reduce((sum, r) => sum + r.amount, 0);
        const actualCount = monthRecords.length;

        const remaining = budgetMonthly - actualExpense;
        const usageRate = budgetMonthly > 0 ? (actualExpense / budgetMonthly * 100) : 0;
        const status = remaining < 0 ? '超支' : usageRate > 80 ? '紧张' : '正常';

        monthlyStats.push({
            month, budget: budgetMonthly, actual: actualExpense,
            remaining, usageRate: Math.round(usageRate * 10) / 10,
            count: actualCount, status
        });

        yearlyTotalBudget += budgetMonthly;
        yearlyActualExpense += actualExpense;
    }

    const yearlyRemaining = yearlyTotalBudget - yearlyActualExpense;
    const yearlyUsageRate = yearlyTotalBudget > 0 ? (yearlyActualExpense / yearlyTotalBudget * 100) : 0;

    return {
        budgetMonthly, months: monthlyStats,
        yearlySummary: {
            year: months[0].split('-')[0],
            totalBudget: yearlyTotalBudget, totalActual: yearlyActualExpense,
            remaining: yearlyRemaining,
            usageRate: Math.round(yearlyUsageRate * 10) / 10,
            status: yearlyRemaining < 0 ? '超支' : yearlyUsageRate > 80 ? '紧张' : '正常',
            monthCount: months.length
        }
    };
}

/**
 * 月度收支趋势
 */
function monthlyTrend(records, months = 6) {
    const now = new Date();
    const startMonth = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

    const map = {};
    for (const r of records) {
        const m = r.datetime.substring(0, 7);
        if (!map[m]) map[m] = { month: m, income: 0, expense: 0 };
        if (r.type === '收入') map[m].income += r.amount;
        else map[m].expense += r.amount;
    }

    const result = [];
    const current = new Date(startMonth);
    while (current <= now) {
        const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
        result.push(map[key] || { month: key, income: 0, expense: 0 });
        current.setMonth(current.getMonth() + 1);
    }

    return result;
}

/**
 * 本月 vs 上月对比
 */
function comparison(records) {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    let currentIncome = 0, currentExpense = 0, prevIncome = 0, prevExpense = 0;

    for (const r of records) {
        const m = r.datetime.substring(0, 7);
        if (m === currentMonth) {
            if (r.type === '收入') currentIncome += r.amount;
            else currentExpense += r.amount;
        } else if (m === prevMonth) {
            if (r.type === '收入') prevIncome += r.amount;
            else prevExpense += r.amount;
        }
    }

    return {
        current: { label: '本月', income: currentIncome, expense: currentExpense, balance: currentIncome - currentExpense },
        previous: { label: '上月', income: prevIncome, expense: prevExpense, balance: prevIncome - prevExpense }
    };
}

/**
 * 消费热力图数据
 */
function heatmapData(records, months = 3) {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(startDate.getDate() - months * 30);

    // 按日期聚合支出
    const expenseMap = {};
    for (const r of records) {
        if (r.type !== '支出') continue;
        const date = r.datetime.substring(0, 10);
        expenseMap[date] = (expenseMap[date] || 0) + r.amount;
    }

    // 生成连续日期
    const days = [];
    const current = new Date(startDate);
    current.setHours(0, 0, 0, 0);

    while (current <= now) {
        const dateStr = formatDate(current, '00:00:00').substring(0, 10);
        const amount = expenseMap[dateStr] || 0;
        days.push({ date: dateStr, amount, level: amount === 0 ? 0 : 1 });
        current.setDate(current.getDate() + 1);
    }

    // 计算分级阈值
    const amounts = days.filter(d => d.amount > 0).map(d => d.amount).sort((a, b) => a - b);
    let thresholds = [0, 0, 0];
    if (amounts.length > 0) {
        const q1 = amounts[Math.floor(amounts.length / 4)] || 0;
        const q2 = amounts[Math.floor(amounts.length / 2)] || 0;
        const q3 = amounts[Math.floor(amounts.length * 3 / 4)] || 0;
        thresholds = [q1, q2, q3];
    }

    // 重新计算级别
    for (const d of days) {
        if (d.amount === 0) d.level = 0;
        else if (d.amount <= thresholds[0]) d.level = 1;
        else if (d.amount <= thresholds[1]) d.level = 2;
        else if (d.amount <= thresholds[2]) d.level = 3;
        else d.level = 4;
    }

    // 月份标签
    const monthLabels = [];
    const monthStart = new Date(startDate);
    monthStart.setDate(1);
    while (monthStart <= now) {
        const key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
        const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
        const width = monthStart.getMonth() === now.getMonth() ? now.getDate() : daysInMonth;
        monthLabels.push({ name: key, width });
        monthStart.setMonth(monthStart.getMonth() + 1);
    }

    return { days, months: monthLabels };
}

// 全局导出
window.formatMoney = formatMoney;
window.formatDatetime = formatDatetime;
window.setActiveNav = setActiveNav;
window.Paginator = Paginator;
window.PaginatorInstance = null; // 兼容旧代码
window.formatDate = formatDate;
window.getDateRange = getDateRange;
window.filterRecords = filterRecords;
window.statsByCategory = statsByCategory;
window.calcTotals = calcTotals;
window.statsByAccount = statsByAccount;
window.analyzeBudget = analyzeBudget;
window.monthlyBudgetStats = monthlyBudgetStats;
window.monthlyTrend = monthlyTrend;
window.comparison = comparison;
window.heatmapData = heatmapData;
