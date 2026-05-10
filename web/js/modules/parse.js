/**
 * 自然语言解析记账输入
 * 从 Python 脚本 parse_input.py 移植到 JavaScript
 */

import { formatDate } from './utils.js';
import { parse as aiParse } from './ai-parser.js';

const CATEGORY_KEYWORDS = {
    '餐饮': ['吃饭', '餐', '饭', '外卖', '咖啡', '奶茶', '饮料', '早餐', '午餐', '晚餐', '食堂', '餐厅'],
    '交通出行': ['打车', '地铁', '公交', '火车', '飞机', '加油', '停车', '车费', '交通', '乘车', '网约车'],
    '购物': ['超市', '淘宝', '京东', '购物', '买', '商场', '网购', '便利店', '商店'],
    '生活杂费': ['水电', '物业', '网费', '房租', '租金', '生活'],
    '通信费': ['话费', '中国移动', '中国联通', '中国电信', '中移金科', '联通', '电信', '移动', '充值', '流量', '宽带'],
    '家庭支出': ['家庭', '家里', '孩子', '父母', '家人'],
    '医疗': ['医院', '药', '看病', '医疗', '诊所', '体检'],
    '娱乐': ['电影', '游戏', 'KTV', '娱乐', '玩', '唱歌', '打球'],
    '学习': ['书', '课程', '培训', '学习', '学费', '考试'],
    '人情往来': ['红包', '礼金', '礼物', '送礼', '份子钱'],
    '零食水果': ['零食', '水果', '小吃', '点心', '糖果'],
    '数码': ['手机', '电脑', '数码', '电子', '相机', '平板'],
    '服饰': ['衣服', '鞋', '服饰', '穿', '帽子', '裤子'],
};

const ACCOUNT_KEYWORDS = {
    '个人': ['个人', '自己'],
    '家庭': ['家庭账户', '家庭', '家里'],
    '公司': ['公司账户', '公司', '企业'],
};

const PAYMENT_KEYWORDS = {
    '微信支付': ['微信', 'wechat'],
    '支付宝': ['支付宝', 'alipay', 'zfb'],
    '银行卡': ['银行卡', '刷卡', '借记卡'],
    '现金': ['现金', 'cash', '钱'],
    '信用卡': ['信用卡', 'credit', '白条'],
    '花呗': ['花呗'],
};

const INCOME_KEYWORDS = ['收入', '入账', '进账', '工资', '奖金', '报销', '收益', '赚'];
const EXPENSE_KEYWORDS = ['支出', '花了', '花费', '消费', '付款', '支付', '买', '用'];

function extractAmount(text) {
    const patterns = [
        /(\d+\.?\d*)\s*元/,
        /(\d+\.?\d*)\s*块/,
        /¥\s*(\d+\.?\d*)/,
        /(\d+\.?\d*)\s*块钱/,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            const amount = parseFloat(match[1]);
            const remaining = text.replace(match[0], '').trim();
            return { amount, remaining };
        }
    }

    return { amount: null, remaining: text };
}

function extractType(text) {
    const textLower = text.toLowerCase();

    for (const keyword of INCOME_KEYWORDS) {
        if (textLower.includes(keyword)) {
            return { type: '收入', remaining: text };
        }
    }

    for (const keyword of EXPENSE_KEYWORDS) {
        if (textLower.includes(keyword)) {
            return { type: '支出', remaining: text };
        }
    }

    return { type: '支出', remaining: text };
}

function extractCategory(text) {
    const textLower = text.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
        for (const keyword of keywords) {
            if (textLower.includes(keyword)) {
                const score = keyword.length;
                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = category;
                }
            }
        }
    }

    return { category: bestMatch, remaining: text };
}

function extractAccount(text) {
    const textLower = text.toLowerCase();

    for (const account of ['家庭', '公司']) {
        const keywords = ACCOUNT_KEYWORDS[account] || [];
        for (const keyword of keywords) {
            if (textLower.includes(keyword)) {
                return { account, remaining: text };
            }
        }
    }

    return { account: '个人', remaining: text };
}

function extractPayment(text) {
    const textLower = text.toLowerCase();
    const matches = [];

    for (const [payment, keywords] of Object.entries(PAYMENT_KEYWORDS)) {
        for (const keyword of keywords) {
            if (textLower.includes(keyword)) {
                matches.push({ len: keyword.length, payment, keyword });
            }
        }
    }

    if (matches.length > 0) {
        matches.sort((a, b) => b.len - a.len);
        return { payment: matches[0].payment, remaining: text };
    }

    return { payment: null, remaining: text };
}

function extractDatetime(text) {
    const now = new Date();

    // 匹配具体日期时间：2026-04-09 13:42 或 2026-04-09 13:42:14
    const datetimePattern = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?::\d{2})?/;
    const match = text.match(datetimePattern);

    if (match) {
        const datePart = match[1];
        const timePart = match[2];
        const datetimeStr = `${datePart} ${timePart}:00`;
        const remaining = text.replace(match[0], '').trim();
        return { datetime: datetimeStr, remaining };
    }

    if (text.includes('今天')) {
        const remaining = text.replace('今天', '');
        return { datetime: formatDate(now, '00:00:00'), remaining };
    }
    if (text.includes('昨天')) {
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const remaining = text.replace('昨天', '');
        return { datetime: formatDate(yesterday, '00:00:00'), remaining };
    }
    if (text.includes('明天')) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const remaining = text.replace('明天', '');
        return { datetime: formatDate(tomorrow, '00:00:00'), remaining };
    }

    return { datetime: formatCurrentTime(now), remaining: text };
}

function formatCurrentTime(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const s = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

function extractNote(text, extracted) {
    let note = text;

    // 移除金额
    if (extracted.amount) {
        note = note.replace(/\d+\.?\d*\s*(元|块|块钱)/g, '');
        note = note.replace(/¥\s*\d+\.?\d*/g, '');
    }

    // 移除类型关键词
    for (const keyword of [...INCOME_KEYWORDS, ...EXPENSE_KEYWORDS]) {
        note = note.replace(keyword, '');
    }

    // 移除分类关键词
    if (extracted.category) {
        for (const keyword of CATEGORY_KEYWORDS[extracted.category] || []) {
            note = note.replace(keyword, '');
        }
    }

    // 移除账户关键词
    if (extracted.account) {
        for (const keyword of ACCOUNT_KEYWORDS[extracted.account] || []) {
            note = note.replace(keyword, '');
        }
    }

    // 移除支付关键词
    if (extracted.payment) {
        for (const keyword of PAYMENT_KEYWORDS[extracted.payment] || []) {
            note = note.replace(keyword, '');
        }
    }

    note = note.trim();
    if (note.length > 100) {
        note = note.substring(0, 100) + '...';
    }

    return note || null;
}

function parseInputRule(text) {
    const result = {
        success: false,
        data: {},
        missing: [],
        confidence: 0.0,
        originalText: text,
        source: 'rule'
    };

    let remainingText = text;

    // 1. 提取类型
    const typeResult = extractType(remainingText);
    result.data.type = typeResult.type;
    remainingText = typeResult.remaining;

    // 2. 提取金额
    const amountResult = extractAmount(remainingText);
    if (amountResult.amount !== null) {
        result.data.amount = amountResult.amount;
    } else {
        result.missing.push('金额');
    }
    remainingText = amountResult.remaining;

    // 3. 提取分类
    const categoryResult = extractCategory(remainingText);
    if (categoryResult.category) {
        result.data.category = categoryResult.category;
    } else {
        result.missing.push('分类');
    }
    remainingText = categoryResult.remaining;

    // 4. 提取账户
    const accountResult = extractAccount(remainingText);
    result.data.account = accountResult.account;
    remainingText = accountResult.remaining;

    // 5. 提取支付方式
    const paymentResult = extractPayment(remainingText);
    result.data.payment = paymentResult.payment || '微信支付';
    remainingText = paymentResult.remaining;

    // 6. 提取时间
    const datetimeResult = extractDatetime(remainingText);
    result.data.datetime = datetimeResult.datetime;
    remainingText = datetimeResult.remaining;

    // 7. 提取备注
    const note = extractNote(remainingText, result.data);
    if (note) {
        result.data.note = note;
    }

    // 计算置信度
    const totalFields = 6;
    const filledFields = Object.values(result.data).filter(v => v).length;
    result.confidence = filledFields / totalFields;

    // 判断是否成功（最多允许 1 个字段缺失）
    result.success = result.missing.length <= 1;
    result.remainingText = remainingText.trim();

    return result;
}

export async function parseInput(text) {
    // 1. 先用规则解析
    const ruleResult = parseInputRule(text);
    console.log('[规则解析] 置信度:', ruleResult.confidence.toFixed(2), '分类:', ruleResult.data.category || '缺失', '缺失:', ruleResult.missing);

    // 2. 如果规则解析置信度高且分类已识别，直接返回
    if (ruleResult.confidence >= 0.8 && ruleResult.data.category) {
        console.log('[解析] 使用规则解析结果');
        return ruleResult;
    }

    // 3. 否则使用 AI 兜底
    try {
        console.log('[解析] 规则解析置信度不足，调用 AI...');
        const aiResult = await aiParse(text);
        console.log('[AI 解析] 置信度:', aiResult.confidence.toFixed(2), '分类:', aiResult.data.category || '缺失');
        // AI 结果更好则返回 AI 结果
        if (aiResult.success && aiResult.confidence > ruleResult.confidence) {
            console.log('[解析] 使用 AI 解析结果');
            return aiResult;
        }
        console.log('[解析] AI 结果不如规则解析，使用规则结果');
    } catch (e) {
        console.warn('[解析] AI 解析失败，使用规则解析结果:', e);
    }

    return ruleResult;
}

export function formatRecord(data) {
    const lines = [
        `📅 时间：${data.datetime || 'N/A'}`,
        `📝 类型：${data.type || 'N/A'}`,
        `${data.type === '支出' ? '🍜' : '💰'} 分类：${data.category || 'N/A'}`,
        `💰 金额：¥${(data.amount || 0).toFixed(2)}`,
        `👤 账户：${data.account || '个人'}`,
        `💳 支付：${data.payment || '微信支付'}`,
    ];

    if (data.note) {
        lines.push(`📝 备注：${data.note}`);
    }

    return lines.join('\n');
}
