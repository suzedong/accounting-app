<template>
  <div class="debug-panel">
    <div class="debug-header">
      <span>调试面板</span>
      <el-button size="small" text @click="$emit('close')">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>
    <div class="debug-content">
      <!-- Last Dispatch Result -->
      <div class="debug-section">
        <h4>LLM Dispatch 结果</h4>
        <pre class="debug-json">{{ dispatchResult ? formatJson(dispatchResult) : '无' }}</pre>
      </div>

      <!-- Last Action Result -->
      <div class="debug-section">
        <h4>Action 执行结果</h4>
        <pre class="debug-json">{{ actionResult ? formatJson(actionResult) : '无' }}</pre>
      </div>

      <!-- Messages -->
      <div class="debug-section">
        <h4>消息历史 ({{ messageCount }} 条)</h4>
        <pre class="debug-json">{{ messagesSummary || '无' }}</pre>
      </div>

      <!-- Error -->
      <div v-if="lastError" class="debug-section error">
        <h4>最后错误</h4>
        <pre class="debug-json">{{ lastError }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Close } from '@element-plus/icons-vue';

defineProps<{
  dispatchResult?: Record<string, unknown> | null;
  actionResult?: Record<string, unknown> | null;
  messageCount?: number;
  messagesSummary?: string;
  lastError?: string | null;
}>();

defineEmits<{
  close: [];
}>();

function formatJson(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}
</script>

<style scoped>
.debug-panel {
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: 8px;
  padding: 12px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 0.85em;
}

.debug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #333;
  color: #fff;
  font-weight: 600;
}

.debug-section {
  margin-bottom: 12px;
}

.debug-section h4 {
  margin: 0 0 4px 0;
  color: #9cdcfe;
  font-size: 0.9em;
}

.debug-section.error h4 {
  color: #f48771;
}

.debug-json {
  background: #252526;
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 0.9em;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  max-height: 200px;
  overflow-y: auto;
}
</style>
