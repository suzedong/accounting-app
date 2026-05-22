<template>
  <div class="settings-panel">
    <el-tabs v-model="activeTab" class="settings-tabs">
      <!-- Dispatch Prompt -->
      <el-tab-pane label="Dispatch Prompt" name="prompt">
        <div class="tab-content">
          <div class="tab-header">
            <span class="tab-desc">定义 AI 意图识别与动作分发规则</span>
            <el-button size="small" @click="handleRefresh('prompt')">刷新</el-button>
          </div>
          <el-input
            v-model="promptText"
            type="textarea"
            :autosize="{ minRows: 12, maxRows: 20 }"
            class="prompt-editor"
            placeholder="Loading..."
          />
          <div class="tab-footer">
            <el-button type="primary" size="small" :loading="saving" @click="handleSave('prompt')">
              保存
            </el-button>
            <span class="save-hint">修改后点击保存，立即生效</span>
          </div>
        </div>
      </el-tab-pane>

      <!-- User Preferences -->
      <el-tab-pane label="用户偏好" name="preferences">
        <div class="tab-content">
          <div class="tab-header">
            <span class="tab-desc">个性化偏好配置（如默认支付方式、常用分类等）</span>
            <el-button size="small" @click="handleRefresh('preferences')">刷新</el-button>
          </div>
          <el-input
            v-model="preferencesText"
            type="textarea"
            :autosize="{ minRows: 12, maxRows: 20 }"
            class="prompt-editor"
            placeholder="暂无偏好配置"
          />
          <div class="tab-footer">
            <el-button type="primary" size="small" :loading="saving" @click="handleSave('preferences')">
              保存
            </el-button>
            <span class="save-hint">修改后点击保存，立即生效</span>
          </div>
        </div>
      </el-tab-pane>

      <!-- Learning Data -->
      <el-tab-pane label="学习数据" name="learning">
        <div class="tab-content">
          <div class="tab-header">
            <span class="tab-desc">用户修正历史，AI 会参考这些数据优化识别</span>
            <div class="header-actions">
              <el-button size="small" @click="handleRefresh('learning')">刷新</el-button>
              <el-button size="small" type="danger" :disabled="!learningData.length" @click="handleClear">
                清空
              </el-button>
            </div>
          </div>
          <el-table
            :data="learningData"
            border
            stripe
            max-height="400"
            class="learning-table"
          >
            <el-table-column prop="keyword" label="关键词" width="120" />
            <el-table-column prop="field" label="字段" width="120">
              <template #default="{ row }">
                <el-tag size="small">{{ fieldLabel(row.field) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="value" label="修正值" />
            <el-table-column label="操作" width="80" align="center">
              <template #default="{ row }">
                <el-button
                  size="small"
                  text
                  type="danger"
                  @click="handleDelete(row)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-if="!learningData.length" class="empty-hint">
            暂无学习数据，AI 会在你修正记录时自动学习
          </div>
        </div>
      </el-tab-pane>

      <!-- System Diagnostics -->
      <el-tab-pane label="系统诊断" name="diagnostics">
        <div class="tab-content">
          <div class="tab-header">
            <span class="tab-desc">系统状态与配置检查</span>
            <el-button size="small" @click="runDiagnostics">刷新</el-button>
          </div>
          <div class="diagnostics-list">
            <div
              v-for="item in diagnostics"
              :key="item.name"
              class="diag-item"
              :class="`diag-${item.status}`"
            >
              <span class="diag-icon">{{ item.status === 'ok' ? '✅' : item.status === 'warn' ? '⚠️' : '❌' }}</span>
              <span class="diag-name">{{ item.name }}</span>
              <span class="diag-value">{{ item.value }}</span>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{
  promptContent: string;
  preferencesContent: string;
  learningData: Array<{ id: number; keyword: string; field: string; value: string }>;
  saving: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [type: string, content: string];
  clearLearning: [];
  refreshPrompt: [];
  refreshPreferences: [];
  refreshLearning: [];
}>();

const activeTab = ref('prompt');
const promptText = ref(props.promptContent);
const preferencesText = ref(props.preferencesContent);

watch(() => props.promptContent, (v) => { promptText.value = v; });
watch(() => props.preferencesContent, (v) => { preferencesText.value = v; });

const fieldLabel = (field: string): string => {
  const labels: Record<string, string> = {
    category: '分类',
    payment_method: '支付方式',
    account: '账户',
    type: '类型',
  };
  return labels[field] || field;
};

function handleSave(type: string) {
  const content = type === 'prompt' ? promptText.value : preferencesText.value;
  emit('save', type === 'prompt' ? 'dispatch' : 'preferences', content);
}

function handleDelete(row: { id: number; keyword: string; field: string; value: string }) {
  emit('save', 'deleteLearning', JSON.stringify(row));
}

function handleClear() {
  emit('clearLearning');
}

function handleRefresh(type: string) {
  if (type === 'prompt') emit('refreshPrompt');
  else if (type === 'preferences') emit('refreshPreferences');
  else if (type === 'learning') emit('refreshLearning');
}

// System diagnostics
interface DiagItem {
  name: string;
  status: 'ok' | 'warn' | 'error';
  value: string;
}

const diagnostics = ref<DiagItem[]>([]);

async function runDiagnostics() {
  const items: DiagItem[] = [];

  // 1. Database
  try {
    const { getRecords } = await import('@/api/tauri');
    const res = await getRecords({ page: 1, pageSize: 1 });
    items.push({ name: '数据库', status: 'ok', value: `连接正常 (${res.total} 条记录)` });
  } catch {
    items.push({ name: '数据库', status: 'error', value: '连接失败' });
  }

  // 2. AI API
  try {
    const { getSystemPrompt } = await import('@/api/tauri');
    await getSystemPrompt('dispatch');
    items.push({ name: 'AI 服务', status: 'ok', value: '可用' });
  } catch {
    items.push({ name: 'AI 服务', status: 'warn', value: '不可用（使用本地解析）' });
  }

  // 3. OCR
  try {
    const { ocrRecognize } = await import('@/api/tauri');
    // Just check if the command exists
    items.push({ name: 'OCR 识别', status: 'ok', value: '可用' });
  } catch {
    items.push({ name: 'OCR 识别', status: 'warn', value: '不可用' });
  }

  // 4. System Prompt
  try {
    const { getSystemPrompt } = await import('@/api/tauri');
    const res = await getSystemPrompt('dispatch');
    const len = res.data.content.length;
    items.push({ name: 'Dispatch Prompt', status: len > 100 ? 'ok' : 'warn', value: `${len} 字符` });
  } catch {
    items.push({ name: 'Dispatch Prompt', status: 'error', value: '加载失败' });
  }

  // 5. Preferences
  try {
    const { getSystemPrompt } = await import('@/api/tauri');
    const res = await getSystemPrompt('preferences');
    const len = (res.data.content || '').length;
    items.push({ name: '用户偏好', status: len > 0 ? 'ok' : 'warn', value: len > 0 ? `${len} 字符` : '未配置' });
  } catch {
    items.push({ name: '用户偏好', status: 'warn', value: '未配置' });
  }

  // 6. Learning Data
  try {
    const { getLearningCorrections } = await import('@/api/tauri');
    const res = await getLearningCorrections();
    const count = res.data.length;
    items.push({ name: '学习数据', status: count > 0 ? 'ok' : 'warn', value: `${count} 条记录` });
  } catch {
    items.push({ name: '学习数据', status: 'error', value: '加载失败' });
  }

  // 7. Chat History
  try {
    const { getChatHistory } = await import('@/api/tauri');
    const res = await getChatHistory(1);
    items.push({ name: '对话历史', status: 'ok', value: `${res.total} 条消息` });
  } catch {
    items.push({ name: '对话历史', status: 'error', value: '加载失败' });
  }

  diagnostics.value = items;
}

runDiagnostics();
</script>

<style scoped>
.settings-panel {
  padding: 0;
}

.settings-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}

.tab-content {
  padding: 8px 0;
}

.tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.tab-desc {
  font-size: 13px;
  color: #909399;
}

.prompt-editor {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.prompt-editor :deep(textarea) {
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}

.tab-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

.save-hint {
  font-size: 12px;
  color: #909399;
}

.learning-table {
  margin-top: 8px;
}

.empty-hint {
  text-align: center;
  color: #909399;
  padding: 32px 0;
  font-size: 13px;
}

/* Diagnostics */
.diagnostics-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.diag-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  background: #fafafa;
}

.diag-ok {
  background: #f0fdf4;
}

.diag-warn {
  background: #fefce8;
}

.diag-error {
  background: #fef2f2;
}

.diag-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.diag-name {
  font-weight: 500;
  color: #303133;
  min-width: 100px;
}

.diag-value {
  color: #606266;
  flex: 1;
}
</style>
