/**
 * AI 对话悬浮组件
 * 右悬浮弹窗式对话记账，支持历史记录、可学习修改
 */

import * as NocobaseAPI from './nocobase-api.js';
import * as AgentCore from './agent-core.js';
import { getPromptContext } from './learning-engine.js';
import { formatMoney } from './utils.js';
import '/assets/chat-widget.css';

let chatHistory = [];
let debugLog = [];
let thinkingMsgId = null;
let pendingImage = null;  // { base64, mimeType, thumbnail, size }
let conversationState = {
        waitingForConfirm: false,
        pendingRecord: null,
        missingFields: [],
        awaitingFollowUp: false,       // 是否在等待用户补充信息
        pendingFollowUp: null,         // follow_up 数据
        editingField: null
    };

    const STORAGE_KEY = 'accounting_chat_history';
    const DEBUG_KEY = 'accounting_debug_log';
    const LEARNING_KEY = 'accounting_ai_learning';

    function init() {
        loadHistory();
        loadDebugLog();
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

    function loadDebugLog() {
        try {
            const saved = localStorage.getItem(DEBUG_KEY);
            debugLog = saved ? JSON.parse(saved) : [];
        } catch (e) {
            debugLog = [];
        }
    }

    function saveDebugLog() {
        try {
            localStorage.setItem(DEBUG_KEY, JSON.stringify(debugLog.slice(-50)));
        } catch (e) {
            console.warn('保存调试日志失败:', e);
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

    function getConversationHistoryForLLM() {
        const relevantTypes = ['user', 'ai', 'record-card'];
        return chatHistory
            .filter(msg => relevantTypes.includes(msg.type))
            .map(msg => ({
                type: msg.type,
                content: msg.content,
                hasImage: !!(msg.data && msg.data.imageThumbnail),
                data: msg.type === 'record-card' ? (msg.data || {}) : null,
                // 保留 OCR 文本，让后续对话能参考之前的识别结果
                ocrText: msg.data?.ocrText || null
            }))
            .slice(-10);
    }

    function addDebugLog(userText, dispatchRequest, dispatchResponse, executeResult, error, imageSummary = null) {
        debugLog.push({
            timestamp: new Date().toLocaleString('zh-CN'),
            userInput: userText,
            image: imageSummary,
            request: dispatchRequest,
            response: dispatchResponse,
            result: executeResult,
            error: error
        });
        saveDebugLog();
    }

    function formatDebugMarkdown() {
        let md = '# 对话调试日志\n\n';
        debugLog.forEach((entry, i) => {
            md += `## [${entry.timestamp}] #${i + 1}\n\n`;
            if (entry.image) {
                const sizeKB = entry.image.sizeKB || ((entry.image.size || 0) / 1024).toFixed(1);
                const mime = entry.image.mimeType || 'unknown';
                md += `**图片**: ${mime} | ${sizeKB} KB\n\n`;
            }
            md += `**用户输入**: ${entry.userInput}\n\n`;
            if (entry.request) {
                md += '**发送给 LLM 的请求**:\n```json\n' + JSON.stringify(entry.request, null, 2) + '\n```\n\n';
            }
            if (entry.response) {
                const dur = entry.response._duration;
                if (dur) md += `**请求耗时**: ${dur} ms\n\n`;
                md += '**LLM 返回**:\n```json\n' + JSON.stringify(entry.response, null, 2) + '\n```\n\n';
            }
            if (entry.result) {
                md += '**执行结果**:\n```json\n' + JSON.stringify(entry.result, null, 2) + '\n```\n\n';
            }
            if (entry.error) {
                md += '**错误**:\n```\n' + entry.error + '\n```\n\n';
            }
            md += '---\n\n';
        });
        return md;
    }

    function copyDebugLog(index) {
        let entry;
        if (index !== undefined) {
            entry = debugLog[index];
        } else {
            entry = null; // all
        }

        let md;
        if (entry) {
            md = `## 对话调试日志 [${entry.timestamp}]\n\n`;
            if (entry.image) {
                const sizeKB = entry.image.sizeKB || ((entry.image.size || 0) / 1024).toFixed(1);
                const mime = entry.image.mimeType || 'unknown';
                md += `**图片**: ${mime} | ${sizeKB} KB\n\n`;
            }
            md += `**用户输入**: ${entry.userInput}\n\n`;
            if (entry.request) md += '**发送给 LLM 的请求**:\n```json\n' + JSON.stringify(entry.request, null, 2) + '\n```\n\n';
            if (entry.response) {
                const dur = entry.response._duration;
                if (dur) md += `**请求耗时**: ${dur} ms\n\n`;
                md += '**LLM 返回**:\n```json\n' + JSON.stringify(entry.response, null, 2) + '\n```\n\n';
            }
            if (entry.result) md += '**执行结果**:\n```json\n' + JSON.stringify(entry.result, null, 2) + '\n```\n\n';
            if (entry.error) md += '**错误**:\n```\n' + entry.error + '\n```\n\n';
        } else {
            md = formatDebugMarkdown();
        }

        navigator.clipboard.writeText(md).then(() => {
            alert('已复制到剪贴板');
        }).catch(() => {
            const ta = document.createElement('textarea');
            ta.value = md;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            alert('已复制到剪贴板');
        });
    }

    function showDebugPanel() {
        const existing = document.getElementById('chat-debug-panel');
        if (existing) {
            existing.remove();
            return;
        }

        const overlay = document.createElement('div');
        overlay.id = 'chat-debug-panel';
        overlay.innerHTML = `
            <div class="chat-debug-content">
                <div class="chat-debug-header">
                    <span>调试日志 (${debugLog.length} 条)</span>
                    <div class="chat-debug-actions">
                        <button onclick="ChatWidget.copyAllDebug()" title="复制全部">📋 复制全部</button>
                        <button onclick="ChatWidget.clearDebug()" title="清空">🗑️ 清空</button>
                        <button onclick="ChatWidget.closeDebugPanel()" title="关闭" class="chat-debug-close">✕</button>
                    </div>
                </div>
                <div class="chat-debug-body">
                    ${debugLog.length === 0 ? '<div class="chat-debug-empty">暂无调试日志</div>' :
                        debugLog.map((entry, i) => renderDebugEntry(i, entry)).join('')}
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        // 点击遮罩关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
            }
        });
    }

    function renderDebugEntry(index, entry) {
        const intent = (entry.response && entry.response.intent) || '未知';
        const confidence = (entry.response && entry.response.confidence) || 0;
        const duration = (entry.response && entry.response._duration) || null;
        const hasImage = entry.image !== null && entry.image !== undefined;
        const reqShort = entry.request ? JSON.stringify(entry.request, null, 2) : '';
        const respShort = entry.response ? JSON.stringify(entry.response, null, 2) : '';
        const resultShort = entry.result ? JSON.stringify(entry.result, null, 2) : '';

        // 图片信息格式化
        let imageBadge = '';
        if (hasImage) {
            const sizeKB = entry.image.sizeKB || ((entry.image.size || 0) / 1024).toFixed(1);
            const mime = entry.image.mimeType || entry.image.mimeType;
            imageBadge = `<span class="chat-debug-image-badge" title="图片: ${mime} ${sizeKB} KB">🖼️ ${sizeKB} KB</span>`;
        }

        return `
            <div class="chat-debug-entry ${hasImage ? 'chat-debug-entry-image' : ''}">
                <div class="chat-debug-entry-header">
                    <span class="chat-debug-index">#${index + 1}</span>
                    ${imageBadge}
                    ${duration ? `<span class="chat-debug-duration" title="请求耗时">${duration} ms</span>` : ''}
                    <span class="chat-debug-time">${entry.timestamp}</span>
                    <span class="chat-debug-intent">${intent} (${confidence.toFixed(2)})</span>
                    <button onclick="ChatWidget.copyDebugLog(${index})" title="复制单条">📋</button>
                </div>
                <div class="chat-debug-user">用户: ${escapeHtml(entry.userInput)}</div>
                <details class="chat-debug-details">
                    <summary>📤 请求</summary>
                    <pre>${escapeHtml(reqShort)}</pre>
                </details>
                <details class="chat-debug-details">
                    <summary>📥 LLM 返回</summary>
                    <pre>${escapeHtml(respShort)}</pre>
                </details>
                <details class="chat-debug-details">
                    <summary>🎯 执行结果</summary>
                    <pre>${escapeHtml(resultShort)}</pre>
                </details>
                ${entry.error ? `<details class="chat-debug-details" open><summary>❌ 错误</summary><pre>${escapeHtml(entry.error)}</pre></details>` : ''}
            </div>
        `;
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
                        <button class="chat-action-btn" id="chat-rules" aria-label="规则管理" title="偏好和规则管理">📝</button>
                        <button class="chat-action-btn" id="chat-debug" aria-label="调试信息" title="调试信息">🔧</button>
                        <button class="chat-action-btn" id="chat-clear" aria-label="清空历史" title="清空历史">🗑️</button>
                        <button class="chat-action-btn" id="chat-minimize" aria-label="最小化" title="最小化">—</button>
                    </div>
                </div>
                <div class="chat-messages" id="chat-messages"></div>
                <div class="chat-input-area">
                    <div class="chat-image-preview" id="chat-image-preview" style="display:none">
                        <img id="chat-preview-img" src="" alt="preview"/>
                        <button class="chat-remove-image" id="chat-remove-image" title="移除图片">&times;</button>
                    </div>
                    <div class="chat-input-wrapper">
                        <button class="chat-upload-btn" id="chat-upload-btn" title="上传图片">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                        </button>
                        <textarea id="chat-input" placeholder="输入记账信息，或粘贴/上传截图..." rows="1"></textarea>
                        <button class="chat-send-btn" id="chat-send">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"/><path d="M22 2L15 22L11 13L2 9L22 2Z"/></svg>
                        </button>
                    </div>
                    <input type="file" id="chat-file-input" accept="image/*" style="display:none"/>
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
        const debugBtn = document.getElementById('chat-debug');
        const rulesBtn = document.getElementById('chat-rules');
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

        debugBtn.addEventListener('click', () => {
            showDebugPanel();
        });

        rulesBtn.addEventListener('click', () => {
            showRulesPanel();
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

        // 图片上传按钮
        const uploadBtn = document.getElementById('chat-upload-btn');
        const fileInput = document.getElementById('chat-file-input');
        const removeBtn = document.getElementById('chat-remove-image');

        uploadBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleImageFile(file);
                fileInput.value = '';
            }
        });

        removeBtn.addEventListener('click', clearPendingImage);

        // 粘贴截图
        input.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    handleImageFile(file);
                    break;
                }
            }
        });

        // 拖放图片
        const inputArea = document.querySelector('.chat-input-area');
        inputArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            inputArea.classList.add('chat-drag-over');
        });
        inputArea.addEventListener('dragleave', () => {
            inputArea.classList.remove('chat-drag-over');
        });
        inputArea.addEventListener('drop', (e) => {
            e.preventDefault();
            inputArea.classList.remove('chat-drag-over');
            const files = e.dataTransfer?.files;
            if (files && files.length > 0 && files[0].type.startsWith('image/')) {
                handleImageFile(files[0]);
            }
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
                        <button aria-label="今天吃饭35元" onclick="ChatWidget.sendQuick('今天中午吃饭花了35元')">今天吃饭35元</button>
                        <button aria-label="工资收入5000" onclick="ChatWidget.sendQuick('收入5000工资')">工资收入5000</button>
                        <button aria-label="昨天打车25" onclick="ChatWidget.sendQuick('昨天打车25支付宝')">昨天打车25</button>
                        <button aria-label="上传账单截图" onclick="document.getElementById('chat-upload-btn').click()">上传账单截图</button>
                    </div>
                </div>
            `;
            return;
        }

        container.innerHTML = chatHistory.map(msg => {
            if (msg.type === 'user') {
                const hasImage = msg.data && msg.data.imageThumbnail;
                const imgThumb = hasImage
                    ? `<img src="${msg.data.imageThumbnail}" class="chat-user-image" onclick="window.open(this.src)"/>`
                    : '';
                const ocrText = msg.data && msg.data.ocrText;
                const ocrBlock = ocrText ? `<details class="chat-user-ocr"><summary>📄 识别文字 (${ocrText.split('\n').length} 行)</summary><pre>${escapeHtml(ocrText)}</pre></details>` : '';
                return `<div class="chat-msg user"><div class="chat-msg-bubble">${imgThumb}${escapeHtml(msg.content)}${ocrBlock}</div></div>`;
            } else if (msg.type === 'ai') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}<div class="chat-msg-bubble">${msg.content}</div></div>`;
            } else if (msg.type === 'record-card') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderRecordCardContent(msg.data, msg.id)}</div>`;
            } else if (msg.type === 'missing-fields') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderMissingFieldsContent(msg.data || {}, msg.id)}</div>`;
            } else if (msg.type === 'duplicate-warning') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderDuplicateWarningContent(msg.data, msg.id)}</div>`;
            } else if (msg.type === 'query-result') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderSkillResultContent(msg.data, '查询结果')}</div>`;
            } else if (msg.type === 'stats-result') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderSkillResultContent(msg.data, msg.data?.title || '统计结果')}</div>`;
            } else if (msg.type === 'budget-result') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderSkillResultContent(msg.data, msg.data?.title || '预算状态')}</div>`;
            } else if (msg.type === 'collection-list') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderCollectionListContent(msg.data || msg)}</div>`;
            } else if (msg.type === 'prompt-updated') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderPromptUpdatedContent(msg.data || msg)}</div>`;
            } else if (msg.type === 'preference-saved') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderPreferenceSavedContent(msg.data || msg)}</div>`;
            } else if (msg.type === 'correction-applied') {
                const skillTag = msg.skillMeta ? renderSkillTag(msg.skillMeta) : '';
                return `<div class="chat-msg ai">${skillTag}${renderCorrectionAppliedContent(msg.data || msg)}</div>`;
            } else if (msg.type === 'thinking-active') {
                return `<div class="chat-msg ai chat-thinking-active" id="${msg.id}">${msg.content}</div>`;
            } else if (msg.type === 'thinking-collapsed') {
                return `<div class="chat-msg ai chat-thinking-collapsed">${msg.content}</div>`;
            }
            return '';
        }).join('');

        scrollToBottom();
    }

    function renderRecordCardContent(record, msgId) {
        const typeClass = record.type === '支出' ? 'expense' : 'income';
        const typeIcon = record.type === '支出' ? '' : '📥';
        return `
            <div class="chat-msg-bubble">
                <div>我帮你整理了一下，请确认：</div>
                <div class="chat-record-card">
                    <div class="chat-record-field"><span class="label">${typeIcon} 类型</span><span class="value ${typeClass}">${record.type}</span></div>
                    <div class="chat-record-field"><span class="label">💰 金额</span><span class="value">${formatMoney(record.amount)}</span></div>
                    <div class="chat-record-field"><span class="label">📂 分类</span><span class="value">${record.category || '未识别'}</span></div>
                    <div class="chat-record-field"><span class="label"> 账户</span><span class="value">${record.account || '个人'}</span></div>
                    <div class="chat-record-field"><span class="label">💳 支付</span><span class="value">${record.payment || '微信支付'}</span></div>
                    <div class="chat-record-field"><span class="label">📅 时间</span><span class="value">${record.datetime || '今天'}</span></div>
                    ${record.note ? `<div class="chat-record-field"><span class="label"> 备注</span><span class="value">${escapeHtml(record.note)}</span></div>` : ''}
                </div>
                <div class="chat-record-actions">
                    <button class="chat-btn-confirm" aria-label="确认" onclick="ChatWidget.confirmRecord('${msgId}')">✅ 确认</button>
                    <button class="chat-btn-edit" aria-label="修改" onclick="ChatWidget.editRecord('${msgId}')">✏️ 修改</button>
                    <button class="chat-btn-cancel" aria-label="取消" onclick="ChatWidget.cancelRecord()">❌ 取消</button>
                </div>
            </div>
        `;
    }

    function renderMissingFieldsContent(data, msgId) {
        const { missingFields, autoFilled, originalFields } = data;
        const fields = {
            'amount': '金额', 'type': '类型', 'category': '分类',
            'account': '账户', 'payment': '支付方式', 'datetime': '时间'
        };
        const options = missingFields.map(f => `<button onclick="ChatWidget.fillMissing('${f}','${msgId}')">${fields[f] || f}</button>`).join('');

        let defaultsHtml = '';
        if (autoFilled && Object.keys(autoFilled).length > 0) {
            const items = Object.entries(autoFilled).map(([k, v]) => `${fields[k] || k}: ${v}`).join('、');
            defaultsHtml = `<div class="chat-auto-filled">已使用默认值：${items}</div>`;
        }

        return `
            <div class="chat-msg-bubble">
                <div>还缺少一些信息，请补充：</div>
                <div class="chat-quick-options">${options}</div>
                ${defaultsHtml}
            </div>
        `;
    }

    function renderMissingFieldsCardContent(data) {
        const question = escapeHtml(data.question || '请补充信息');
        return `
            <div class="chat-msg-bubble">
                <div class="chat-follow-up-question">${question}</div>
                <div class="chat-hint-text">直接输入回答即可</div>
            </div>
        `;
    }

    function cancelFollowUp() {
        conversationState.awaitingFollowUp = false;
        conversationState.pendingFollowUp = null;
        addMessage('ai', '好的，请重新输入你的记账信息。');
    }

    function renderDuplicateWarningContent(data, msgId) {
        const existing = data.existingRecord;
        return `
            <div class="chat-msg-bubble chat-warning">
                <div>️ 发现重复记录！</div>
                <div class="chat-duplicate-info">
                    ${existing.datetime} 已有 ${formatMoney(existing.amount)} 的${existing.type}记录（${existing.category}）
                </div>
                <div class="chat-record-actions">
                    <button class="chat-btn-confirm" aria-label="仍然保存" onclick="ChatWidget.forceSaveRecord('${msgId}')">仍然保存</button>
                    <button class="chat-btn-cancel" aria-label="取消" onclick="ChatWidget.cancelRecord()">取消</button>
                </div>
            </div>
        `;
    }

    function renderSkillResultContent(data, title) {
        const content = escapeHtml(data.content || '').replace(/\n/g, '<br>');
        const details = data.details ? escapeHtml(data.details).replace(/\n/g, '<br>') : '';
        return `
            <div class="chat-msg-bubble">
                <div class="chat-skill-title">${escapeHtml(title)}</div>
                <div class="chat-skill-content">${content}${details ? '<br><br><pre class="chat-skill-details">' + details + '</pre>' : ''}</div>
            </div>
        `;
    }

    function renderCollectionListContent(data) {
        const content = escapeHtml(data.content || '');
        const details = data.details ? escapeHtml(data.details).replace(/\n/g, '<br>') : '';
        return `
            <div class="chat-msg-bubble">
                <div class="chat-skill-content">${content}${details ? '<br><br><div class="chat-list-items">' + details + '</div>' : ''}</div>
            </div>
        `;
    }

    function renderPromptUpdatedContent(data) {
        const promptName = escapeHtml(data.promptName || '');
        const oldContent = escapeHtml(data.oldContent || '');
        const newContent = escapeHtml(data.newContent || '');

        // 简单的 diff：按行对比
        const oldLines = oldContent.split('\n');
        const newLines = newContent.split('\n');

        let diffHtml = '';
        const maxLen = Math.max(oldLines.length, newLines.length);
        for (let i = 0; i < maxLen; i++) {
            const oldLine = oldLines[i] || '';
            const newLine = newLines[i] || '';
            if (oldLine === newLine) {
                diffHtml += `<div class="chat-diff-line unchanged">${escapeHtml(newLine)}</div>`;
            } else {
                if (oldLine) diffHtml += `<div class="chat-diff-line removed">- ${escapeHtml(oldLine)}</div>`;
                if (newLine) diffHtml += `<div class="chat-diff-line added">+ ${escapeHtml(newLine)}</div>`;
            }
        }

        return `
            <div class="chat-msg-bubble">
                <div>✅ Prompt <strong>${promptName}</strong> 已更新</div>
                <details class="chat-prompt-diff">
                    <summary>📝 查看修改内容</summary>
                    <div class="chat-diff-content">${diffHtml}</div>
                </details>
            </div>
        `;
    }

    function renderPreferenceSavedContent(data) {
        const message = escapeHtml(data.message || '偏好已保存');
        const oldContent = escapeHtml(data.oldContent || '');
        const newContent = escapeHtml(data.newContent || '');

        let diffHtml = '';
        if (oldContent && newContent) {
            const oldLines = oldContent.split('\n');
            const newLines = newContent.split('\n');
            const maxLen = Math.max(oldLines.length, newLines.length);
            for (let i = 0; i < maxLen; i++) {
                const oldLine = oldLines[i] || '';
                const newLine = newLines[i] || '';
                if (oldLine === newLine) {
                    diffHtml += `<div class="chat-diff-line unchanged">${escapeHtml(newLine)}</div>`;
                } else {
                    if (oldLine) diffHtml += `<div class="chat-diff-line removed">- ${escapeHtml(oldLine)}</div>`;
                    if (newLine) diffHtml += `<div class="chat-diff-line added">+ ${escapeHtml(newLine)}</div>`;
                }
            }
        }

        return `
            <div class="chat-msg-bubble chat-preference-saved">
                <div>✅ ${message}</div>
                ${diffHtml ? `<details class="chat-prompt-diff"><summary>📝 查看修改内容</summary><div class="chat-diff-content">${diffHtml}</div></details>` : ''}
            </div>
        `;
    }

    function renderCorrectionAppliedContent(data) {
        const rawMessage = data.content || data.message || '';
        const message = rawMessage ? escapeHtml(rawMessage) : '记录已修正';

        return `
            <div class="chat-msg-bubble chat-correction-applied">
                <div>✅ ${message}</div>
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

    // ========== 思考过程展示 ==========

    function delay(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    const INTENT_LABELS = {
        'record': '记账', 'query': '查询记录', 'stats': '统计分析',
        'budget': '预算管理', 'prompt': '修改规则', 'preference': '偏好设置',
        'data_query': '数据查询',
        'create-skill': '创建 Skill', 'chitchat': '闲聊', 'follow_up': '追问补充'
    };

    const FIELD_LABELS = {
        type: '类型', amount: '金额', category: '分类', account: '账户',
        payment: '支付', datetime: '时间', note: '备注'
    };

    function formatFieldVal(key, val) {
        if (val === null || val === undefined || val === '') return null;
        if (key === 'amount') return '¥' + parseFloat(val).toFixed(2);
        return val;
    }

    function buildIntentDetail(dispatchResult) {
        const { intent, follow_up, response } = dispatchResult;
        const fields = dispatchResult.fields || dispatchResult.params?.fields || null;
        const params = dispatchResult.params || {};
        let html = '';

        switch (intent) {
            case '记账':
                if (fields) {
                    const items = [
                        { label: '类型', value: fields.type },
                        { label: '金额', value: formatFieldVal('amount', fields.amount) },
                        { label: '分类', value: fields.category },
                        { label: '账户', value: fields.account },
                        { label: '支付', value: fields.payment },
                        { label: '时间', value: fields.datetime },
                        { label: '备注', value: fields.note }
                    ].filter(f => f.value);
                    html = renderDetailRows(items);
                }
                break;
            case '查询记录':
                if (params) {
                    const items = [
                        { label: '时间范围', value: params.timeRange || '默认' },
                        { label: '类型', value: params.type === 'expense' ? '支出' : params.type === 'income' ? '收入' : '全部' },
                        { label: '分类', value: params.category },
                        { label: '账户', value: params.account }
                    ].filter(f => f.value);
                    html = renderDetailRows(items);
                }
                break;
            case '统计分析':
                if (params) {
                    const dimMap = { category: '分类', account: '账户', payment: '支付方式', trend: '趋势', comparison: '对比' };
                    const items = [
                        { label: '维度', value: dimMap[params.dimension] || params.dimension },
                        { label: '时间范围', value: params.timeRange || '默认' },
                        { label: '类型', value: params.type === 'expense' ? '支出' : '收入' }
                    ].filter(f => f.value);
                    html = renderDetailRows(items);
                }
                break;
            case '追问补充':
                if (follow_up) {
                    html += '<div class="chat-thinking-section-label">已识别：</div>';
                    const known = Object.entries(follow_up.original_fields || {})
                        .map(([k, v]) => ({ label: FIELD_LABELS[k] || k, value: v }));
                    html += renderDetailRows(known);
                    const missing = follow_up.missing_fields || [];
                    if (missing.length) {
                        html += `<div class="chat-thinking-section-label chat-thinking-missing">缺少：${missing.map(f => FIELD_LABELS[f] || f).join('、')}</div>`;
                    }
                    html += `<div class="chat-thinking-question">💬 ${escapeHtml(follow_up.question || '')}</div>`;
                }
                break;
            case '预算管理':
                html = '<div class="chat-thinking-detail-row"><span class="chat-thinking-detail-label">查询</span><span class="chat-thinking-detail-value">当月预算状态</span></div>';
                break;
            case '闲聊':
                if (response) {
                    html = `<div class="chat-thinking-detail-row"><span class="chat-thinking-detail-label">回复</span><span class="chat-thinking-detail-value">${escapeHtml(response)}</span></div>`;
                }
                break;
        }
        return html;
    }

    function renderDetailRows(items) {
        return items.map(f =>
            `<div class="chat-thinking-detail-row"><span class="chat-thinking-detail-label">${f.label}</span><span class="chat-thinking-detail-value">${escapeHtml(String(f.value))}</span></div>`
        ).join('');
    }

    function renderThinkingHTML(dispatchResult, step, detail) {
        const intent = dispatchResult.intent || '未知';
        const confidence = dispatchResult.confidence || 0;
        const label = INTENT_LABELS[intent] || intent;
        const intentIcon = step === 'done' ? '✅' : '💭';
        const executeIcon = step === 'execute' ? '⚙️' : (step === 'done' ? '✅' : '');

        return `
            <div class="chat-thinking-box">
                <div class="chat-thinking-step done">
                    <span class="step-icon">${intentIcon}</span>
                    <span>意图识别：<strong>${escapeHtml(label)}</strong> (${confidence.toFixed(2)})</span>
                </div>
                ${step !== 'intent' ? buildIntentDetail(dispatchResult) : ''}
                <div class="chat-thinking-step ${step === 'execute' ? 'active' : 'done'}">
                    <span class="step-icon">${executeIcon}</span>
                    <span>执行 Skill：${escapeHtml(detail || '加载中...')}</span>
                    ${step === 'execute' ? '<span class="step-spinner"></span>' : ''}
                </div>
            </div>
        `;
    }

    function renderThinkingCollapsedHTML(dispatchResult, detail) {
        const intent = dispatchResult.intent || '未知';
        const confidence = dispatchResult.confidence || 0;
        const label = INTENT_LABELS[intent] || intent;
        const detailHtml = buildIntentDetail(dispatchResult);

        return `
            <div class="chat-thinking-collapsed">
                <div class="chat-thinking-toggle" onclick="this.parentElement.classList.toggle('expanded'); var c=this.parentElement.querySelector('.thinking-content'); c.style.display=c.style.display==='none'?'block':'none'; var a=this.querySelector('.toggle-arrow'); a.style.transform=c.style.display==='none'?'':'rotate(90deg)';">
                    <span class="toggle-arrow">▶</span>
                    <span>⚙️ ${escapeHtml(label)} (${confidence.toFixed(2)})</span>
                </div>
                <div class="thinking-content" style="display:none">
                    <div class="chat-thinking-step done">
                        <span class="step-icon">✅</span>
                        <span>意图识别：<strong>${escapeHtml(label)}</strong> (${confidence.toFixed(2)})</span>
                    </div>
                    ${detailHtml}
                    <div class="chat-thinking-step done">
                        <span class="step-icon">✅</span>
                        <span>执行 Skill：${escapeHtml(detail || label)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    function showThinking(dispatchResult) {
        hideTyping();
        const id = 'msg_thinking_' + Date.now();
        thinkingMsgId = id;
        chatHistory.push({
            type: 'thinking-active',
            content: renderThinkingHTML(dispatchResult, 'intent'),
            dispatchResult,
            id,
            timestamp: Date.now()
        });
        // 直接追加 DOM，不触发全量渲染
        const container = document.getElementById('chat-messages');
        const el = document.createElement('div');
        el.className = 'chat-msg ai chat-thinking-active';
        el.id = id;
        el.innerHTML = renderThinkingHTML(dispatchResult, 'intent');
        container.appendChild(el);
        scrollToBottom();
    }

    function updateThinking(dispatchResult, step, detail) {
        // 更新 chatHistory 中的 thinking 消息
        const msg = chatHistory.find(m => m.id === thinkingMsgId);
        if (msg) {
            msg.content = renderThinkingHTML(dispatchResult, step, detail);
            msg.dispatchResult = dispatchResult;
        }
        // 更新 DOM
        const el = document.getElementById(thinkingMsgId);
        if (el) {
            el.innerHTML = renderThinkingHTML(dispatchResult, step, detail);
            scrollToBottom();
        }
    }

    function collapseThinking(dispatchResult, detail) {
        const msg = chatHistory.find(m => m.id === thinkingMsgId);
        if (msg) {
            msg.type = 'thinking-collapsed';
            msg.content = renderThinkingCollapsedHTML(dispatchResult, detail);
            msg.dispatchResult = dispatchResult;
        }
        const el = document.getElementById(thinkingMsgId);
        if (el) {
            el.className = 'chat-msg ai chat-thinking-collapsed';
            el.id = 'thinking-' + Date.now(); // 换 id 避免冲突
            el.innerHTML = renderThinkingCollapsedHTML(dispatchResult, detail);
            thinkingMsgId = null;
            scrollToBottom();
        }
    }

    function hideThinking() {
        if (thinkingMsgId) {
            const el = document.getElementById(thinkingMsgId);
            if (el) el.remove();
            // 从 chatHistory 移除
            chatHistory = chatHistory.filter(m => m.id !== thinkingMsgId);
            thinkingMsgId = null;
        }
    }

    // 追加单条消息到 DOM（不重新渲染所有消息）
    function appendSingleMessage(type, content, data, skillMeta) {
        const container = document.getElementById('chat-messages');
        let html = '';

        if (type === 'user') {
            const imgThumb = data && data.imageThumbnail
                ? `<img src="${data.imageThumbnail}" class="chat-user-image" onclick="window.open(this.src)"/>`
                : '';
            const ocrText = data && data.ocrText;
            const ocrBlock = ocrText ? `<details class="chat-user-ocr"><summary>📄 识别文字 (${ocrText.split('\n').length} 行)</summary><pre>${escapeHtml(ocrText)}</pre></details>` : '';
            html = `<div class="chat-msg user"><div class="chat-msg-bubble">${imgThumb}${escapeHtml(content)}${ocrBlock}</div></div>`;
        } else if (type === 'ai') {
            const skillTag = skillMeta ? renderSkillTag(skillMeta) : '';
            html = `<div class="chat-msg ai">${skillTag}<div class="chat-msg-bubble">${content}</div></div>`;
        } else if (type === 'record-card') {
            const skillTag = skillMeta ? renderSkillTag(skillMeta) : '';
            html = `<div class="chat-msg ai">${skillTag}${renderRecordCardContent(data, data._msgId || '')}</div>`;
        } else if (type === 'query-result') {
            const skillTag = skillMeta ? renderSkillTag(skillMeta) : '';
            html = `<div class="chat-msg ai">${skillTag}${renderSkillResultContent(data, '查询结果')}</div>`;
        } else if (type === 'stats-result') {
            const skillTag = skillMeta ? renderSkillTag(skillMeta) : '';
            html = `<div class="chat-msg ai">${skillTag}${renderSkillResultContent(data, data?.title || '统计结果')}</div>`;
        } else if (type === 'budget-result') {
            const skillTag = skillMeta ? renderSkillTag(skillMeta) : '';
            html = `<div class="chat-msg ai">${skillTag}${renderSkillResultContent(data, data?.title || '预算状态')}</div>`;
        } else if (type === 'missing-fields') {
            const skillTag = skillMeta ? renderSkillTag(skillMeta) : '';
            html = `<div class="chat-msg ai">${skillTag}${renderMissingFieldsCardContent(data)}</div>`;
        } else if (type === 'collection-list') {
            const skillTag = skillMeta ? renderSkillTag(skillMeta) : '';
            html = `<div class="chat-msg ai">${skillTag}${renderCollectionListContent(data || {})}</div>`;
        } else if (type === 'prompt-updated') {
            const skillTag = skillMeta ? renderSkillTag(skillMeta) : '';
            html = `<div class="chat-msg ai">${skillTag}${renderPromptUpdatedContent(data || {})}</div>`;
        } else if (type === 'preference-saved') {
            const skillTag = skillMeta ? renderSkillTag(skillMeta) : '';
            html = `<div class="chat-msg ai">${skillTag}${renderPreferenceSavedContent(data || {})}</div>`;
        } else if (type === 'correction-applied') {
            const skillTag = skillMeta ? renderSkillTag(skillMeta) : '';
            html = `<div class="chat-msg ai">${skillTag}${renderCorrectionAppliedContent(data || {})}</div>`;
        }

        if (html) {
            container.insertAdjacentHTML('beforeend', html);
            scrollToBottom();
        }
    }

    async function sendMessage() {
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text && !pendingImage) return;

        const displayContent = pendingImage
            ? (text ? text + ' [图片]' : '[图片]')
            : text;

        const msgData = pendingImage
            ? { imageThumbnail: pendingImage.thumbnail, ocrText: pendingImage.ocrText || '' }
            : null;

        addMessage('user', displayContent, msgData);
        input.value = '';
        input.style.height = 'auto';

        const imageData = pendingImage ? { ...pendingImage } : null;
        clearPendingImage();

        // 如果正在编辑字段，直接更新记录
        if (conversationState.editingField && conversationState.pendingRecord) {
            const field = conversationState.editingField;
            conversationState.pendingRecord[field] = text;
            conversationState.editingField = null;
            addMessage('ai', `已更新${getFieldLabel(field)}为：${text}`);
            addMessage('record-card', null, conversationState.pendingRecord);
            return;
        }

        // 如果正在追问，将输入合并到 pendingFollowUp
        if (conversationState.awaitingFollowUp && conversationState.pendingFollowUp) {
            const followUp = conversationState.pendingFollowUp;
            const missingField = followUp.missing_fields?.[0];

            const mergedFields = { ...followUp.original_fields };
            if (missingField === 'amount') {
                const amountMatch = text.match(/(\d+\.?\d*)/);
                if (amountMatch) mergedFields.amount = parseFloat(amountMatch[1]);
            } else if (missingField) {
                mergedFields[missingField] = text;
            }

            conversationState.awaitingFollowUp = false;
            conversationState.pendingFollowUp = null;

            const synthesized = `${mergedFields.datetime || ''}${mergedFields.type === '支出' ? '花费' : '收入'}${mergedFields.amount || ''}元 ${mergedFields.category || ''} ${mergedFields.note || ''}`.trim();
            await dispatchAndProcess(synthesized, mergedFields, imageData);
            return;
        }

        hideTyping();
        await dispatchAndProcess(text, null, imageData);
    }

    async function dispatchAndProcess(text, mergedFields = null, imageData = null) {
        // 合并用户文本 + OCR 文本
        let combinedText = text;
        if (imageData && imageData.ocrText) {
            combinedText = `[OCR识别文本]\n${imageData.ocrText}\n[/OCR]\n\n${text}`;
        }

        const conversationHistory = getConversationHistoryForLLM();
        const dispatchRequest = { text: combinedText, learning_context: getPromptContext(), conversation_history: conversationHistory };
        if (imageData) {
            dispatchRequest.ocr_summary = {
                mimeType: imageData.mimeType,
                sizeKB: (imageData.base64.length * 0.75 / 1024).toFixed(1),
                ocrLength: imageData.ocrText.length
            };
        }
        let dispatchResponse = null;
        let executeResult = null;
        let error = null;

        // 记录请求开始时间和图片摘要
        const startTime = Date.now();

        try {
            showThinking({ intent: '分析中...', confidence: 0 });
            await delay(200);

            dispatchResponse = await AgentCore.dispatch(combinedText, conversationHistory);
            dispatchResponse._inputText = text;

            // 计算请求耗时
            dispatchResponse._duration = Date.now() - startTime;
            dispatchResponse._hasImage = !!imageData;

            // 如果有合并的字段（追问回复），直接补充到 fields 中
            if (mergedFields && dispatchResponse.fields) {
                dispatchResponse.fields = { ...dispatchResponse.fields, ...mergedFields };
            }

            // 2. 更新意图识别结果
            updateThinking(dispatchResponse, 'intent');
            await delay(300);

            // 3. 显示 Skill 执行
            const skillMeta = dispatchResponse._skill || { displayName: '处理中' };
            updateThinking(dispatchResponse, 'execute', skillMeta.displayName);
            await delay(200);

            // 4. 执行
            executeResult = await AgentCore.execute(dispatchResponse);

            // 5. 折叠思考过程 — 使用 executeResult 中的最终 Skill 名称
            const finalSkill = executeResult._skill || dispatchResponse._skill || { displayName: '完成' };
            collapseThinking(dispatchResponse, finalSkill.displayName);

            // 6. 追加结果消息
            appendResultMessage(executeResult, dispatchResponse);

            // 记录调试日志
            const ocrSummary = imageData ? { mimeType: imageData.mimeType, ocrLength: imageData.ocrText.length } : null;
            addDebugLog(combinedText, dispatchRequest, dispatchResponse, executeResult, error, imageData ? { ...imageData, base64: null } : null);
        } catch (e) {
            const duration = Date.now() - startTime;
            error = e.message;
            hideThinking();
            addMessage('ai', '解析出错：' + e.message);
            addDebugLog(combinedText, dispatchRequest, { _duration: duration, _hasImage: !!imageData, _error: true }, null, error, imageData ? { ...imageData, base64: null } : null);
        }
    }

    function appendResultMessage(result, dispatchResult) {
        const skillMeta = result._skill || dispatchResult._skill;
        if (result.type === 'auto-save') {
            saveRecordToDB(result.fields, 'msg_auto_' + Date.now(), skillMeta);
        } else if (result.type === 'confirm') {
            conversationState.pendingRecord = result.fields;
            conversationState.waitingForConfirm = true;
            conversationState._recordSkill = skillMeta;
            appendSingleMessage('record-card', null, result.fields, skillMeta);
            chatHistory.push({
                type: 'record-card', content: null, data: result.fields,
                skillMeta, id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), timestamp: Date.now()
            });
            saveHistory();
        } else if (result.type === 'follow-up') {
            conversationState.awaitingFollowUp = true;
            conversationState.pendingFollowUp = result.followUp;
            const question = result.followUp.question || '请补充信息';
            // 显示缺失字段 + 自动填充的默认值
            const missingFields = result.followUp.missing_fields || [];
            const originalFields = result.followUp.original_fields || {};
            const autoFilled = {};
            if (!originalFields.account) autoFilled.account = '个人';
            if (!originalFields.payment) autoFilled.payment = '微信支付';
            appendSingleMessage('missing-fields', question, { question, missingFields, originalFields, autoFilled }, skillMeta);
            chatHistory.push({
                type: 'missing-fields', content: question, data: { question, missingFields, originalFields, autoFilled },
                skillMeta, id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), timestamp: Date.now()
            });
            saveHistory();
        } else if (result.type === 'query-result') {
            appendSingleMessage('query-result', result.content, result, skillMeta);
            chatHistory.push({
                type: 'query-result', content: result.content, data: result,
                skillMeta, id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), timestamp: Date.now()
            });
            saveHistory();
        } else if (result.type === 'stats-result') {
            appendSingleMessage('stats-result', result.content, result, skillMeta);
            chatHistory.push({
                type: 'stats-result', content: result.content, data: result,
                skillMeta, id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), timestamp: Date.now()
            });
            saveHistory();
        } else if (result.type === 'budget-result') {
            appendSingleMessage('budget-result', result.content, result, skillMeta);
            chatHistory.push({
                type: 'budget-result', content: result.content, data: result,
                skillMeta, id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), timestamp: Date.now()
            });
            saveHistory();
        } else if (result.type === 'collection-list') {
            appendSingleMessage('collection-list', result.content, result, skillMeta);
            chatHistory.push({
                type: 'collection-list', content: result.content, data: result,
                skillMeta, id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), timestamp: Date.now()
            });
            saveHistory();
        } else if (result.type === 'prompt-updated') {
            appendSingleMessage('prompt-updated', result.content, result, skillMeta);
            chatHistory.push({
                type: 'prompt-updated', content: result.content, data: result,
                skillMeta, id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), timestamp: Date.now()
            });
            saveHistory();
        } else if (result.type === 'preference-saved') {
            appendSingleMessage('preference-saved', result.content, result, skillMeta);
            chatHistory.push({
                type: 'preference-saved', content: result.content, data: result,
                skillMeta, id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), timestamp: Date.now()
            });
            saveHistory();
        } else if (result.type === 'correction-applied') {
            appendSingleMessage('correction-applied', result.content, result, skillMeta);
            chatHistory.push({
                type: 'correction-applied', content: result.content, data: result,
                skillMeta, id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), timestamp: Date.now()
            });
            saveHistory();
        } else if (result.type === 'text') {
            appendSingleMessage('ai', result.content, null, skillMeta);
            chatHistory.push({
                type: 'ai', content: result.content, data: null,
                skillMeta, id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), timestamp: Date.now()
            });
            saveHistory();
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

            const result = await NocobaseAPI.createRecord(data);
            const recordId = result?.data?.id;
            if (recordId) {
                window.__lastSavedRecordId = recordId;
            }

            const typeIcon = data.type === '支出' ? '' : '📥';
            // 构建更详细的确认消息
            const parts = [`${formatMoney(data.amount)} - ${data.category}`];
            if (data.payment_method && data.payment_method !== '微信支付') {
                parts.push(data.payment_method);
            }
            if (data.account && data.account !== '个人') {
                parts.push(data.account);
            }
            if (data.note) {
                parts.push(data.note);
            }
            if (data.datetime) {
                const recordDate = data.datetime.substring(0, 10);
                const today = new Date();
                const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                if (recordDate !== todayStr) {
                    parts.push(data.datetime.substring(0, 16));
                }
            }
            addMessage('ai', `${typeIcon} 已记录：${parts.join(' | ')}`, null, skillMeta);

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
            return `<button aria-label="${labels[f]}" onclick="ChatWidget.editField('${f}','${msgId}')">${labels[f]}</button>`;
        }).join('');

        addMessage('ai', `请选择要修改的字段：<div class="chat-quick-options">${options}</div>`);
    }

    async function editField(field, msgId) {
        const record = conversationState.pendingRecord;
        const prompts = {
            'type': '请输入类型（收入/支出）：',
            'amount': '请输入金额：',
            'datetime': '请输入时间：',
            'note': '请输入备注：'
        };

        // 纯文本输入的字段
        if (prompts[field]) {
            addMessage('ai', prompts[field]);
            conversationState.editingField = field;
            return;
        }

        // 分类字段：动态加载分类表 + 当前值
        if (field === 'category') {
            addMessage('ai', '请选择分类：', null);
            const msg = chatHistory[chatHistory.length - 1];
            let categories = [];
            try {
                const result = await NocobaseAPI.getCategories();
                const items = result.data || [];
                categories = items.map(c => c.name);
            } catch (e) { console.warn('加载分类失败:', e); }

            // 确保当前记录的值在选项中
            const currentValue = record?.category || '';
            if (currentValue && !categories.includes(currentValue)) {
                categories.unshift(currentValue);
            }
            if (categories.length === 0) {
                categories = ['餐饮', '交通出行', '购物', '通信费', '生活杂费', '其他'];
            }

            const buttons = categories.map(c =>
                `<button aria-label="${c}" onclick="ChatWidget.sendQuick('${c}')">${c}</button>`
            ).join('');
            msg.content += `<div class="chat-quick-options">${buttons}</div>`;
            saveHistory();
            renderMessages();
            conversationState.editingField = field;
            return;
        }

        // 支付方式字段：动态加载 + 当前值
        if (field === 'payment') {
            addMessage('ai', '请选择支付方式：', null);
            const msg = chatHistory[chatHistory.length - 1];
            let payments = [];
            try {
                const result = await NocobaseAPI.getPaymentMethods();
                const items = result.data || [];
                payments = items.map(p => p.name);
            } catch (e) { console.warn('加载支付方式失败:', e); }

            const currentValue = record?.payment || '';
            if (currentValue && !payments.includes(currentValue)) {
                payments.unshift(currentValue);
            }
            if (payments.length === 0) {
                payments = ['微信支付', '支付宝', '信用卡', '现金'];
            }

            const buttons = payments.map(p =>
                `<button aria-label="${p}" onclick="ChatWidget.sendQuick('${p}')">${p}</button>`
            ).join('');
            msg.content += `<div class="chat-quick-options">${buttons}</div>`;
            saveHistory();
            renderMessages();
            conversationState.editingField = field;
            return;
        }

        // 账户字段
        if (field === 'account') {
            addMessage('ai', '请输入账户（个人/家庭/公司）：');
            conversationState.editingField = field;
        }
    }

    async function fillMissing(field, msgId) {
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
            msg.content += `<div class="chat-quick-options"><button aria-label="支出" onclick="ChatWidget.sendQuick('支出')">支出</button><button aria-label="收入" onclick="ChatWidget.sendQuick('收入')">收入</button></div>`;
            saveHistory();
            renderMessages();
        } else if (field === 'category') {
            addMessage('ai', prompts[field], null);
            const msg = chatHistory[chatHistory.length - 1];
            let categories = [];
            try {
                const result = await NocobaseAPI.getCategories();
                const items = result.data || [];
                categories = items.filter(c => c.type === '支出').map(c => c.name);
            } catch (e) { console.warn('加载分类失败:', e); }
            if (categories.length === 0) {
                categories = ['餐饮', '交通出行', '购物', '通信费', '生活杂费', '其他'];
            }
            const buttons = categories.map(c =>
                `<button aria-label="${c}" onclick="ChatWidget.sendQuick('${c}')">${c}</button>`
            ).join('');
            msg.content += `<div class="chat-quick-options">${buttons}</div>`;
            saveHistory();
            renderMessages();
        } else if (field === 'payment') {
            addMessage('ai', prompts[field], null);
            const msg = chatHistory[chatHistory.length - 1];
            let payments = [];
            try {
                const result = await NocobaseAPI.getPaymentMethods();
                const items = result.data || [];
                payments = items.map(p => p.name);
            } catch (e) { console.warn('加载支付方式失败:', e); }
            if (payments.length === 0) {
                payments = ['微信支付', '支付宝', '信用卡', '现金'];
            }
            const buttons = payments.map(p =>
                `<button aria-label="${p}" onclick="ChatWidget.sendQuick('${p}')">${p}</button>`
            ).join('');
            msg.content += `<div class="chat-quick-options">${buttons}</div>`;
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
        conversationState.awaitingFollowUp = false;
        conversationState.pendingFollowUp = null;
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

    // ========== 图片处理 ==========

    function handleImageFile(file) {
        if (file.size > 10 * 1024 * 1024) {
            alert('图片文件过大，请选择小于 10MB 的图片');
            return;
        }
        if (!file.type.startsWith('image/')) {
            alert('请选择图片文件');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            compressImage(dataUrl, 1280, 0.9, (compressedUrl) => {
                generateThumbnail(dataUrl, (thumbnailUrl) => {
                    // 上传到后端 OCR 服务
                    fetch('/api/ai/ocr', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ base64: compressedUrl, mimeType: 'image/jpeg' })
                    })
                    .then(r => r.json())
                    .then(data => {
                        if (data.error) {
                            console.error('[OCR] 后端识别失败:', data.error);
                            pendingImage = {
                                base64: compressedUrl,
                                mimeType: 'image/jpeg',
                                size: file.size,
                                thumbnail: thumbnailUrl,
                                ocrText: ''
                            };
                        } else {
                            console.log('[OCR] PaddleOCR 识别结果:', data.text);
                            pendingImage = {
                                base64: compressedUrl,
                                mimeType: 'image/jpeg',
                                size: file.size,
                                thumbnail: thumbnailUrl,
                                ocrText: data.text || ''
                            };
                        }
                        showImagePreview(compressedUrl);
                    })
                    .catch(err => {
                        console.error('[OCR] 网络请求失败:', err);
                        pendingImage = {
                            base64: compressedUrl,
                            mimeType: 'image/jpeg',
                            size: file.size,
                            thumbnail: thumbnailUrl,
                            ocrText: ''
                        };
                        showImagePreview(compressedUrl);
                    });
                });
            });
        };
        reader.readAsDataURL(file);
    }

    function compressImage(dataUrl, maxWidth, quality, callback) {
        const img = new Image();
        img.onload = () => {
            let targetWidth = img.width;
            let targetHeight = img.height;
            if (targetWidth > maxWidth) {
                const scale = maxWidth / targetWidth;
                targetWidth = maxWidth;
                targetHeight = targetHeight * scale;
            }
            // 始终转为 JPEG，避免大 PNG 超出模型限制（7MB）
            const canvas = document.createElement('canvas');
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
            callback(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = dataUrl;
    }

    function generateThumbnail(dataUrl, callback) {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 200;
            const scale = Math.min(1, MAX_WIDTH / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            callback(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = dataUrl;
    }

    function showImagePreview(dataUrl) {
        const preview = document.getElementById('chat-image-preview');
        const img = document.getElementById('chat-preview-img');
        if (preview && img) {
            img.src = dataUrl;
            preview.style.display = 'flex';
        }
    }

    function clearPendingImage() {
        pendingImage = null;
        const preview = document.getElementById('chat-image-preview');
        const img = document.getElementById('chat-preview-img');
        const fileInput = document.getElementById('chat-file-input');
        if (preview) preview.style.display = 'none';
        if (img) img.src = '';
        if (fileInput) fileInput.value = '';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

export {
    init,
    sendQuick,
    confirmRecord,
    forceSaveRecord,
    cancelRecord,
    editRecord,
    editField,
    fillMissing,
    copyDebugLog,
    showDebugPanel,
    closeDebugPanel,
    copyAllDebug,
    clearDebug,
    showRulesPanel,
    closeRulesPanel,
    copyRuleContent,
    saveRuleContent
};

function copyAllDebug() { copyDebugLog(); }
function clearDebug() { debugLog = []; localStorage.removeItem(DEBUG_KEY); showDebugPanel(); }
function closeDebugPanel() { const p = document.getElementById('chat-debug-panel'); if (p) p.remove(); }

// ========== 规则管理面板 ==========

let rulesPanelState = { activeTab: 'preferences' };

function showRulesPanel() {
    const existing = document.getElementById('chat-rules-panel');
    if (existing) {
        existing.remove();
        return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'chat-rules-panel';
    overlay.innerHTML = `
        <div class="chat-debug-content">
            <div class="chat-debug-header">
                <span>偏好和规则管理</span>
                <div class="chat-debug-actions">
                    <button onclick="ChatWidget.copyRuleContent()" title="复制">📋 复制</button>
                    <button onclick="ChatWidget.saveRuleContent()" title="保存" id="chat-rule-save-btn" style="display:none">💾 保存</button>
                    <button onclick="ChatWidget.closeRulesPanel()" title="关闭" class="chat-debug-close">✕</button>
                </div>
            </div>
            <div class="chat-rules-tabs">
                <button class="chat-rule-tab ${rulesPanelState.activeTab === 'dispatch' ? 'active' : ''}" data-tab="dispatch">dispatch.md</button>
                <button class="chat-rule-tab ${rulesPanelState.activeTab === 'record' ? 'active' : ''}" data-tab="record">record.md</button>
                <button class="chat-rule-tab ${rulesPanelState.activeTab === 'preferences' ? 'active' : ''}" data-tab="preferences">preferences.md</button>
            </div>
            <div class="chat-debug-body">
                <div id="chat-rule-content" class="chat-rule-content">加载中...</div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Tab 切换
    overlay.querySelectorAll('.chat-rule-tab').forEach(btn => {
        btn.addEventListener('click', () => switchRuleTab(btn.dataset.tab));
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    loadRuleContent(rulesPanelState.activeTab);
}

async function switchRuleTab(tab) {
    rulesPanelState.activeTab = tab;
    document.querySelectorAll('.chat-rule-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    const saveBtn = document.getElementById('chat-rule-save-btn');
    if (saveBtn) saveBtn.style.display = tab === 'preferences' ? 'inline-block' : 'none';
    await loadRuleContent(tab);
}

async function loadRuleContent(tab) {
    const contentEl = document.getElementById('chat-rule-content');
    if (!contentEl) return;
    contentEl.textContent = '加载中...';

    try {
        let response;
        if (tab === 'preferences') {
            response = await fetch('/api/ai/preference', { method: 'GET' });
        } else {
            response = await fetch(`/api/ai/prompt/${tab}`, { method: 'GET' });
        }
        const data = await response.json();
        const content = data.content || '(空文件)';

        if (tab === 'preferences') {
            contentEl.innerHTML = `<textarea id="chat-rule-textarea" spellcheck="false">${escapeHtml(content)}</textarea>`;
        } else {
            contentEl.innerHTML = `<pre class="chat-rule-readonly">${escapeHtml(content)}</pre>`;
        }
    } catch (e) {
        contentEl.textContent = '加载失败：' + e.message;
    }
}

function copyRuleContent() {
    const textarea = document.getElementById('chat-rule-textarea');
    const readonly = document.querySelector('.chat-rule-readonly');
    const text = textarea ? textarea.value : (readonly ? readonly.textContent : '');
    navigator.clipboard.writeText(text).then(() => {
        alert('已复制到剪贴板');
    }).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        alert('已复制到剪贴板');
    });
}

async function saveRuleContent() {
    const textarea = document.getElementById('chat-rule-textarea');
    if (!textarea) return;
    const newContent = textarea.value;
    const saveBtn = document.getElementById('chat-rule-save-btn');
    if (saveBtn) saveBtn.disabled = true;

    try {
        const response = await fetch('/api/ai/preference', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: newContent })
        });
        const data = await response.json();
        if (data.error) {
            alert('保存失败：' + data.error);
        } else {
            alert('偏好已保存');
        }
    } catch (e) {
        alert('保存失败：' + e.message);
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function closeRulesPanel() { const p = document.getElementById('chat-rules-panel'); if (p) p.remove(); }
