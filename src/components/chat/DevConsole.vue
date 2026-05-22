<template>
  <div v-if="show" class="dev-console-overlay" @click.self="close">
    <div class="dev-console">
      <div class="dev-console-header">
        <span class="dev-console-title">开发者控制台 (Ctrl+`)</span>
        <div class="dev-console-actions">
          <el-button size="small" text @click="copyAll">复制全部</el-button>
          <el-button size="small" text @click="clearLogs">清空</el-button>
          <el-button size="small" text @click="close">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>
      </div>

      <div class="dev-console-body">
        <div v-if="logs.length === 0" class="empty-state">
          暂无 LLM 调用记录
        </div>

        <div v-for="log in logs.slice().reverse()" :key="log.id" class="log-entry">
          <div class="log-header" @click="log.expanded = !log.expanded">
            <span class="log-id">#{{ log.id }}</span>
            <span class="log-time">{{ log.timestamp }}</span>
            <span class="log-latency" :class="latencyClass(log.latency)">{{ log.latency }}ms</span>
            <span class="log-user-text">{{ truncate(log.userMessage, 60) }}</span>
            <span class="log-chevron" :class="{ rotated: log.expanded }">▾</span>
          </div>

          <div v-show="log.expanded" class="log-detail">
            <div class="log-section">
              <div class="log-section-header">
                <span>请求 System Prompt</span>
                <el-button size="small" text @click.stop="copyText(log.systemMessage)">复制</el-button>
              </div>
              <pre class="log-code">{{ log.systemMessage }}</pre>
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
                <span>AI 响应</span>
                <el-button size="small" text @click.stop="copyText(log.response)">复制</el-button>
              </div>
              <pre class="log-code">{{ log.response }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Close } from '@element-plus/icons-vue';
import { agentEngine, type LLMLogEntry } from '@/ai/agent-engine';

const show = ref(false);
const logs = ref<(LLMLogEntry & { expanded?: boolean })[]>([]);

function toggle() {
  show.value = !show.value;
  if (show.value) {
    refresh();
  }
}

function close() {
  show.value = false;
}

function refresh() {
  const entries = agentEngine.getLLMLogs();
  logs.value = entries.map(e => ({ ...e, expanded: false }));
}

function clearLogs() {
  agentEngine.clearLLMLogs();
  logs.value = [];
  ElMessage.success('日志已清空');
}

function copyText(text: string) {
  navigator.clipboard.writeText(text);
  ElMessage.success('已复制到剪贴板');
}

function copyAll() {
  const text = logs.value.map(log =>
    `[#${log.id}] ${log.timestamp} (${log.latency}ms)\n` +
    `用户: ${log.userMessage}\n` +
    `AI: ${log.response}\n` +
    `---`,
  ).join('\n');
  navigator.clipboard.writeText(text);
  ElMessage.success('全部日志已复制');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max) + '...' : text;
}

function latencyClass(latency: number): string {
  if (latency < 1000) return 'latency-fast';
  if (latency < 3000) return 'latency-normal';
  return 'latency-slow';
}

// 暴露方法给外部
defineExpose({ toggle });

// 监听显示状态，每次打开时刷新
watch(show, (val) => {
  if (val) refresh();
});
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
  width: 700px;
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

.dev-console-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.empty-state {
  text-align: center;
  color: #808080;
  padding: 40px 0;
  font-size: 13px;
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

.log-user-text {
  color: #ce9178;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
</style>
