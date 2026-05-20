<template>
  <div class="settings-page">
    <h2>设置</h2>

    <!-- AI 设置 -->
    <el-card class="section">
      <template #header>AI 设置</template>
      <el-form :model="aiForm" label-width="120px" style="max-width: 600px">
        <el-form-item label="API Key">
          <el-input v-model="aiForm.ai_api_key" type="password" show-password placeholder="sk-..." />
        </el-form-item>
        <el-form-item label="API URL">
          <el-input v-model="aiForm.ai_api_url" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="aiForm.ai_model" placeholder="qwen-plus" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveAiConfig" :loading="saving">保存</el-button>
          <el-button @click="testAiConnection">测试连接</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- NocoBase 同步设置 -->
    <el-card class="section">
      <template #header>NocoBase 同步</template>
      <el-form :model="syncForm" label-width="120px" style="max-width: 600px">
        <el-form-item label="服务器地址">
          <el-input v-model="syncForm.nocobase_url" placeholder="https://your-nocobase.example.com" />
        </el-form-item>
        <el-form-item label="JWT Token">
          <el-input v-model="syncForm.nocobase_token" type="password" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveSyncConfig" :loading="saving">保存</el-button>
          <el-button @click="testNocobaseConnection">测试连接</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 预算设置 -->
    <el-card class="section">
      <template #header>预算设置</template>
      <el-form label-width="120px" style="max-width: 600px">
        <el-form-item label="月度预算">
          <el-input-number v-model="budgetMonthly" :min="0" :precision="2" :step="500" />
          <span class="budget-hint">（默认 3500 元/月）</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveBudget" :loading="saving">保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getAllConfig, setConfig } from '@/api/tauri';

const saving = ref(false);

const aiForm = ref({
  ai_api_key: '',
  ai_api_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  ai_model: 'qwen-plus',
});

const syncForm = ref({
  nocobase_url: '',
  nocobase_token: '',
});

const budgetMonthly = ref(3500);

onMounted(async () => {
  try {
    const config = await getAllConfig();
    aiForm.value.ai_api_key = config.ai_api_key || '';
    aiForm.value.ai_api_url = config.ai_api_url;
    aiForm.value.ai_model = config.ai_model;
    syncForm.value.nocobase_url = config.nocobase_url || '';
    syncForm.value.nocobase_token = config.nocobase_token || '';
    budgetMonthly.value = config.budget_monthly;
  } catch {
    // 配置为空时使用默认值
  }
});

async function saveAiConfig() {
  saving.value = true;
  try {
    await setConfig('ai_api_key', aiForm.value.ai_api_key);
    await setConfig('ai_api_url', aiForm.value.ai_api_url);
    await setConfig('ai_model', aiForm.value.ai_model);
    ElMessage.success('AI 设置已保存');
  } finally {
    saving.value = false;
  }
}

async function saveSyncConfig() {
  saving.value = true;
  try {
    await setConfig('nocobase_url', syncForm.value.nocobase_url);
    await setConfig('nocobase_token', syncForm.value.nocobase_token);
    ElMessage.success('同步设置已保存');
  } finally {
    saving.value = false;
  }
}

async function saveBudget() {
  saving.value = true;
  try {
    await setConfig('budget_monthly', budgetMonthly.value.toString());
    ElMessage.success('预算已保存');
  } finally {
    saving.value = false;
  }
}

function testAiConnection() {
  if (!aiForm.value.ai_api_key) {
    ElMessage.warning('请先填写 API Key');
    return;
  }
  // Phase 3: implement actual test
  ElMessage.info('AI 连接测试（Phase 3 实现）');
}

function testNocobaseConnection() {
  if (!syncForm.value.nocobase_url) {
    ElMessage.warning('请先填写服务器地址');
    return;
  }
  // Phase 4: implement actual test
  ElMessage.info('NocoBase 连接测试（Phase 4 实现）');
}
</script>

<style scoped>
.settings-page h2 {
  font-size: 1.5em;
  margin-bottom: 20px;
  color: #333;
}

.section {
  margin-bottom: 20px;
}

.budget-hint {
  margin-left: 12px;
  color: #999;
  font-size: 0.9em;
}
</style>
