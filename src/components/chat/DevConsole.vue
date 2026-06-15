<template>
  <div v-if="show" class="dev-console-overlay" @click.self="close">
    <div class="dev-console">
      <div class="dev-console-header">
        <span class="dev-console-title">调试控制台 (Ctrl+`)</span>
        <div class="dev-console-actions">
          <el-button size="small" text @click="copyAllTabs">复制全部</el-button>
          <el-button size="small" text @click="copyActiveTab">复制</el-button>
          <el-button size="small" text @click="clearActiveTab">清空</el-button>
          <el-button size="small" text @click="close">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- Tab bar -->
      <div class="dev-console-tabs">
        <div
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-item"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span class="tab-count">{{ getTabCount(tab.key) }}</span>
        </div>
      </div>

      <div class="dev-console-body">
        <!-- IPC Tab -->
        <div v-if="activeTab === 'ipc'" class="tab-content">
          <div v-if="ipcLogs.length === 0" class="empty-state">
            暂无 IPC 调用记录
            <div class="empty-hint">应用启动后所有 invoke() 调用会自动记录</div>
          </div>
          <div v-for="log in ipcLogs.slice().reverse()" :key="log.id" class="log-entry">
            <div class="log-header" @click="log.expanded = !log.expanded">
              <span class="log-id">#{{ log.id }}</span>
              <span class="log-req-id" :title="'请求 ID: ' + log.requestId">{{ truncate(log.requestId, 12) }}</span>
              <span class="log-time">{{ log.timestamp }}</span>
              <span class="log-latency" :class="latencyClass(log.latency)">{{ log.latency }}ms</span>
              <span class="log-command" :class="{ error: !log.success }">{{ log.command }}</span>
              <el-tag v-if="!log.success" type="danger" size="small" class="error-tag">失败</el-tag>
              <span class="log-chevron" :class="{ rotated: log.expanded }">▾</span>
            </div>
            <div v-show="log.expanded" class="log-detail">
              <div class="log-section">
                <div class="log-section-header">
                  <span>参数</span>
                  <el-button size="small" text @click.stop="copyJson(log.params)">复制</el-button>
                </div>
                <pre class="log-code">{{ formatJson(log.params) }}</pre>
              </div>
              <div class="log-section" v-if="log.success">
                <div class="log-section-header">
                  <span>返回值</span>
                  <el-button size="small" text @click.stop="copyJson(log.result)">复制</el-button>
                </div>
                <pre class="log-code">{{ formatJson(log.result) }}</pre>
              </div>
              <div class="log-section" v-else>
                <div class="log-section-header">
                  <span>错误</span>
                </div>
                <pre class="log-code error-text">{{ log.error }}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- LLM Tab -->
        <div v-if="activeTab === 'llm'" class="tab-content">
          <div v-if="llmLogs.length === 0" class="empty-state">
            暂无 LLM 调用记录
            <div class="empty-hint">发送 AI 消息后会实时显示 LLM 请求</div>
          </div>
          <div v-for="log in llmLogs.slice().reverse()" :key="log.id" class="log-entry">
            <div class="log-header" @click="log.expanded = !log.expanded">
              <span class="log-id">#{{ log.id }}</span>
              <span class="log-req-id" :title="'请求 ID: ' + log.requestId">{{ truncate(log.requestId, 12) }}</span>
              <span class="log-time">{{ log.timestamp }}</span>
              <span class="log-latency" :class="latencyClass(log.latency)">{{ log.latency }}ms</span>
              <span class="log-user-text" :class="{ error: isLLMError(log) }">{{ truncate(log.userMessage, 60) }}</span>
              <el-tag v-if="isLLMError(log)" type="danger" size="small" class="error-tag">失败</el-tag>
              <span class="log-chevron" :class="{ rotated: log.expanded }">▾</span>
            </div>
            <div v-show="log.expanded" class="log-detail">
              <!-- System Prompt 默认折叠，点击展开 -->
              <div class="log-section log-section-collapsible" @click="log.systemExpanded = !log.systemExpanded">
                <div class="log-section-header">
                  <span>System Prompt <span class="collapse-hint">(点击{{ log.systemExpanded ? '折叠' : '展开' }})</span></span>
                  <el-button size="small" text @click.stop="copyText(log.systemMessage)">复制</el-button>
                </div>
                <pre v-show="log.systemExpanded" class="log-code">{{ log.systemMessage }}</pre>
              </div>
              <div class="log-section">
                <div class="log-section-header">
                  <span>用户消息</span>
                  <el-button size="small" text @click.stop="copyText(log.userMessage)">复制</el-button>
                </div>
                <pre class="log-code">{{ log.userMessage }}</pre>
              </div>
              <div class="log-section">
                <div class="log-section-header">
                  <span>{{ isLLMError(log) ? '错误' : 'AI 响应' }}</span>
                  <el-button size="small" text @click.stop="copyText(log.response)">复制</el-button>
                </div>
                <pre class="log-code" :class="{ 'error-text': isLLMError(log) }">{{ log.response }}</pre>
              </div>
            </div>
          </div>
        </div>

        <!-- Rust Tab -->
        <div v-if="activeTab === 'rust'" class="tab-content">
          <div v-if="rustLogs.length === 0" class="empty-state">
            暂无 Rust 端日志
            <div class="empty-hint">Rust 端通过 app_log 事件发送的日志将显示在这里</div>
          </div>
          <div v-for="log in rustLogs.slice().reverse()" :key="log.id" class="log-entry rust-log-entry">
            <div class="log-header" @click="log.expanded = !log.expanded">
              <span class="log-id">#{{ log.id }}</span>
              <span class="log-time">{{ log.timestamp }}</span>
              <el-tag :type="rustLogLevelType(log.level)" size="small" class="level-tag">{{ log.level }}</el-tag>
              <span class="log-module">{{ log.module }}</span>
              <span class="log-user-text">{{ truncate(log.message, 80) }}</span>
              <span v-if="log.latencyMs != null" class="log-latency" :class="latencyClass(log.latencyMs!)">{{ log.latencyMs }}ms</span>
              <span class="log-chevron" :class="{ rotated: log.expanded }">▾</span>
            </div>
            <div v-show="log.expanded" class="log-detail">
              <pre class="log-code">{{ log.message }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Close } from '@element-plus/icons-vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { agentEngine, type LLMLogEntry } from '@/ai/agent-engine';
import { getIpcLogs, clearIpcLogs, addIpcListener, type IpcLogEntry } from '@/utils/invoke-logger';

// ============================================================
// Tab state
// ============================================================

const show = ref(false);
const activeTab = ref<'ipc' | 'llm' | 'rust'>('ipc');

const tabs = [
  { key: 'ipc' as const, label: 'IPC 调用' },
  { key: 'llm' as const, label: 'LLM 请求' },
  { key: 'rust' as const, label: 'Rust 端' },
];

function getTabCount(key: string): number {
  if (key === 'ipc') return ipcLogs.value.length;
  if (key === 'llm') return llmLogs.value.length;
  if (key === 'rust') return rustLogs.value.length;
  return 0;
}

// ============================================================
// IPC logs
// ============================================================

interface IpcLogExpanded extends IpcLogEntry { expanded?: boolean }
const ipcLogs = ref<IpcLogExpanded[]>([]);

let ipcUnsub: (() => void) | null = null;

// ============================================================
// LLM logs
// ============================================================

const llmLogs = ref<(LLMLogEntry & { expanded?: boolean; systemExpanded?: boolean })[]>([]);
let llmUnsub: (() => void) | null = null;

// ============================================================
// Rust logs (from app_log events)
// ============================================================

interface RustLogEntry {
  id: number;
  level: string;
  module: string;
  message: string;
  timestamp: string;
  latencyMs?: number;
  requestId?: string;
  expanded?: boolean;
}

const rustLogs = ref<RustLogEntry[]>([]);
let rustUnlisten: UnlistenFn | null = null;

// ============================================================
// Lifecycle
// ============================================================

function toggle() {
  show.value = !show.value;
  if (show.value) refresh();
}

function close() {
  show.value = false;
}

function refresh() {
  ipcLogs.value = getIpcLogs().map(e => ({ ...e, expanded: false }));
  const entries = agentEngine.getLLMLogs();
  llmLogs.value = entries.map(e => ({ ...e, expanded: false }));
  // Rust logs are already up-to-date (event-driven)
}

function clearActiveTab() {
  // 清空所有三个 tab 的日志
  clearIpcLogs();
  ipcLogs.value = [];
  agentEngine.clearLLMLogs();
  llmLogs.value = [];
  rustLogs.value = [];
  ElMessage.success('所有日志已清空');
}

function copyActiveTab() {
  let text = '';
  if (activeTab.value === 'ipc') {
    text = ipcLogs.value.map(log =>
      `[#${log.id}] req:${log.requestId} ${log.timestamp} ${log.command} (${log.latency}ms)\n` +
      `参数: ${JSON.stringify(log.params)}\n` +
      (log.success ? `结果: ${JSON.stringify(log.result)}` : `错误: ${log.error}`) +
      '\n---',
    ).join('\n');
  } else if (activeTab.value === 'llm') {
    text = llmLogs.value.map(log =>
      `[#${log.id}] req:${log.requestId} ${log.timestamp} (${log.latency}ms)${isLLMError(log) ? ' [失败]' : ''}\n` +
      `用户: ${log.userMessage}\n` +
      `AI: ${log.response}\n` +
      `System Prompt: ${log.systemMessage.substring(0, 200)}${log.systemMessage.length > 200 ? '...' : ''}\n` +
      '---',
    ).join('\n');
  } else {
    text = rustLogs.value.map(log =>
      `[#${log.id}] ${log.timestamp} [${log.level}] [${log.module}] ${log.message}` +
      (log.latencyMs != null ? ` (${log.latencyMs}ms)` : '') +
      '\n',
    ).join('\n');
  }
  navigator.clipboard.writeText(text);
  ElMessage.success('已复制到剪贴板');
}

function copyAllTabs() {
  const sections: string[] = [];
  sections.push('=== IPC 调用 ===');
  if (ipcLogs.value.length === 0) {
    sections.push('(无记录)');
  } else {
    sections.push(ipcLogs.value.map(log =>
      `[#${log.id}] req:${log.requestId} ${log.timestamp} ${log.command} (${log.latency}ms)\n` +
      `参数: ${JSON.stringify(log.params)}\n` +
      (log.success ? `结果: ${JSON.stringify(log.result)}` : `错误: ${log.error}`),
    ).join('\n---\n'));
  }
  sections.push('\n\n=== LLM 请求 ===');
  if (llmLogs.value.length === 0) {
    sections.push('(无记录)');
  } else {
    sections.push(llmLogs.value.map(log =>
      `[#${log.id}] req:${log.requestId} ${log.timestamp} (${log.latency}ms)${isLLMError(log) ? ' [失败]' : ''}\n` +
      `用户: ${log.userMessage}\n` +
      `AI: ${log.response}\n` +
      `System Prompt: ${log.systemMessage.substring(0, 200)}${log.systemMessage.length > 200 ? '...' : ''}`,
    ).join('\n---\n'));
  }
  sections.push('\n\n=== Rust 端日志 ===');
  if (rustLogs.value.length === 0) {
    sections.push('(无记录)');
  } else {
    sections.push(rustLogs.value.map(log =>
      `[#${log.id}] ${log.timestamp} [${log.level}] [${log.module}] ${log.message}` +
      (log.latencyMs != null ? ` (${log.latencyMs}ms)` : ''),
    ).join('\n'));
  }
  navigator.clipboard.writeText(sections.join('\n'));
  ElMessage.success('已复制全部日志');
}

// ============================================================
// Helpers
// ============================================================

function copyText(text: string) {
  navigator.clipboard.writeText(text);
  ElMessage.success('已复制到剪贴板');
}

function copyJson(data: unknown) {
  navigator.clipboard.writeText(formatJson(data));
  ElMessage.success('已复制到剪贴板');
}

function formatJson(data: unknown): string {
  try { return JSON.stringify(data, null, 2); } catch { return String(data); }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max) + '...' : text;
}

function latencyClass(latency: number): string {
  if (latency < 500) return 'latency-fast';
  if (latency < 2000) return 'latency-normal';
  return 'latency-slow';
}

function isLLMError(log: LLMLogEntry): boolean {
  return log.response.startsWith('[错误]');
}

function rustLogLevelType(level: string): 'success' | 'warning' | 'danger' | 'info' {
  if (level === 'error') return 'danger';
  if (level === 'warn') return 'warning';
  if (level === 'info' || level === 'sql') return 'success';
  if (level === 'debug') return 'info';
  return 'info';
}

// ============================================================
// Watchers & listeners
// ============================================================

watch(show, (val) => { if (val) refresh(); });

watch(activeTab, () => { refresh(); });

onMounted(async () => {
  // Listen for new IPC log entries in real-time
  ipcUnsub = addIpcListener((entry) => {
    if (show.value && activeTab.value === 'ipc') {
      ipcLogs.value.push({ ...entry, expanded: false });
    }
  });

  // Listen for new LLM log entries in real-time
  llmUnsub = agentEngine.addLLMListener((entry) => {
    llmLogs.value.push({ ...entry, expanded: false });
  });

  // Listen for Rust app_log events. Always collect after mount to avoid losing logs.
  rustUnlisten = await listen('app_log', (event: unknown) => {
    const payload = event as { payload: RustLogEntry };
    rustLogs.value.push({ ...payload.payload, expanded: false });
  });
});

onUnmounted(() => {
  ipcUnsub?.();
  llmUnsub?.();
  rustUnlisten?.();
});

defineExpose({ toggle });
</script>

<style scoped>
.dev-console-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 10000;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 20px;
}

.dev-console {
  width: 750px;
  max-height: 70vh;
  background: #1e1e1e;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.dev-console-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #2d2d2d;
  border-bottom: 1px solid #3e3e3e;
}

.dev-console-title {
  font-size: 13px;
  font-weight: 600;
  color: #d4d4d4;
}

.dev-console-actions {
  display: flex;
  gap: 4px;
}

.dev-console-actions :deep(.el-button) {
  color: #9cdcfe;
}

/* Tab bar */
.dev-console-tabs {
  display: flex;
  background: #252526;
  border-bottom: 1px solid #3e3e3e;
}

.tab-item {
  padding: 8px 16px;
  font-size: 12px;
  color: #969696;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, color 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab-item:hover {
  background: #2d2d2d;
  color: #d4d4d4;
}

.tab-item.active {
  color: #d4d4d4;
  background: #1e1e1e;
  border-bottom: 2px solid #007acc;
}

.tab-count {
  font-size: 10px;
  background: #3c3c3c;
  color: #969696;
  padding: 1px 6px;
  border-radius: 8px;
  min-width: 16px;
  text-align: center;
}

.tab-item.active .tab-count {
  background: #007acc;
  color: #fff;
}

.dev-console-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.tab-content {
  min-height: 200px;
}

.empty-state {
  text-align: center;
  color: #808080;
  padding: 40px 0;
  font-size: 13px;
}

.empty-hint {
  margin-top: 8px;
  font-size: 11px;
  color: #666;
}

/* Log entry */
.log-entry {
  margin-bottom: 4px;
  border-radius: 4px;
  overflow: hidden;
}

.log-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  background: #252526;
  font-size: 12px;
  transition: background 0.15s;
}

.log-header:hover {
  background: #2d2d2d;
}

.log-id {
  color: #569cd6;
  font-weight: 600;
  min-width: 30px;
}

.log-req-id {
  color: #c586c0;
  font-size: 10px;
  font-family: monospace;
  cursor: help;
}

.log-time {
  color: #6a9955;
  min-width: 70px;
}

.log-latency {
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  min-width: 55px;
  text-align: center;
}

.latency-fast {
  color: #4ec9b0;
  background: rgba(78, 201, 176, 0.15);
}

.latency-normal {
  color: #dcdcaa;
  background: rgba(220, 220, 170, 0.15);
}

.latency-slow {
  color: #f44747;
  background: rgba(244, 71, 71, 0.15);
}

.log-command {
  color: #ce9178;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-command.error {
  color: #f44747;
}

.log-user-text {
  color: #ce9178;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-user-text.error {
  color: #f44747;
}

.log-module {
  color: #569cd6;
  min-width: 40px;
  font-weight: 600;
}

.level-tag {
  min-width: 36px;
  text-align: center;
}

.error-tag {
  font-size: 10px;
}

.log-chevron {
  font-size: 10px;
  color: #808080;
  transition: transform 0.2s;
}

.log-chevron.rotated {
  transform: rotate(180deg);
}

/* Log detail */
.log-detail {
  padding: 8px 0;
}

.log-section {
  margin-bottom: 8px;
}

.log-section-collapsible {
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s;
}

.log-section-collapsible:hover {
  background: rgba(255, 255, 255, 0.03);
}

.collapse-hint {
  font-size: 10px;
  color: #666;
  font-weight: normal;
  text-transform: none;
}

.log-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 12px;
  color: #9cdcfe;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
}

.log-code {
  margin: 0;
  padding: 8px 16px 8px 24px;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-word;
  background: #1e1e1e;
  max-height: 300px;
  overflow-y: auto;
}

.log-code.error-text {
  color: #f44747;
}

/* Rust log entry */
.rust-log-entry .log-header {
  background: #222222;
}
</style>
