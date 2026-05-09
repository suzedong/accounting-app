/**
 * 学习引擎：管理用户修正数据，注入个性化规则到 Prompt
 */

import { NOCOBASE_CONFIG } from './config.js';
import * as NocobaseAPI from './nocobase-api.js';

const STORAGE_KEY = 'agent_learning_corrections';
const PENDING_SYNC_KEY = 'agent_learning_pending_sync';
const PREFERENCES_KEY = 'agent_learning_preferences';

let corrections = {};
let preferences = {};

export function init() {
    corrections = loadFromLocal(STORAGE_KEY, {});
    preferences = loadFromLocal(PREFERENCES_KEY, {});
}

function loadFromLocal(key, defaultVal) {
    try {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : defaultVal;
    } catch {
        return defaultVal;
    }
}

function saveToLocal(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
        console.warn('学习数据保存失败:', e);
    }
}

export function recordCorrection(inputText, originalFields, correctedFields) {
    const keywords = extractKeywords(inputText);

    for (const [field, newValue] of Object.entries(correctedFields)) {
        if (!newValue || newValue === originalFields[field]) continue;

        const oldVal = originalFields[field];
        for (const kw of keywords) {
            if (!corrections[kw]) {
                corrections[kw] = {};
            }
            corrections[kw][field] = newValue;
        }
    }

    saveToLocal(STORAGE_KEY, corrections);

    if (correctedFields.account && correctedFields.account !== originalFields.account) {
        preferences.defaultAccount = correctedFields.account;
        saveToLocal(PREFERENCES_KEY, preferences);
    }
    if (correctedFields.payment && correctedFields.payment !== originalFields.payment) {
        preferences.defaultPayment = correctedFields.payment;
        saveToLocal(PREFERENCES_KEY, preferences);
    }

    queueForSync(inputText, originalFields, correctedFields);
}

function extractKeywords(text) {
    const words = [];
    const chinese = text.match(/[一-龥]+/g);
    if (chinese) {
        for (const seg of chinese) {
            if (seg.length >= 2 && seg.length <= 6) {
                words.push(seg);
            }
            if (seg.length > 6) {
                words.push(seg.substring(0, 4));
                words.push(seg.substring(seg.length - 4));
            }
        }
    }
    return [...new Set(words)];
}

function queueForSync(inputText, original, corrected) {
    try {
        let pending = JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || '[]');
        pending.push({
            input: inputText,
            original,
            corrected,
            timestamp: new Date().toISOString()
        });
        if (pending.length > 50) pending = pending.slice(-50);
        localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(pending));
    } catch {}
}

export function getPromptContext() {
    const entries = Object.entries(corrections);
    if (entries.length === 0 && Object.keys(preferences).length === 0) {
        return '';
    }

    let text = '\n\n用户个性化规则（优先级最高，必须遵守）：\n';

    for (const [keyword, correction] of entries) {
        if (correction.category) {
            text += `- 提到「${keyword}」时，分类必须是「${correction.category}」\n`;
        }
        if (correction.payment) {
            text += `- 提到「${keyword}」时，支付方式必须是「${correction.payment}」\n`;
        }
        if (correction.account) {
            text += `- 提到「${keyword}」时，账户必须是「${correction.account}」\n`;
        }
    }

    if (preferences.defaultAccount) {
        text += `- 用户默认账户：${preferences.defaultAccount}\n`;
    }
    if (preferences.defaultPayment) {
        text += `- 用户默认支付方式：${preferences.defaultPayment}\n`;
    }

    return text;
}

export function getCorrectionsForInput(text) {
    const result = {};
    for (const [keyword, correction] of Object.entries(corrections)) {
        if (text.includes(keyword)) {
            Object.assign(result, correction);
        }
    }
    return result;
}

export async function syncFromNocoBase() {
    try {
        const pending = JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || '[]');

        for (const item of pending) {
            try {
                await NocobaseAPI.createRecordInCollection(
                    NOCOBASE_CONFIG.COLLECTIONS.LEARNING_DATA || 'learning_data',
                    {
                        type: 'correction',
                        key: item.input.substring(0, 50),
                        value: JSON.stringify({ original: item.original, corrected: item.corrected }),
                        updated_at: item.timestamp
                    }
                );
            } catch (e) {
                console.warn('学习数据同步失败:', e);
            }
        }

        localStorage.removeItem(PENDING_SYNC_KEY);

        const remoteResult = await NocobaseAPI.getCollection(
            NOCOBASE_CONFIG.COLLECTIONS.LEARNING_DATA || 'learning_data',
            { pageSize: 100, sort: '-updated_at' }
        );

        if (remoteResult && remoteResult.data) {
            for (const record of remoteResult.data) {
                if (record.type === 'correction' && record.value) {
                    try {
                        const val = JSON.parse(record.value);
                        if (val.corrected) {
                            const keywords = extractKeywords(record.key);
                            for (const kw of keywords) {
                                if (!corrections[kw]) corrections[kw] = {};
                                Object.assign(corrections[kw], val.corrected);
                            }
                        }
                    } catch {}
                }
            }
            saveToLocal(STORAGE_KEY, corrections);
        }
    } catch (e) {
        console.warn('学习数据同步失败:', e);
    }
}

export function getData() {
    return { corrections, preferences };
}
