/**
 * 学习引擎：管理用户修正数据，注入个性化规则到 Prompt
 */

const LearningEngine = (function () {
    const STORAGE_KEY = 'agent_learning_corrections';
    const PENDING_SYNC_KEY = 'agent_learning_pending_sync';
    const PREFERENCES_KEY = 'agent_learning_preferences';

    let corrections = {};
    let preferences = {};

    function init() {
        corrections = loadFromLocal(STORAGE_KEY, {});
        preferences = loadFromLocal(PREFERENCES_KEY, {});
        // 学习数据以 localStorage 为主，NocoBase 同步可选
        // syncFromNocoBase();
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

    /**
     * 记录用户修正
     * @param {string} inputText - 原始输入文本
     * @param {object} originalFields - LLM 解析的原始字段
     * @param {object} correctedFields - 用户修正后的字段
     */
    function recordCorrection(inputText, originalFields, correctedFields) {
        // 提取关键词（从输入文本中找有意义的词）
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

        // 更新偏好
        if (correctedFields.account && correctedFields.account !== originalFields.account) {
            preferences.defaultAccount = correctedFields.account;
            saveToLocal(PREFERENCES_KEY, preferences);
        }
        if (correctedFields.payment && correctedFields.payment !== originalFields.payment) {
            preferences.defaultPayment = correctedFields.payment;
            saveToLocal(PREFERENCES_KEY, preferences);
        }

        // 加入待同步队列
        queueForSync(inputText, originalFields, correctedFields);
    }

    function extractKeywords(text) {
        // 提取中文关键词（2-6 字）
        const words = [];
        const chinese = text.match(/[一-龥]+/g);
        if (chinese) {
            for (const seg of chinese) {
                if (seg.length >= 2 && seg.length <= 6) {
                    words.push(seg);
                }
                // 长文本再拆子串
                if (seg.length > 6) {
                    words.push(seg.substring(0, 4));
                    words.push(seg.substring(seg.length - 4));
                }
            }
        }
        // 去重
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
            // 最多保留 50 条
            if (pending.length > 50) pending = pending.slice(-50);
            localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(pending));
        } catch {}
    }

    /**
     * 生成 Prompt 注入文本
     */
    function getPromptContext() {
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

    /**
     * 根据输入文本查找已学习的修正
     */
    function getCorrectionsForInput(text) {
        const result = {};
        for (const [keyword, correction] of Object.entries(corrections)) {
            if (text.includes(keyword)) {
                Object.assign(result, correction);
            }
        }
        return result;
    }

    /**
     * 从 NocoBase 拉取最新学习数据
     */
    async function syncFromNocoBase() {
        try {
            if (typeof NocobaseAPI === 'undefined') return;
            if (typeof NocobaseAPI.getCollection !== 'function') return;

            const pending = JSON.parse(localStorage.getItem(PENDING_SYNC_KEY) || '[]');

            // 推送待同步数据
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

            // 清空待同步队列
            localStorage.removeItem(PENDING_SYNC_KEY);

            // 拉取远程数据并合并
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

    /**
     * 获取学习数据（用于调试）
     */
    function getData() {
        return { corrections, preferences };
    }

    return {
        init,
        recordCorrection,
        getPromptContext,
        getCorrectionsForInput,
        syncFromNocoBase,
        getData
    };
})();
