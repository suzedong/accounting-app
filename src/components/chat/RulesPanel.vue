<template>
  <div class="rules-panel">
    <div class="rules-header">
      <span>Prompt 编辑器</span>
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
        <el-button size="small" :loading="saving" @click="$emit('save', 'dispatch', promptContent)">
          保存
        </el-button>
      </div>
      <el-input
        v-model="promptContent"
        type="textarea"
        :autosize="{ minRows: 20, maxRows: 40 }"
        placeholder="加载中..."
      />
    </div>

    <!-- Preferences -->
    <div v-if="activeTab === 'preferences'" class="rules-content">
      <div class="rules-toolbar">
        <el-button size="small" @click="addPreference">
          添加偏好
        </el-button>
      </div>
      <div v-for="(pref, i) in preferenceList" :key="i" class="preference-item">
        <el-input v-model="pref.key" placeholder="键" size="small" style="width: 140px" />
        <el-input v-model="pref.value" placeholder="值" size="small" style="flex: 1" />
        <el-button size="small" type="danger" text @click="removePreference(i)">
          <el-icon><Delete /></el-icon>
        </el-button>
      </div>
      <el-button size="small" type="primary" @click="saveAllPreferences" :loading="saving">
        保存全部
      </el-button>
    </div>

    <!-- Learning Data -->
    <div v-if="activeTab === 'learning'" class="rules-content">
      <div class="rules-toolbar">
        <el-button size="small" type="danger" @click="$emit('clearLearning')">
          清空学习数据
        </el-button>
      </div>
      <el-table :data="learningData" size="small" border>
        <el-table-column prop="keyword" label="关键词" width="120" />
        <el-table-column prop="field" label="字段" width="100" />
        <el-table-column prop="value" label="修正值" />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Close, Delete } from '@element-plus/icons-vue';

const emit = defineEmits<{
  close: [];
  save: [type: string, content: string];
  clearLearning: [];
}>();

const props = defineProps<{
  promptContent?: string;
  learningData?: Array<{ keyword: string; field: string; value: string }>;
  saving?: boolean;
}>();

const activeTab = ref('dispatch');
const promptContent = ref(props.promptContent || '');
const preferenceList = ref<Array<{ key: string; value: string }>>([]);

function addPreference() {
  preferenceList.value.push({ key: '', value: '' });
}

function removePreference(index: number) {
  preferenceList.value.splice(index, 1);
}

function saveAllPreferences() {
  for (const pref of preferenceList.value) {
    if (pref.key && pref.value) {
      emit('save', 'preference', JSON.stringify(pref));
    }
  }
}
</script>

<style scoped>
.rules-panel {
  background: white;
  border-radius: 8px;
  padding: 12px;
  min-width: 400px;
  max-width: 600px;
}

.rules-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-weight: 600;
}

.rules-tabs {
  margin-bottom: 8px;
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
</style>
