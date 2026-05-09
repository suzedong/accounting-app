/**
 * Agent 核心：LLM 意图识别 + Skill 执行 + 学习闭环
 */

import { getPromptContext, getCorrectionsForInput, recordCorrection as learnCorrection } from './learning-engine.js';
import * as NocobaseAPI from './nocobase-api.js';
import { parseInput } from './parse.js';
import { NOCOBASE_CONFIG } from './config.js';
import { calcTotals, statsByCategory, statsByAccount, comparison, monthlyTrend, analyzeBudget, formatMoney } from './utils.js';
    // ==================== 意图识别 ====================

    async function dispatch(text, conversationHistory = []) {
        try {
            const learningContext = getPromptContext();

            const response = await fetch('/api/ai/dispatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, learning_context: learningContext, conversation_history: conversationHistory })
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
        try {
            const result = await parseInput(text);
            return result.data || {};
        } catch (e) {
            console.warn('[Agent] 规则解析降级失败:', e);
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
                return executeQuery(params || {}, confidence);
            case 'stats':
                return executeStats(params || {}, confidence);
            case 'budget':
                return executeBudget(confidence);
            case 'prompt':
                return executePromptUpdate(params || {}, dispatchResult._inputText);
            case 'data_query':
                return executeDataQuery(params || {}, confidence);
            case 'create-skill':
                return executeCreateSkill(params || {}, dispatchResult._inputText);
            case 'chitchat':
                return { type: 'text', content: response || '你好！我是你的 AI 记账助手，请告诉我你的收支情况。', _skill: { name: 'chitchat', displayName: '闲聊', confidence } };
            case 'follow_up':
                return executeFollowUp(dispatchResult.follow_up || {}, confidence);
            default:
                return {
                    type: 'text',
                    content: '抱歉，我没理解你的意思。你可以试试说："今天吃饭花了30元" 或 "帮我查本月支出"。',
                    _skill: { name: 'unknown', displayName: '未知', confidence: 0 }
                };
        }
    }

    /**
     * 记账 Skill
     */
    async function executeRecord(fields, confidence, inputText) {
        // 应用学习数据的本地修正
        if (inputText) {
            const localCorrections = getCorrectionsForInput(inputText);
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
            return { type: 'auto-save', fields, confidence, _skill: { name: 'record', displayName: '记账', confidence } };
        }

        return { type: 'confirm', fields, confidence, _skill: { name: 'record', displayName: '记账', confidence } };
    }

    /**
     * 查询 Skill
     */
    async function executeQuery(params, confidence) {
        try {
            const dateRange = buildDateRange(params.timeRange || 'month');
            const result = await NocobaseAPI.getRecordsForStats(dateRange.from, dateRange.to);
            const records = result.data || [];

            if (records.length === 0) {
                return { type: 'text', content: `${dateRange.label}暂无记录。`, _skill: { name: 'query', displayName: '查询记录', confidence } };
            }

            // 按类型过滤
            let filtered = records;
            if (params.type === 'expense') filtered = records.filter(r => r.type === '支出');
            else if (params.type === 'income') filtered = records.filter(r => r.type === '收入');

            if (filtered.length === 0) {
                return { type: 'text', content: `${dateRange.label}暂无${params.type === 'expense' ? '支出' : '收入'}记录。`, _skill: { name: 'query', displayName: '查询记录', confidence } };
            }

            const totals = calcTotals(filtered);
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
                total: filtered.length,
                _skill: { name: 'query', displayName: '查询记录', confidence }
            };
        } catch (error) {
            return { type: 'text', content: '查询失败：' + error.message, _skill: { name: 'query', displayName: '查询记录', confidence } };
        }
    }

    /**
     * 统计 Skill
     */
    async function executeStats(params, confidence) {
        try {
            const dateRange = buildDateRange(params.timeRange || 'month');
            const result = await NocobaseAPI.getRecordsForStats(dateRange.from, dateRange.to);
            const records = result.data || [];

            if (records.length === 0) {
                return { type: 'text', content: `${dateRange.label}暂无数据，无法统计。`, _skill: { name: 'stats', displayName: '统计分析', confidence } };
            }

            const type = params.type === 'income' ? '收入' : '支出';

            switch (params.dimension) {
                case 'category': {
                    const stats = statsByCategory(records, type);
                    const total = stats.reduce((sum, s) => sum + s.total, 0);
                    const lines = stats.slice(0, 8).map(s => {
                        const pct = total > 0 ? (s.total / total * 100).toFixed(1) : 0;
                        const bar = '█'.repeat(Math.round(pct / 5));
                        return `${s.category} ${formatMoney(s.total)} (${pct}%) ${bar}`;
                    });
                    return {
                        type: 'stats-result',
                        title: `${dateRange.label}${type}分类统计`,
                        content: lines.join('\n'),
                        _skill: { name: 'stats', displayName: '统计分析', confidence }
                    };
                }
                case 'account': {
                    const stats = statsByAccount(records);
                    const lines = stats.byAccount.slice(0, 5).map(s =>
                        `${s.account} ${formatMoney(s.total)} (${s.count}笔)`
                    );
                    return {
                        type: 'stats-result',
                        title: `${dateRange.label}账户统计`,
                        content: lines.join('\n'),
                        _skill: { name: 'stats', displayName: '统计分析', confidence }
                    };
                }
                case 'comparison': {
                    const comp = comparison(records);
                    return {
                        type: 'stats-result',
                        title: '本月 vs 上月对比',
                        content: `本月: 收入${formatMoney(comp.current.income)} 支出${formatMoney(comp.current.expense)}\n上月: 收入${formatMoney(comp.previous.income)} 支出${formatMoney(comp.previous.expense)}`,
                        _skill: { name: 'stats', displayName: '统计分析', confidence }
                    };
                }
                case 'trend': {
                    const trend = monthlyTrend(records, 6);
                    const lines = trend.map(m =>
                        `${m.month} 收入${formatMoney(m.income)} 支出${formatMoney(m.expense)}`
                    );
                    return {
                        type: 'stats-result',
                        title: '月度收支趋势',
                        content: lines.join('\n'),
                        _skill: { name: 'stats', displayName: '统计分析', confidence }
                    };
                }
                default: {
                    const stats = statsByCategory(records, type);
                    const total = stats.reduce((sum, s) => sum + s.total, 0);
                    const lines = stats.slice(0, 8).map(s => {
                        const pct = total > 0 ? (s.total / total * 100).toFixed(1) : 0;
                        return `${s.category} ${formatMoney(s.total)} (${pct}%)`;
                    });
                    return {
                        type: 'stats-result',
                        title: `${dateRange.label}${type}统计`,
                        content: lines.join('\n'),
                        _skill: { name: 'stats', displayName: '统计分析', confidence }
                    };
                }
            }
        } catch (error) {
            return { type: 'text', content: '统计失败：' + error.message, _skill: { name: 'stats', displayName: '统计分析', confidence } };
        }
    }

    /**
     * 预算 Skill
     */
    async function executeBudget(confidence) {
        try {
            const budgetMonthly = NOCOBASE_CONFIG.BUDGET_MONTHLY;
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
                data: analysis,
                _skill: { name: 'budget', displayName: '预算管理', confidence }
            };
        } catch (error) {
            return { type: 'text', content: '预算查询失败：' + error.message, _skill: { name: 'budget', displayName: '预算管理', confidence } };
        }
    }

    /**
     * 追问 Skill — 信息不完整时要求用户补充
     */
    async function executeFollowUp(followUpData, confidence) {
        return {
            type: 'follow-up',
            followUp: followUpData,
            _skill: { name: 'follow_up', displayName: '追问补充', confidence }
        };
    }

    /**
     * 通用 Collection 查询 Skill
     */
    async function executeDataQuery(params, confidence) {
        try {
            const collection = params.collection;
            if (!collection) {
                return { type: 'text', content: '无法识别要查询的数据。', _skill: { name: `list_${params.collection || 'unknown'}`, displayName: '数据查询', confidence } };
            }

            // 检查是否已注册为该 Collection 的专用动态 Skill
            const skillName = `list_${collection}`;
            const dynamicSkill = getDynamicSkill(skillName);
            const displayName = dynamicSkill ? dynamicSkill.displayName : '数据查询';

            const options = params.query || { pageSize: 20, sort: '-created_at' };
            const result = await NocobaseAPI.getCollection(collection, options);
            const items = result.data || [];

            if (items.length === 0) {
                return { type: 'text', content: `${params.label || collection}暂无数据。`, _skill: { name: skillName, displayName, confidence } };
            }

            const fields = params.fields || Object.keys(items[0] || {});
            const displayFields = fields.filter(f => !f.startsWith('created') && !f.startsWith('updated') && f !== 'id');

            // 格式化输出
            const lines = items.slice(0, 15).map(item => {
                return displayFields.map(f => {
                    const val = item[f];
                    if (val !== null && val !== undefined && val !== '') {
                        return `${f}: ${val}`;
                    }
                    return null;
                }).filter(Boolean).join(' | ');
            });

            const summary = `共 ${items.length} 条${params.label || collection}：`;

            return {
                type: 'collection-list',
                content: summary,
                details: lines.join('\n'),
                total: items.length,
                _skill: { name: skillName, displayName, confidence }
            };
        } catch (error) {
            return { type: 'text', content: '数据查询失败：' + error.message, _skill: { name: 'data_query', displayName: '数据查询', confidence } };
        }
    }

    /**
     * 创建动态 Skill
     */
    async function executeCreateSkill(params, inputText) {
        try {
            const skillDef = params.skill || {};
            const name = skillDef.name || `skill_${Date.now()}`;

            if (!skillDef.collection) {
                return { type: 'text', content: '创建 Skill 失败：缺少 collection 字段。' };
            }

            // 注册到 localStorage
            const key = 'accounting_dynamic_skills';
            let skills = {};
            try {
                const saved = localStorage.getItem(key);
                if (saved) skills = JSON.parse(saved);
            } catch (e) {}

            skills[name] = {
                name: name,
                displayName: skillDef.displayName || name,
                description: skillDef.description || '',
                collection: skillDef.collection,
                query: skillDef.query || { pageSize: 20 },
                fields: skillDef.fields || [],
                displayFormat: skillDef.displayFormat || '列表',
                triggerKeywords: skillDef.triggerKeywords || [],
                createdAt: new Date().toISOString()
            };

            localStorage.setItem(key, JSON.stringify(skills));

            return {
                type: 'text',
                content: `✅ 已创建 Skill「${skills[name].displayName}」，现在可以查询「${skillDef.collection}」了。`
            };
        } catch (error) {
            return { type: 'text', content: 'Skill 创建失败：' + error.message };
        }
    }

    /**
     * 获取已注册的动态 Skill
     */
    function getDynamicSkill(name) {
        try {
            const saved = localStorage.getItem('accounting_dynamic_skills');
            if (saved) {
                const skills = JSON.parse(saved);
                return skills[name] || null;
            }
        } catch (e) {}
        return null;
    }

    /**
     * 获取所有动态 Skill 列表（用于注入 dispatch prompt）
     */
    function getDynamicSkillsList() {
        try {
            const saved = localStorage.getItem('accounting_dynamic_skills');
            if (saved) return JSON.parse(saved);
        } catch (e) {}
        return {};
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
        learnCorrection(inputText, originalFields, correctedFields);
    }

export {
    dispatch,
    execute,
    learn,
    executePromptUpdate as updatePrompt,
    getDynamicSkillsList,
    getDynamicSkill
};
