/**
 * AI 智能记账解析器
 * 使用阿里云百炼 API 解析复杂格式的记账输入
 * 支持：银行通知、交易截图 OCR、自然语言等
 */

import { NOCOBASE_CONFIG } from './config.js';
const config = NOCOBASE_CONFIG.AI_CONFIG;

    const SYSTEM_PROMPT = `你是一个专业的记账助手。请解析用户的输入，提取记账信息。

支持的分类：餐饮、交通出行、购物、生活杂费、家庭支出、医疗、娱乐、学习、人情往来、零食水果、数码、服饰、其他
支持的账户：个人、家庭、公司
支持的支付方式：微信支付、支付宝、银行卡、现金、信用卡、花呗

请返回 JSON 格式（不要返回其他内容）：
{
    "amount": 金额（数字，正数），
    "type": "收入" 或 "支出"，
    "category": "分类名称"，
    "account": "账户名称"，
    "payment": "支付方式"，
    "datetime": "时间（YYYY-MM-DD HH:mm:ss 格式，如果没有具体时间则用当前日期）",
    "note": "备注（简短描述）"
}

注意：
1. 金额必须是正数，type 字段区分收入/支出
2. 如果输入是银行交易通知（如 -¥50.00、消费等），-号表示支出
3. 如果无法确定某个字段，使用 null
4. 只返回 JSON，不要包含 markdown 代码块标记`;

export async function callAI(text) {
        const response = await fetch('/api/ai/parse', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`AI API 调用失败 (${response.status}): ${errorText}`);
        }

        const data = await response.json();

        // 代理直接返回 JSON 对象
        if (data.amount !== undefined || data.type !== undefined) {
            return data;
        }

        // OpenAI 格式兼容
        if (!data.choices || !data.choices[0]) {
            throw new Error(`AI 返回格式异常: ${JSON.stringify(data)}`);
        }

        const content = data.choices[0].message.content.trim();

        // 移除可能的 markdown 代码块标记
        const jsonStr = content.replace(/^```json\s*|\s*```$/g, '').trim();
        return JSON.parse(jsonStr);
    }

export function normalizeAIResult(aiResult) {
        const result = {
            success: false,
            data: {},
            missing: [],
            confidence: 0.0,
            originalText: aiResult.originalText || '',
            source: 'ai'
        };

        // 映射 AI 结果到标准格式
        const fieldMap = {
            amount: aiResult.amount,
            type: aiResult.type,
            category: aiResult.category,
            account: aiResult.account || '个人',
            payment: aiResult.payment || '微信支付',
            datetime: aiResult.datetime,
            note: aiResult.note
        };

        for (const [key, value] of Object.entries(fieldMap)) {
            if (value !== null && value !== undefined && value !== '') {
                result.data[key] = value;
            } else {
                if (key !== 'account' && key !== 'payment') {
                    result.missing.push(key);
                }
            }
        }

        // 金额必须是数字
        if (typeof result.data.amount === 'string') {
            result.data.amount = parseFloat(result.data.amount);
        }

        // 计算置信度
        const totalFields = 6;
        const filledFields = Object.values(result.data).filter(v => v).length;
        result.confidence = filledFields / totalFields;

        // AI 解析只要金额和类型就认为成功
        result.success = result.data.amount && result.data.type;

        return result;
    }

export async function parse(text) {
        try {
            const aiResult = await callAI(text);
            return normalizeAIResult({ ...aiResult, originalText: text });
        } catch (error) {
            console.error('AI 解析失败:', error);
            return {
                success: false,
                data: {},
                missing: ['AI 解析失败'],
                confidence: 0,
                originalText: text,
                source: 'ai',
                error: error.message
            };
        }
    }
