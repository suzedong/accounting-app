/**
 * Agent 核心：LLM 意图识别 + Skill 执行 + 学习闭环
 */

const AgentCore = (function () {
    // ==================== 意图识别 ====================

    async function dispatch(text) {
        try {
            const learningContext = LearningEngine ? LearningEngine.getPromptContext() : '';

            const response = await fetch('/api/ai/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, learning_context: learningContext })
            });

            if (!response.ok) {
                throw new Error(`dispatch 请求失败 (${response.status})`);
            }

            const result = await response.json();

            // 验证返回结果
            if (!result.intent) {
                throw new Error('LLM 返回缺少 intent 字段');
            }

            return result;
        } catch (error) {
            console.error('[Agent] 意图识别失败:', error.message);
            // 降级：尝试用规则解析做记账
            return {
                intent: 'record',
                confidence: 0.5,
                fallback: true,
                fields: await fallbackParse(text)
            };
        }
    }

    /**
     * 降级方案：使用规则解析
     */
    async function fallbackParse(text) {
        if (typeof parseInput === 'function') {
            try {
                const result = await parseInput(text);
                return result.data || {};
            } catch (e) {
                console.warn('[Agent] 规则解析降级失败:', e);
            }
        }
        return {};
    }

    // ==================== Skill 执行 ====================

    async function execute(dispatchResult) {
        const { intent, confidence, params, fields, response } = dispatchResult;

        switch (intent) {
            case 'record':
                return executeRecord(fields, confidence, dispatchResult._inputText);
            case 'query':
                return executeQuery(params || {});
            case 'stats':
                return executeStats(params || {});
            case 'budget':
                return executeBudget();
            case 'prompt':
                return executePromptUpdate(params || {}, dispatchResult._inputText);
            case 'chitchat':
                return { type: 'text', content: response || '你好！我是你的 AI 记账助手，请告诉我你的收支情况。' };
            default:
                return {
                    type: 'text',
                    content: '抱歉，我没理解你的意思。你可以试试说："今天吃饭花了30元" 或 "帮我查本月支出"。'
                };
        }
    }

    /**
     * 记账 Skill
     */
    async function executeRecord(fields, confidence, inputText) {
        // 应用学习数据的本地修正
        if (typeof LearningEngine !== 'undefined' && inputText) {
            const localCorrections = LearningEngine.getCorrectionsForInput(inputText);
            if (localCorrections.category && fields.category !== localCorrections.category) {
                fields.category = localCorrections.category;
            }
            if (localCorrections.payment && fields.payment !== localCorrections.payment) {
                fields.payment = localCorrections.payment;
            }
        }

        // 高置信度直接保存，低置信度弹确认
        const threshold = 0.85;

        if (confidence >= threshold) {
            return { type: 'auto-save', fields, confidence };
        }

        return { type: 'confirm', fields, confidence };
    }

    /**
     * 查询 Skill
     */
    async function executeQuery(params) {
        try {
            if (typeof NocobaseAPI === 'undefined') {
                return { type: 'text', content: 'API 未加载，请稍后重试。' };
            }

            const dateRange = buildDateRange(params.timeRange || 'month');
            const result = await NocobaseAPI.getRecordsForStats(dateRange.from, dateRange.to);
            const records = result.data || [];

            if (records.length === 0) {
                return { type: 'text', content: `${dateRange.label}暂无记录。` };
            }

            // 按类型过滤
            let filtered = records;
            if (params.type === 'expense') filtered = records.filter(r => r.type === '支出');
            else if (params.type === 'income') filtered = records.filter(r => r.type === '收入');

            if (filtered.length === 0) {
                return { type: 'text', content: `${dateRange.label}暂无${params.type === 'expense' ? '支出' : '收入'}记录。` };
            }

            const totals = calcTotals ? calcTotals(filtered) : { incomeTotal: 0, expenseTotal: 0 };
            const summary = `${dateRange.label}共 ${filtered.length} 笔记录` +
                (totals.expenseTotal > 0 ? `，支出 ${formatMoney(totals.expenseTotal)}` : '') +
                (totals.incomeTotal > 0 ? `，收入 ${formatMoney(totals.incomeTotal)}` : '') + '。';

            // 最近 5 条
            const recent = filtered.slice(0, 5).map(r =>
                `${r.datetime ? r.datetime.substring(5, 16) : ''} ${r.type === '支出' ? '支出' : '收入'} ${formatMoney(r.amount)} ${r.category || ''}${r.note ? ' - ' + r.note : ''}`
            ).join('\n');

            return {
                type: 'query-result',
                content: summary,
                details: recent,
                total: filtered.length
            };
        } catch (error) {
            return { type: 'text', content: '查询失败：' + error.message };
        }
    }

    /**
     * 统计 Skill
     */
    async function executeStats(params) {
        try {
            if (typeof NocobaseAPI === 'undefined') {
                return { type: 'text', content: 'API 未加载，请稍后重试。' };
            }

            const dateRange = buildDateRange(params.timeRange || 'month');
            const result = await NocobaseAPI.getRecordsForStats(dateRange.from, dateRange.to);
            const records = result.data || [];

            if (records.length === 0) {
                return { type: 'text', content: `${dateRange.label}暂无数据，无法统计。` };
            }

            const type = params.type === 'income' ? '收入' : '支出';

            switch (params.dimension) {
                case 'category': {
                    const stats = statsByCategory ? statsByCategory(records, type) : [];
                    const total = stats.reduce((sum, s) => sum + s.total, 0);
                    const lines = stats.slice(0, 8).map(s => {
                        const pct = total > 0 ? (s.total / total * 100).toFixed(1) : 0;
                        const bar = '█'.repeat(Math.round(pct / 5));
                        return `${s.category} ${formatMoney(s.total)} (${pct}%) ${bar}`;
                    });
                    return {
                        type: 'stats-result',
                        title: `${dateRange.label}${type}分类统计`,
                        content: lines.join('\n')
                    };
                }
                case 'account': {
                    const stats = statsByAccount ? statsByAccount(records) : { byAccount: [] };
                    const lines = stats.byAccount.slice(0, 5).map(s =>
                        `${s.account} ${formatMoney(s.total)} (${s.count}笔)`
                    );
                    return {
                        type: 'stats-result',
                        title: `${dateRange.label}账户统计`,
                        content: lines.join('\n')
                    };
                }
                case 'comparison': {
                    if (typeof comparison === 'function') {
                        const comp = comparison(records);
                        return {
                            type: 'stats-result',
                            title: '本月 vs 上月对比',
                            content: `本月: 收入${formatMoney(comp.current.income)} 支出${formatMoney(comp.current.expense)}\n上月: 收入${formatMoney(comp.previous.income)} 支出${formatMoney(comp.previous.expense)}`
                        };
                    }
                    break;
                }
                case 'trend': {
                    if (typeof monthlyTrend === 'function') {
                        const trend = monthlyTrend(records, 6);
                        const lines = trend.map(m =>
                            `${m.month} 收入${formatMoney(m.income)} 支出${formatMoney(m.expense)}`
                        );
                        return {
                            type: 'stats-result',
                            title: '月度收支趋势',
                            content: lines.join('\n')
                        };
                    }
                    break;
                }
                default: {
                    // 默认显示分类统计
                    const stats = statsByCategory ? statsByCategory(records, type) : [];
                    const total = stats.reduce((sum, s) => sum + s.total, 0);
                    const lines = stats.slice(0, 8).map(s => {
                        const pct = total > 0 ? (s.total / total * 100).toFixed(1) : 0;
                        return `${s.category} ${formatMoney(s.total)} (${pct}%)`;
                    });
                    return {
                        type: 'stats-result',
                        title: `${dateRange.label}${type}统计`,
                        content: lines.join('\n')
                    };
                }
            }
        } catch (error) {
            return { type: 'text', content: '统计失败：' + error.message };
        }
    }

    /**
     * 预算 Skill
     */
    async function executeBudget() {
        try {
            if (typeof NocobaseAPI === 'undefined' || typeof analyzeBudget === 'undefined') {
                return { type: 'text', content: 'API 未加载，请稍后重试。' };
            }

            const budgetMonthly = NOCOBASE_CONFIG ? NOCOBASE_CONFIG.BUDGET_MONTHLY : 3500;
            const result = await NocobaseAPI.getRecordsForStats(
                `${new Date().getFullYear()}-01-01 00:00:00`,
                null
            );
            const records = result.data || [];

            const analysis = analyzeBudget(records, 'month', budgetMonthly);
            const statusEmoji = analysis.status === '超支' ? '🚨' : analysis.status === '紧张' ? '⚠️' : '✅';

            const lines = [
                `${statusEmoji} ${analysis.periodName}预算状态：${analysis.status}`,
                `预算：${formatMoney(analysis.totalBudget)}  已用：${formatMoney(analysis.actualExpense)}`,
                `剩余：${formatMoney(analysis.remaining)}  使用率：${analysis.usageRate.toFixed(1)}%`,
                `日均消费：${formatMoney(analysis.dailyAvg)}  剩余${analysis.remainingDays}天  每日可用：${formatMoney(analysis.dailyRemaining)}`
            ];

            return {
                type: 'budget-result',
                title: '预算状态',
                content: lines.join('\n'),
                data: analysis
            };
        } catch (error) {
            return { type: 'text', content: '预算查询失败：' + error.message };
        }
    }

    /**
     * Prompt 修改 Skill
     */
    async function executePromptUpdate(params, inputText) {
        try {
            const promptName = params.promptName || 'dispatch';
            const newContent = params.content;

            if (!newContent) {
                return { type: 'text', content: '请提供要更新的 prompt 内容。' };
            }

            const response = await fetch(`/api/ai/prompt/${promptName}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: newContent })
            });

            if (!response.ok) {
                const err = await response.json();
                return { type: 'text', content: 'Prompt 更新失败：' + (err.error || '未知错误') };
            }

            const result = await response.json();
            return { type: 'text', content: `Prompt 已更新：${result.file}` };
        } catch (error) {
            return { type: 'text', content: 'Prompt 更新失败：' + error.message };
        }
    }

    // ==================== 辅助函数 ====================

    function buildDateRange(timeRange) {
        const now = new Date();
        let from, to, label;

        switch (timeRange) {
            case 'today':
                from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 00:00:00`;
                to = null;
                label = '今天';
                break;
            case 'yesterday': {
                const y = new Date(now);
                y.setDate(y.getDate() - 1);
                from = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')} 00:00:00`;
                to = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')} 23:59:59`;
                label = '昨天';
                break;
            }
            case 'week': {
                const w = new Date(now);
                w.setDate(w.getDate() - 7);
                from = `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')} 00:00:00`;
                to = null;
                label = '近 7 天';
                break;
            }
            case 'last_month': {
                const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
                from = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
                to = `${lmEnd.getFullYear()}-${String(lmEnd.getMonth() + 1).padStart(2, '0')}-${String(lmEnd.getDate()).padStart(2, '0')} 23:59:59`;
                label = '上月';
                break;
            }
            default: // month
                from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
                to = null;
                label = '本月';
        }

        return { from, to, label };
    }

    // ==================== 学习 ====================

    function learn(inputText, originalFields, correctedFields) {
        if (typeof LearningEngine !== 'undefined') {
            LearningEngine.recordCorrection(inputText, originalFields, correctedFields);
        }
    }

    return {
        dispatch,
        execute,
        learn,
        updatePrompt: executePromptUpdate
    };
})();
