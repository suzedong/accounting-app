/**
 * AI 对话悬浮组件
 * 右悬浮弹窗式对话记账，支持历史记录、可学习修改
 */

const ChatWidget = (function () {
    let chatHistory = [];
    let conversationState = {
        waitingForConfirm: false,
        pendingRecord: null,
        missingFields: []
    };

    const STORAGE_KEY = 'accounting_chat_history';
    const LEARNING_KEY = 'accounting_ai_learning';

    function init() {
        loadHistory();
        renderWidget();
        bindEvents();
    }

    function loadHistory() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            chatHistory = saved ? JSON.parse(saved) : [];
        } catch (e) {
            chatHistory = [];
        }
    }

    function saveHistory() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(chatHistory.slice(-100)));
        } catch (e) {
            console.warn('保存历史记录失败:', e);
        }
    }

    function loadLearningData() {
        try {
            const saved = localStorage.getItem(LEARNING_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch (e) {
            return {};
        }
    }

    function saveLearningData(data) {
        try {
            localStorage.setItem(LEARNING_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('保存学习数据失败:', e);
        }
    }

    function renderWidget() {
        const widget = document.createElement('div');
        widget.id = 'chat-widget';
        widget.innerHTML = `
            <div class="chat-toggle" id="chat-toggle" title="AI 记账助手">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="chat-badge" id="chat-badge" style="display:none">0</span>
            </div>
            <div class="chat-panel" id="chat-panel">
                <div class="chat-header">
                    <div class="chat-header-left">
                        <span class="chat-avatar">🤖</span>
                        <div>
                            <div class="chat-title">AI 记账助手</div>
                            <div class="chat-status">在线</div>
                        </div>
                    </div>
                    <div class="chat-header-actions">
                        <button class="chat-action-btn" id="chat-clear" title="清空历史">🗑️</button>
                        <button class="chat-action-btn" id="chat-minimize" title="最小化">—</button>
                    </div>
                </div>
                <div class="chat-messages" id="chat-messages"></div>
                <div class="chat-input-area">
                    <div class="chat-input-wrapper">
                        <textarea id="chat-input" placeholder="输入记账信息..." rows="1"></textarea>
                        <button class="chat-send-btn" id="chat-send">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
                        </button>
                    </div>
                    <div class="chat-hint">AI 也可能出错，请检查信息内容</div>
                </div>
            </div>
        `;
        document.body.appendChild(widget);
    }

    function bindEvents() {
        const toggle = document.getElementById('chat-toggle');
        const panel = document.getElementById('chat-panel');
        const minimize = document.getElementById('chat-minimize');
        const clearBtn = document.getElementById('chat-clear');
        const sendBtn = document.getElementById('chat-send');
        const input = document.getElementById('chat-input');

        toggle.addEventListener('click', () => {
            panel.classList.toggle('open');
            if (panel.classList.contains('open')) {
                renderMessages();
                input.focus();
                scrollToBottom();
            }
        });

        minimize.addEventListener('click', () => {
            panel.classList.remove('open');
        });

        clearBtn.addEventListener('click', () => {
            if (confirm('确定要清空对话历史吗？')) {
                chatHistory = [];
                saveHistory();
                renderMessages();
            }
        });

        sendBtn.addEventListener('click', sendMessage);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        input.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 100) + 'px';
        });
    }

    function renderMessages() {
        const container = document.getElementById('chat-messages');
        if (chatHistory.length === 0) {
            container.innerHTML = `
                <div class="chat-welcome">
                    <div class="chat-welcome-icon">🤖</div>
                    <div class="chat-welcome-text">你好！我是你的 AI 记账助手</div>
                    <div class="chat-welcome-sub">告诉我你的收支情况，我会帮你记录</div>
                    <div class="chat-quick-actions">
                        <button onclick="ChatWidget.sendQuick('今天中午吃饭花了35元')">今天吃饭35元</button>
                        <button onclick="ChatWidget.sendQuick('收入5000工资')">工资收入5000</button>
                        <button onclick="ChatWidget.sendQuick('昨天打车25支付宝')">昨天打车25</button>
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = chatHistory.map(msg => {
            if (msg.type === 'user') {
                return `<div class="chat-msg user"><div class="chat-msg-bubble">${escapeHtml(msg.content)}</div></div>`;
            } else if (msg.type === 'ai') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}<div class="chat-msg-bubble">${msg.content}</div></div>`;
            } else if (msg.type === 'record-card') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderRecordCard(msg.data, msg.id)}</div>`;
            } else if (msg.type === 'missing-fields') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderMissingFields(msg.data, msg.id)}</div>`;
            } else if (msg.type === 'duplicate-warning') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderDuplicateWarning(msg.data, msg.id)}</div>`;
            } else if (msg.type === 'query-result') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderSkillResult(msg.data, '查询结果')}</div>`;
            } else if (msg.type === 'stats-result') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderSkillResult(msg.data, msg.data?.title || '统计结果')}</div>`;
            } else if (msg.type === 'budget-result') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderSkillResult(msg.data, msg.data?.title || '预算状态')}</div>`;
            } else if (msg.type === 'collection-list') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderCollectionList(msg.data || msg)}</div>`;
            }
            return '';
        }).join('');

        scrollToBottom();
    }

    function renderRecordCard(record, msgId) {
        const typeClass = record.type === '支出' ? 'expense' : 'income';
        const typeIcon = record.type === '支出' ? '📤' : '📥';
        return `
            <div class="chat-msg ai">
                <div class="chat-msg-bubble">
                    <div>我帮你整理了一下，请确认：</div>
                    <div class="chat-record-card">
                        <div class="chat-record-field"><span class="label">${typeIcon} 类型</span><span class="value ${typeClass}">${record.type}</span></div>
                        <div class="chat-record-field"><span class="label">💰 金额</span><span class="value">${formatMoney(record.amount)}</span></div>
                        <div class="chat-record-field"><span class="label">📂 分类</span><span class="value">${record.category || '未识别'}</span></div>
                        <div class="chat-record-field"><span class="label">👤 账户</span><span class="value">${record.account || '个人'}</span></div>
                        <div class="chat-record-field"><span class="label">💳 支付</span><span class="value">${record.payment || '微信支付'}</span></div>
                        <div class="chat-record-field"><span class="label">📅 时间</span><span class="value">${record.datetime || '今天'}</span></div>
                        ${record.note ? `<div class="chat-record-field"><span class="label">📝 备注</span><span class="value">${escapeHtml(record.note)}</span></div>` : ''}
                    </div>
                    <div class="chat-record-actions">
                        <button class="chat-btn-confirm" onclick="ChatWidget.confirmRecord('${msgId}')">✅ 确认</button>
                        <button class="chat-btn-edit" onclick="ChatWidget.editRecord('${msgId}')">✏️ 修改</button>
                        <button class="chat-btn-cancel" onclick="ChatWidget.cancelRecord()">❌ 取消</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderMissingFields(missing, msgId) {
        const fields = {
            'amount': '金额', 'type': '类型', 'category': '分类',
            'account': '账户', 'payment': '支付方式', 'datetime': '时间'
        };
        const options = missing.map(f => `<button onclick="ChatWidget.fillMissing('${f}','${msgId}')">${fields[f] || f}</button>`).join('');
        return `
            <div class="chat-msg ai">
                <div class="chat-msg-bubble">
                    <div>还缺少一些信息，请补充：</div>
                    <div class="chat-quick-options">${options}</div>
                </div>
            </div>
        `;
    }

    function renderDuplicateWarning(data, msgId) {
        const existing = data.existingRecord;
        return `
            <div class="chat-msg ai">
                <div class="chat-msg-bubble chat-warning">
                    <div>⚠️ 发现重复记录！</div>
                    <div class="chat-duplicate-info">
                        ${existing.datetime} 已有 ${formatMoney(existing.amount)} 的${existing.type}记录（${existing.category}）
                    </div>
                    <div class="chat-record-actions">
                        <button class="chat-btn-confirm" onclick="ChatWidget.forceSaveRecord('${msgId}')">仍然保存</button>
                        <button class="chat-btn-cancel" onclick="ChatWidget.cancelRecord()">取消</button>
                    </div>
                </div>
            </div>
        `;
    }

    function renderSkillResult(data, title) {
        const content = escapeHtml(data.content || '').replace(/\n/g, '<br>');
        const details = data.details ? escapeHtml(data.details).replace(/\n/g, '<br>') : '';
        return `
            <div class="chat-msg-bubble">
                <div class="chat-skill-title">${escapeHtml(title)}</div>
                <div class="chat-skill-content">${content}${details ? '<br><br><pre class="chat-skill-details">' + details + '</pre>' : ''}</div>
            </div>
        `;
    }

    function renderSkillTag(skillMeta) {
        if (!skillMeta || !skillMeta.name) return '';
        const name = skillMeta.displayName || skillMeta.name;
        const confidence = skillMeta.confidence;
        const confidenceText = confidence && confidence < 1 ? ` (${confidence.toFixed(2)})` : '';
        return `<span class="chat-skill-tag">⚙️ ${escapeHtml(name)}${confidenceText}</span>`;
    }

    function renderCollectionList(data) {
        const content = escapeHtml(data.content || '');
        const details = data.details ? escapeHtml(data.details).replace(/\n/g, '<br>') : '';
        return `
            <div class="chat-msg-bubble">
                <div class="chat-skill-content">${content}${details ? '<br><br><div class="chat-list-items">' + details + '</div>' : ''}</div>
            </div>
        `;
    }

    function addMessage(type, content, data = null, skillMeta = null) {
        const msg = { type, content, data, skillMeta, id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), timestamp: Date.now() };
        chatHistory.push(msg);
        saveHistory();
        renderMessages();
        return msg;
    }

    function showTyping() {
        const container = document.getElementById('chat-messages');
        const typing = document.createElement('div');
        typing.className = 'chat-msg ai';
        typing.id = 'chat-typing';
        typing.innerHTML = `<div class="chat-msg-bubble"><div class="chat-typing-dots"><span></span><span></span><span></span></div></div>`;
        container.appendChild(typing);
        scrollToBottom();
    }

    function hideTyping() {
        const typing = document.getElementById('chat-typing');
        if (typing) typing.remove();
    }

    async function sendMessage() {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text) return;

        addMessage('user', text);
        input.value = '';
        input.style.height = 'auto';

        // 如果正在编辑字段，直接更新记录
        if (conversationState.editingField && conversationState.pendingRecord) {
            const field = conversationState.editingField;
            conversationState.pendingRecord[field] = text;
            conversationState.editingField = null;
            addMessage('ai', `已更新${getFieldLabel(field)}为：${text}`);
            // 重新显示确认卡片
            addMessage('record-card', null, conversationState.pendingRecord);
            return;
        }

        showTyping();

        try {
            // 通过 AgentCore 进行意图识别和执行
            const dispatchResult = await AgentCore.dispatch(text);
            dispatchResult._inputText = text; // 保存原始文本用于学习
            const result = await AgentCore.execute(dispatchResult);
            hideTyping();

            if (result.type === 'auto-save') {
                // 高置信度直接保存
                await saveRecordToDB(result.fields, 'msg_auto_' + Date.now(), result._skill);
            } else if (result.type === 'confirm') {
                // 低置信度弹确认卡片
                conversationState.pendingRecord = result.fields;
                conversationState.waitingForConfirm = true;
                conversationState._recordSkill = result._skill; // 保存 skill 元数据用于确认时传递
                addMessage('record-card', null, result.fields, result._skill);
            } else if (result.type === 'query-result') {
                addMessage('query-result', result.content, result, result._skill);
            } else if (result.type === 'stats-result') {
                addMessage('stats-result', result.content, result, result._skill);
            } else if (result.type === 'budget-result') {
                addMessage('budget-result', result.content, result, result._skill);
            } else if (result.type === 'collection-list') {
                addMessage('collection-list', result.content, result, result._skill);
            } else if (result.type === 'text') {
                addMessage('ai', result.content, null, result._skill);
            }
        } catch (error) {
            hideTyping();
            addMessage('ai', '解析出错：' + error.message);
        }
    }

    function getFieldLabel(field) {
        const labels = { type: '类型', amount: '金额', category: '分类', account: '账户', payment: '支付方式', datetime: '时间', note: '备注' };
        return labels[field] || field;
    }

    async function confirmRecord(msgId) {
        const record = conversationState.pendingRecord;
        if (!record) return;

        // 保存原始解析用于学习
        conversationState._originalParse = { ...record };

        const dupResult = await checkDuplicate(record);
        if (dupResult.isDuplicate) {
            addMessage('duplicate-warning', null, dupResult);
            return;
        }

        await saveRecordToDB(record, msgId, conversationState._recordSkill);
    }

    async function forceSaveRecord(msgId) {
        const record = conversationState.pendingRecord;
        if (!record) return;
        await saveRecordToDB(record, msgId, conversationState._recordSkill);
    }

    async function saveRecordToDB(record, msgId, skillMeta = null) {
        try {
            const data = {
                datetime: record.datetime,
                type: record.type,
                category: record.category || '其他',
                amount: parseFloat(record.amount),
                account: record.account || '个人',
                note: record.note || '',
                payment_method: record.payment || '微信支付'
            };

            await NocobaseAPI.createRecord(data);

            const typeIcon = data.type === '支出' ? '' : '📥';
            addMessage('ai', `${typeIcon} 已记录：${formatMoney(data.amount)} - ${data.category}`, null, skillMeta);

            // 触发学习记录（如果用户修改过字段）
            if (conversationState.pendingRecord && conversationState._originalParse) {
                AgentCore.learn(
                    conversationState._inputText || '',
                    conversationState._originalParse,
                    {
                        category: data.category !== conversationState._originalParse.category ? data.category : null,
                        payment: data.payment_method !== conversationState._originalParse.payment ? data.payment_method : null,
                        account: data.account !== conversationState._originalParse.account ? data.account : null
                    }
                );
            }

            conversationState.pendingRecord = null;
            conversationState.waitingForConfirm = false;
            conversationState._originalParse = null;
            conversationState._inputText = null;
            conversationState._recordSkill = null;
        } catch (error) {
            addMessage('ai', '记录失败：' + error.message);
        }
    }

    function editRecord(msgId) {
        const record = conversationState.pendingRecord;
        if (!record) return;

        const fields = ['type', 'amount', 'category', 'account', 'payment', 'datetime', 'note'];
        const options = fields.map(f => {
            const labels = { type: '类型', amount: '金额', category: '分类', account: '账户', payment: '支付', datetime: '时间', note: '备注' };
            return `<button onclick="ChatWidget.editField('${f}','${msgId}')">${labels[f]}</button>`;
        }).join('');

        addMessage('ai', `请选择要修改的字段：<div class="chat-quick-options">${options}</div>`);
    }

    function editField(field, msgId) {
        const prompts = {
            'type': '请输入类型（收入/支出）：',
            'amount': '请输入金额：',
            'category': '请输入分类：',
            'account': '请输入账户（个人/家庭/公司）：',
            'payment': '请输入支付方式：',
            'datetime': '请输入时间：',
            'note': '请输入备注：'
        };
        addMessage('ai', prompts[field] || '请输入：');
        conversationState.editingField = field;
    }

    function fillMissing(field, msgId) {
        const prompts = {
            'amount': '请输入金额（如：35元）',
            'type': '请选择类型：',
            'category': '请选择分类：',
            'account': '请选择账户：',
            'payment': '请选择支付方式：',
            'datetime': '请输入时间（如：今天、昨天）'
        };

        if (field === 'type') {
            addMessage('ai', prompts[field], null);
            const msg = chatHistory[chatHistory.length - 1];
            msg.content += `<div class="chat-quick-options"><button onclick="ChatWidget.sendQuick('支出')">支出</button><button onclick="ChatWidget.sendQuick('收入')">收入</button></div>`;
            saveHistory();
            renderMessages();
        } else if (field === 'category') {
            addMessage('ai', prompts[field], null);
            const msg = chatHistory[chatHistory.length - 1];
            msg.content += `<div class="chat-quick-options"><button onclick="ChatWidget.sendQuick('餐饮')">餐饮</button><button onclick="ChatWidget.sendQuick('交通出行')">交通</button><button onclick="ChatWidget.sendQuick('购物')">购物</button><button onclick="ChatWidget.sendQuick('通信费')">通信费</button><button onclick="ChatWidget.sendQuick('生活杂费')">生活</button><button onclick="ChatWidget.sendQuick('其他')">其他</button></div>`;
            saveHistory();
            renderMessages();
        } else if (field === 'payment') {
            addMessage('ai', prompts[field], null);
            const msg = chatHistory[chatHistory.length - 1];
            msg.content += `<div class="chat-quick-options"><button onclick="ChatWidget.sendQuick('微信支付')">微信</button><button onclick="ChatWidget.sendQuick('支付宝')">支付宝</button><button onclick="ChatWidget.sendQuick('信用卡')">信用卡</button><button onclick="ChatWidget.sendQuick('现金')">现金</button></div>`;
            saveHistory();
            renderMessages();
        } else {
            addMessage('ai', prompts[field]);
        }
    }

    function cancelRecord() {
        conversationState.pendingRecord = null;
        conversationState.waitingForConfirm = false;
        conversationState.editingField = null;
        addMessage('ai', '好的，请重新输入你的记账信息。');
    }

    async function checkDuplicate(record) {
        try {
            const dateStr = record.datetime ? record.datetime.substring(0, 10) : new Date().toISOString().substring(0, 10);
            const result = await NocobaseAPI.getRecordsForStats(
                `${dateStr} 00:00:00`,
                `${dateStr} 23:59:59`
            );
            const records = result.data || [];

            for (const r of records) {
                const sameAmount = Math.abs(parseFloat(r.amount) - parseFloat(record.amount)) < 0.01;
                const sameType = r.type === record.type;
                const sameDate = r.datetime && r.datetime.substring(0, 10) === dateStr;

                if (sameAmount && sameType && sameDate) {
                    return { isDuplicate: true, existingRecord: r };
                }
            }
            return { isDuplicate: false };
        } catch (error) {
            console.error('检查重复失败:', error);
            return { isDuplicate: false };
        }
    }

    function sendQuick(text) {
        const input = document.getElementById('chat-input');
        input.value = text;
        sendMessage();
    }

    function scrollToBottom() {
        const container = document.getElementById('chat-messages');
        if (container) {
            setTimeout(() => {
                container.scrollTop = container.scrollHeight;
            }, 50);
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatMoney(amount) {
        return '¥' + parseFloat(amount || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    return {
        init,
        sendQuick,
        confirmRecord,
        forceSaveRecord,
        cancelRecord,
        editRecord,
        editField,
        fillMissing
    };
})();
