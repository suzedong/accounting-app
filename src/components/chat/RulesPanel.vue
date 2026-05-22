<template>
  <div class="rules-panel">
    <div class="rules-header">
      <span>设置</span>
      <el-button size="small" text @click="$emit('close')">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>

    <el-tabs v-model="activeTab" class="rules-tabs">
      <el-tab-pane label="Dispatch Prompt" name="dispatch" />
      <el-tab-pane label="用户偏好" name="preferences" />
      <el-tab-pane label="学习数据" name="learning" />
    </el-tabs>

    <!-- Dispatch Prompt -->
    <div v-if="activeTab === 'dispatch'" class="rules-content">
      <div class="rules-toolbar">
        <el-button size="small" :loading="saving" @click="handleSavePrompt">保存</el-button>
        <el-button size="small" text @click="loadPrompt">刷新</el-button>
      </div>
      <el-input
        v-model="localPromptContent"
        type="textarea"
        :autosize="{ minRows: 20, maxRows: 40 }"
        placeholder="加载中..."
      />
    </div>

    <!-- Preferences -->
    <div v-if="activeTab === 'preferences'" class="rules-content">
      <div class="rules-toolbar">
        <el-button size="small" @click="addPreference">添加</el-button>
        <el-button size="small" text @click="loadPreferences">刷新</el-button>
      </div>
      <div v-if="preferenceList.length === 0" class="empty-hint">
        暂无偏好设置，点击下方「添加」按钮新增。
      </div>
      <div v-for="(pref, i) in preferenceList" :key="i" class="preference-item">
        <el-input v-model="pref.key" placeholder="键（如 default_account）" size="small" style="width: 160px" />
        <el-input v-model="pref.value" placeholder="值" size="small" style="flex: 1" />
        <el-button size="small" type="danger" text @click="removePreference(i)">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
      <el-button v-if="preferenceList.length > 0" size="small" type="primary" @click="saveAllPreferences" :loading="saving">
        保存全部
      </el-button>
    </div>

    <!-- Learning Data -->
    <div v-if="activeTab === 'learning'" class="rules-content">
      <div class="rules-toolbar">
        <el-button size="small" type="danger" @click="$emit('clearLearning')">清空学习数据</el-button>
        <el-button size="small" text @click="$emit('refreshLearning')">刷新</el-button>
      </div>
      <div v-if="localLearningData.length === 0" class="empty-hint">
        暂无学习数据。当你修改 AI 识别的记账记录时，系统会自动学习。
      </div>
      <el-table v-else :data="localLearningData" size="small" border>
        <el-table-column prop="keyword" label="关键词" width="120" />
        <el-table-column prop="field" label="字段" width="100" />
        <el-table-column prop="value" label="修正值" />
        <el-table-column label="操作" width="60">
          <template #default="{ $index }">
            <el-button size="small" type="danger" text @click="removeLearningEntry($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Close, Delete } from '@element-plus/icons-vue';

const props = defineProps<{
  promptContent?: string;
  preferences?: Array<{ key: string; value: string }>;
  learningData?: Array<{ keyword: string; field: string; value: string }>;
  saving?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  save: [type: string, content: string];
  clearLearning: [];
  refreshPrompt: [];
  refreshPreferences: [];
  refreshLearning: [];
}>();

const activeTab = ref('dispatch');

// Local state with watchers to sync from props
const localPromptContent = ref(props.promptContent || '');
const localLearningData = ref<Array<{ keyword: string; field: string; value: string }>>([]);
const preferenceList = ref<Array<{ key: string; value: string; _original?: boolean }>>([]);

// Sync from props when they change
watch(() => props.promptContent, (val) => {
  if (val !== undefined && activeTab.value === 'dispatch') {
    localPromptContent.value = val;
  }
});

watch(() => props.learningData, (val) => {
  if (val !== undefined) {
    localLearningData.value = [...val];
  }
});

watch(() => props.preferences, (val) => {
  if (val !== undefined) {
    preferenceList.value = val.map(p => ({ key: p.key, value: p.value, _original: true }));
  }
});

// Also sync on tab switch
watch(activeTab, (tab) => {
  if (tab === 'dispatch' && props.promptContent) {
    localPromptContent.value = props.promptContent;
  }
  if (tab === 'preferences' && props.preferences) {
    preferenceList.value = props.preferences.map(p => ({ key: p.key, value: p.value, _original: true }));
  }
  if (tab === 'learning' && props.learningData) {
    localLearningData.value = [...props.learningData];
  }
});

function loadPrompt() {
  emit('refreshPrompt');
}

function loadPreferences() {
  emit('refreshPreferences');
}

function handleSavePrompt() {
  emit('save', 'dispatch', localPromptContent.value);
}

function addPreference() {
  preferenceList.value.push({ key: '', value: '', _original: false });
}

function removePreference(index: number) {
  preferenceList.value.splice(index, 1);
}

function removeLearningEntry(index: number) {
  localLearningData.value.splice(index, 1);
  // Also emit to parent so it can delete from DB
  const entry = props.learningData?.[index];
  if (entry) {
    emit('save', 'deleteLearning', JSON.stringify(entry));
  }
}

function saveAllPreferences() {
  const validPrefs = preferenceList.value.filter(p => p.key.trim() && p.value.trim());
  if (validPrefs.length === 0) return;

  // Build preferences.md content from the list
  const content = validPrefs.map(p => `- ${p.key}：${p.value}`).join('\n');
  emit('save', 'preference', content);
}
</script>

<style scoped>
.rules-panel {
  background: white;
  border-radius: 8px;
  padding: 12px;
  min-width: 350px;
  max-width: 600px;
}

.rules-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
  color: #333;
}

.rules-tabs {
  margin-bottom: 8px;
}

.rules-tabs :deep(.el-tabs__item) {
  font-size: 0.85em;
}

.rules-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rules-toolbar {
  display: flex;
  gap: 8px;
}

.preference-item {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
}

.empty-hint {
  text-align: center;
  color: #999;
  font-size: 0.9em;
  padding: 40px 20px;
}
</style>
