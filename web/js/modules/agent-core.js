/**
 * Agent 核心：LLM 意图识别 + Skill 执行 + 学习闭环
 * LLM 返回统一格式: { action, params, render, title, confidence }
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

        const body = {
            text,
            learning_context: learningContext,
            conversation_history: conversationHistory
        };

        const response = await fetch('/api/ai/dispatch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            let errorDetail = `HTTP ${response.status}`;
            try {
                const errText = await response.text();
                if (errText) {
                    errorDetail += `: ${errText.substring(0, 500)}`;
                }
            } catch (e) { /* 忽略 */ }
            throw new Error(`dispatch 请求失败 (${errorDetail})`);
        }

        const result = await response.json();

        if (!result.action) {
            throw new Error('LLM 返回缺少 action 字段');
        }

        // 确保 params 存在
        if (!result.params) {
            result.params = {};
        }

        // 默认 render 和 title
        if (!result.render) {
            result.render = DEFAULT_RENDER[result.action] || 'text';
        }
        if (!result.title) {
            result.title = DEFAULT_TITLE[result.action] || '';
        }
        // 设置 _skill 供前端显示
        if (!result._skill) {
            result._skill = {
                name: result.action,
                displayName: DEFAULT_TITLE[result.action] || result.action,
                confidence: result.confidence
            };
        }

        return result;
    } catch (error) {
        console.error('[Agent] 意图识别失败:', error.message);
        return {
            action: 'create_record',
            confidence: 0.5,
            fallback: true,
            _error_detail: error.message,
            params: { fields: await fallbackParse(text) },
            render: 'card',
            title: '记账',
            _skill: { name: 'create_record', displayName: '记账', confidence: 0.5 }
        };
    }
}

/**
 * 各 action 的默认 render 类型
 */
const DEFAULT_RENDER = {
    'create_record': 'card',
    'query_records': 'list',
    'render_stats': 'chart',
    'render_budget': 'chart',
    'query_collection': 'table',
    'correct_record': 'text',
    'save_preference': 'text',
    'update_prompt': 'text',
    'ask_follow_up': 'text',
    'reply_text': 'text',
    'create_skill': 'text'
};

/**
 * 各 action 的默认标题
 */
const DEFAULT_TITLE = {
    'create_record': '记账',
    'query_records': '查询记录',
    'render_stats': '统计分析',
    'render_budget': '预算管理',
    'query_collection': '数据查询',
    'correct_record': '纠正记录',
    'save_preference': '偏好设置',
    'update_prompt': '规则更新',
    'ask_follow_up': '追问补充',
    'reply_text': '闲聊',
    'create_skill': '创建能力'
};

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

/**
 * Action 注册表
 * 新增能力只需在此注册一个 handler
 */
const actionHandlers = {
    'create_record': handleCreateRecord,
    'query_records': handleQueryRecords,
    'render_stats': handleRenderStats,
    'render_budget': handleRenderBudget,
    'query_collection': handleQueryCollection,
    'correct_record': handleCorrectRecord,
    'save_preference': handleSavePreference,
    'update_prompt': handleUpdatePrompt,
    'ask_follow_up': handleAskFollowUp,
    'reply_text': handleReplyText,
    'create_skill': handleCreateSkill,
};

/**
 * 统一执行器：根据 action 查找 handler 并执行
 */
async function execute(dispatchResult) {
    const { action, confidence, params } = dispatchResult;

    const handler = actionHandlers[action];
    if (handler) {
        return await handler(params, dispatchResult);
    }

    // 未知 action
    console.warn(`[Agent] 未知 action: ${action}`);
    return {
        type: 'text',
        content: '抱歉，我没理解你的意思。你可以试试说："今天吃饭花了30元" 或 "帮我查本月支出"。',
        _skill: { name: 'unknown', displayName: '未知', confidence: 0 }
    };
}

// ==================== Action Handlers ====================

/**
 * create_record — 创建记账记录
 */
async function handleCreateRecord(params, dispatchResult) {
    const fields = params.fields || {};
    const confidence = dispatchResult.confidence || 0;
    const inputText = dispatchResult._inputText || '';

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

    const threshold = 0.85;
    if (confidence >= threshold) {
        return { type: 'auto-save', fields, confidence, _skill: { name: 'create_record', displayName: '记账', confidence } };
    }

    return { type: 'confirm', fields, confidence, _skill: { name: 'create_record', displayName: '记账', confidence } };
}

/**
 * query_records — 查询记账记录列表
 */
async function handleQueryRecords(params, dispatchResult) {
    const confidence = dispatchResult.confidence || 0;
    try {
        const dateRange = buildDateRange(params.timeRange || 'month');
        const result = await NocobaseAPI.getRecordsForStats(dateRange.from, dateRange.to);
        const records = result.data || [];

        if (records.length === 0) {
            return { type: 'text', content: `${dateRange.label}暂无记录。`, _skill: { name: 'query_records', displayName: '查询记录', confidence } };
        }

        let filtered = records;
        if (params.type === 'expense') filtered = records.filter(r => r.type === '支出');
        else if (params.type === 'income') filtered = records.filter(r => r.type === '收入');
        if (params.category) filtered = filtered.filter(r => r.category === params.category);
        if (params.account) filtered = filtered.filter(r => r.account === params.account);

        if (filtered.length === 0) {
            return { type: 'text', content: `${dateRange.label}暂无${params.type === 'expense' ? '支出' : '收入'}记录。`, _skill: { name: 'query_records', displayName: '查询记录', confidence } };
        }

        const totals = calcTotals(filtered);
        const summary = `${dateRange.label}共 ${filtered.length} 笔记录` +
            (totals.expenseTotal > 0 ? `，支出 ${formatMoney(totals.expenseTotal)}` : '') +
            (totals.incomeTotal > 0 ? `，收入 ${formatMoney(totals.incomeTotal)}` : '') + '。';

        const limit = params.limit || 5;
        const recent = filtered.slice(0, limit).map(r =>
            `${r.datetime ? r.datetime.substring(5, 16) : ''} ${r.type === '支出' ? '支出' : '收入'} ${formatMoney(r.amount)} ${r.category || ''}${r.note ? ' - ' + r.note : ''}`
        ).join('\n');

        return {
            type: 'query-result',
            content: summary,
            details: recent,
            total: filtered.length,
            _skill: { name: 'query_records', displayName: '查询记录', confidence }
        };
    } catch (error) {
        return { type: 'text', content: '查询失败：' + error.message, _skill: { name: 'query_records', displayName: '查询记录', confidence } };
    }
}

/**
 * render_stats — 渲染统计结果
 */
async function handleRenderStats(params, dispatchResult) {
    const confidence = dispatchResult.confidence || 0;
    try {
        const dateRange = buildDateRange(params.timeRange || 'month');
        const result = await NocobaseAPI.getRecordsForStats(dateRange.from, dateRange.to);
        const records = result.data || [];

        if (records.length === 0) {
            return { type: 'text', content: `${dateRange.label}暂无数据，无法统计。`, _skill: { name: 'render_stats', displayName: '统计分析', confidence } };
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
                    _skill: { name: 'render_stats', displayName: '统计分析', confidence }
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
                    _skill: { name: 'render_stats', displayName: '统计分析', confidence }
                };
            }
            case 'comparison': {
                const comp = comparison(records);
                return {
                    type: 'stats-result',
                    title: '本月 vs 上月对比',
                    content: `本月: 收入${formatMoney(comp.current.income)} 支出${formatMoney(comp.current.expense)}\n上月: 收入${formatMoney(comp.previous.income)} 支出${formatMoney(comp.previous.expense)}`,
                    _skill: { name: 'render_stats', displayName: '统计分析', confidence }
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
                    _skill: { name: 'render_stats', displayName: '统计分析', confidence }
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
                    _skill: { name: 'render_stats', displayName: '统计分析', confidence }
                };
            }
        }
    } catch (error) {
        return { type: 'text', content: '统计失败：' + error.message, _skill: { name: 'render_stats', displayName: '统计分析', confidence } };
    }
}

/**
 * render_budget — 渲染预算状态
 */
async function handleRenderBudget(params, dispatchResult) {
    const confidence = dispatchResult.confidence || 0;
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
            _skill: { name: 'render_budget', displayName: '预算管理', confidence }
        };
    } catch (error) {
        return { type: 'text', content: '预算查询失败：' + error.message, _skill: { name: 'render_budget', displayName: '预算管理', confidence } };
    }
}

/**
 * query_collection — 查询任意 Collection
 */
async function handleQueryCollection(params, dispatchResult) {
    const confidence = dispatchResult.confidence || 0;
    try {
        const collection = params.collection;
        if (!collection) {
            return { type: 'text', content: '无法识别要查询的数据。', _skill: { name: 'query_collection', displayName: '数据查询', confidence } };
        }

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
        return { type: 'text', content: '数据查询失败：' + error.message, _skill: { name: 'query_collection', displayName: '数据查询', confidence } };
    }
}

/**
 * correct_record — 纠正上一条记录
 */
async function handleCorrectRecord(params, dispatchResult) {
    const confidence = dispatchResult.confidence || 0;
    const note = params.note || '';
    try {
        const fields = params.fields || {};
        if (Object.keys(fields).length === 0) {
            return { type: 'text', content: '没有发现需要修正的字段。' };
        }

        let recordId = window.__lastSavedRecordId;

        // 如果没有最近保存的记录 ID，尝试通过搜索定位
        if (!recordId) {
            // 优先使用 LLM 提取的 context
            const ctx = params.context || null;
            if (ctx && (ctx.datetime || ctx.amount || ctx.note)) {
                recordId = await findRecordByContext(ctx);
            }
            if (!recordId) {
                recordId = await findRecordByContext(dispatchResult);
            }
            if (!recordId) {
                return { type: 'text', content: '找不到对应的记录，无法修正。请提供记录的时间、金额等更多信息。' };
            }
        }

        const fieldMapping = {
            'category': 'category',
            'account': 'account',
            'payment': 'payment_method',
            'payment_method': 'payment_method',
            'amount': 'amount',
            'type': 'type',
            'note': 'note',
            'datetime': 'datetime'
        };

        const updateData = {};
        for (const [key, value] of Object.entries(fields)) {
            const nocobaseKey = fieldMapping[key] || key;
            updateData[nocobaseKey] = value;
        }

        const updateResponse = await fetch(`/api/records/${recordId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });

        if (!updateResponse.ok) {
            const err = await updateResponse.json();
            return { type: 'text', content: '记录更新失败：' + (err.error || '未知错误') };
        }

        let preferenceMsg = '';
        if (note) {
            const readResponse = await fetch('/api/ai/preference', { method: 'GET' });
            const currentData = readResponse.ok ? await readResponse.json() : { content: '' };
            const oldContent = currentData.content || '';
            const newContent = oldContent + '\n- ' + note;
            const writeResponse = await fetch('/api/ai/preference', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: newContent })
            });
            if (writeResponse.ok) {
                preferenceMsg = ' 同时已记住你的习惯。';
            }
        }

        const changedFields = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join('、');
        return {
            type: 'correction-applied',
            content: `已修正记录：${changedFields}.${preferenceMsg}`,
            fields,
            recordId,
            _skill: { name: 'correct_record', displayName: '纠正记录', confidence }
        };
    } catch (error) {
        return { type: 'text', content: '纠正失败：' + error.message };
    }
}

/**
 * save_preference — 保存用户偏好
 */
async function handleSavePreference(params, dispatchResult) {
    const { section, key, value } = params;

    if (!key || !value) {
        return { type: 'text', content: '无法识别你的偏好，请说得更具体一些。' };
    }

    const readResponse = await fetch('/api/ai/preference', { method: 'GET' });
    const currentData = readResponse.ok ? await readResponse.json() : { content: '' };
    const oldContent = currentData.content || '';

    const newContent = updatePreferenceContent(oldContent, section, key, value);

    const writeResponse = await fetch('/api/ai/preference', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent })
    });

    if (!writeResponse.ok) {
        const err = await writeResponse.json();
        return { type: 'text', content: '偏好保存失败：' + (err.error || '未知错误') };
    }

    const confirmMessages = {
        noteFormat: `已记住，以后备注会${value}。`,
        defaultAccount: `已记住，以后默认使用「${value}」账户。`,
        defaultPayment: `已记住，以后默认使用「${value}」支付。`,
        categoryDefault: `已记住，以后这类消费会默认归类到「${value}」。`
    };
    const message = confirmMessages[section] || `已记住你的偏好：${key} = ${value}。`;

    return {
        type: 'preference-saved',
        content: message,
        preference: { section, key, value },
        oldContent,
        newContent,
        _skill: { name: 'save_preference', displayName: '偏好设置', confidence: 0.9 }
    };
}

/**
 * update_prompt — 修改系统 prompt
 */
async function handleUpdatePrompt(params, dispatchResult) {
    try {
        const promptName = params.promptName || 'dispatch';
        const newContent = params.content;

        if (!newContent) {
            return { type: 'text', content: '请提供要更新的 prompt 内容。' };
        }

        const readResponse = await fetch(`/api/ai/prompt/${promptName}`, { method: 'GET' });
        const oldContent = readResponse.ok ? (await readResponse.json()).content : '';

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
        return {
            type: 'prompt-updated',
            content: `Prompt 已更新：${result.file}`,
            promptName: result.file,
            oldContent,
            newContent
        };
    } catch (error) {
        return { type: 'text', content: 'Prompt 更新失败：' + error.message };
    }
}

/**
 * ask_follow_up — 追问补充信息
 */
async function handleAskFollowUp(params, dispatchResult) {
    const confidence = dispatchResult.confidence || 0;
    const followUpData = {
        question: params.question || '请补充信息',
        missing_fields: params.missingFields || [],
        original_fields: params.originalFields || {}
    };
    return {
        type: 'follow-up',
        followUp: followUpData,
        _skill: { name: 'ask_follow_up', displayName: '追问补充', confidence }
    };
}

/**
 * reply_text — 纯文本回复
 */
async function handleReplyText(params, dispatchResult) {
    const confidence = dispatchResult.confidence || 0;
    return {
        type: 'text',
        content: params.text || '你好！我是你的 AI 记账助手，请告诉我你的收支情况。',
        _skill: { name: 'reply_text', displayName: '闲聊', confidence }
    };
}

/**
 * create_skill — 创建动态 Skill
 */
async function handleCreateSkill(params, dispatchResult) {
    try {
        const skillDef = params.skill || {};
        const name = skillDef.name || `skill_${Date.now()}`;

        if (!skillDef.collection) {
            return { type: 'text', content: '创建 Skill 失败：缺少 collection 字段。' };
        }

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

// ==================== 辅助函数 ====================

/**
 * 更新 preferences.md 内容（简单的键值替换/追加）
 */
function updatePreferenceContent(content, section, key, value) {
    const lines = content.split('\n');
    const targetPrefix = `- ${key}：`;
    const targetPrefixAlt = `- ${key}:`;
    let found = false;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith(targetPrefix) || trimmed.startsWith(targetPrefixAlt)) {
            lines[i] = `- ${key}：${value}`;
            found = true;
            break;
        }
    }

    if (!found) {
        const sectionHeaders = { noteFormat: '## 备注格式', defaults: '## 默认值' };
        const header = sectionHeaders[section] || '## 其他偏好';
        const headerIdx = lines.findIndex(l => l.trim() === header);
        if (headerIdx >= 0) {
            lines.splice(headerIdx + 1, 0, `- ${key}：${value}`);
        } else {
            lines.push('', header, `- ${key}：${value}`);
        }
    }

    return lines.join('\n');
}

/**
 * 通过上下文信息搜索匹配记录
 * @param {Object} ctxOrResult - LLM 提供的 context 对象 { datetime, amount, note }，或 dispatchResult
 */
async function findRecordByContext(ctxOrResult) {
    let targetDatetime = null;
    let targetAmount = null;
    let targetNote = null;

    // 判断是 LLM context 对象还是 dispatchResult
    if (ctxOrResult && (ctxOrResult.datetime || ctxOrResult.amount || ctxOrResult.note)) {
        targetDatetime = ctxOrResult.datetime || null;
        targetAmount = ctxOrResult.amount ? parseFloat(ctxOrResult.amount) : null;
        targetNote = ctxOrResult.note || null;
    } else {
        const inputText = ctxOrResult?._inputText || '';
        if (!inputText) return null;

        const lines = inputText.split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
            const dateMatch = line.match(/(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/);
            if (dateMatch) {
                targetDatetime = dateMatch[1];
                if (targetDatetime.length <= 10) targetDatetime += ' 00:00:00';
                else if (targetDatetime.length <= 16) targetDatetime += ':00';
            }

            const amountMatch = line.match(/¥([\d.]+)/);
            if (amountMatch) targetAmount = parseFloat(amountMatch[1]);

            if (!targetNote && line.length > 2 && line.length < 30 && !line.includes('支出') && !line.includes('收入') && !line.includes('¥') && !line.match(/^20\d{2}/)) {
                targetNote = line;
            }
        }
    }

    if (!targetDatetime && !targetAmount) return null;

    try {
        const dateOnly = targetDatetime ? targetDatetime.substring(0, 10) : null;

        // 构建 NocoBase filter 参数
        const filterParams = {};
        if (dateOnly) {
            filterParams['filter[datetime][$gte]'] = `${dateOnly} 00:00:00`;
            filterParams['filter[datetime][$lte]'] = `${dateOnly} 23:59:59`;
        }
        filterParams['pageSize'] = 100;
        filterParams['sort'] = '-datetime';

        const qs = new URLSearchParams(filterParams).toString();
        const url = `/api/records?${qs}`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${NOCOBASE_CONFIG.API_TOKEN}` }
        });

        if (!response.ok) return null;
        const result = await response.json();
        const records = result.data || [];
        if (records.length === 0) return null;

        // 优先匹配金额
        if (targetAmount) {
            const matchByAmount = records.find(r => parseFloat(r.amount) === targetAmount);
            if (matchByAmount) return matchByAmount.id;
        }

        // 其次匹配时间
        if (targetDatetime) {
            const matchByTime = records.find(r => r.datetime && r.datetime.startsWith(targetDatetime.substring(0, 16)));
            if (matchByTime) return matchByTime.id;
        }

        // 最后匹配备注
        if (targetNote) {
            const matchByNote = records.find(r => r.note && (r.note.includes(targetNote) || targetNote.includes(r.note)));
            if (matchByNote) return matchByNote.id;
        }

        return records[0]?.id || null;
    } catch (e) {
        console.warn('[Agent] 搜索记录失败:', e);
        return null;
    }
}

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
    handleUpdatePrompt as updatePrompt,
    getDynamicSkillsList,
    getDynamicSkill
};

// ==================== 动态 Skill 管理 ====================

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

function getDynamicSkillsList() {
    try {
        const saved = localStorage.getItem('accounting_dynamic_skills');
        if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
}
