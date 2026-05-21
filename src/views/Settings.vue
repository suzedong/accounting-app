<template>
  <div class="settings-page">
    <h2>设置</h2>

    <!-- AI 服务管理 -->
    <el-card class="section">
      <template #header>AI 服务</template>
      <div style="max-width: 700px">
        <!-- Service list -->
        <el-radio-group v-model="activeId" class="service-list">
          <div
            v-for="svc in services"
            :key="svc.id"
            class="service-item"
            :class="{ active: svc.active }"
          >
            <el-radio :value="svc.id" @change="activateAndSelect(svc)">
              <strong>{{ svc.name }}</strong>
              <span class="service-url">{{ svc.api_url }}</span>
            </el-radio>
            <el-button
              type="danger"
              size="small"
              text
              @click="removeService(svc.id)"
              :disabled="services.length <= 1"
            >删除</el-button>
          </div>
        </el-radio-group>
        <div style="margin: 8px 0">
          <el-button size="small" @click="addNewService">+ 添加新服务</el-button>
        </div>

        <el-divider />

        <!-- Service editor -->
        <el-form :model="editForm" label-width="100px">
          <el-form-item label="名称">
            <el-input v-model="editForm.name" placeholder="如：百炼 / LM Studio" />
          </el-form-item>
          <el-form-item label="API URL">
            <el-input v-model="editForm.api_url" placeholder="https://..." />
          </el-form-item>
          <el-form-item label="API Key">
            <el-input v-model="editForm.api_key" type="password" show-password placeholder="sk-..." />
          </el-form-item>
          <el-form-item label="模型">
            <el-input v-model="editForm.model" placeholder="qwen3.6-plus" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="saveService" :loading="saving">
              {{ editingExisting ? '更新' : '添加' }}服务
            </el-button>
            <el-button v-if="editingExisting" @click="cancelEdit">取消</el-button>
          </el-form-item>
        </el-form>

        <el-divider />

        <el-button type="primary" @click="testAiConnection" :loading="testing">测试连接</el-button>
        <span class="hint">（测试当前选中的服务）</span>
      </div>
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
import { ref, onMounted, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getAllConfig, setConfig, testAiConnection as testAi, getAiServices, saveAiServices, activateAiService } from '@/api/tauri';
import type { AiService } from '@/types';

const saving = ref(false);
const testing = ref(false);

// AI services
const services = ref<AiService[]>([]);
const activeId = ref('');
const editingId = ref('');

const editForm = ref({
  name: '',
  api_url: '',
  api_key: '',
  model: '',
});

const editingExisting = computed(() => services.value.some(s => s.id === editingId.value));

// Sync config
const syncForm = ref({
  nocobase_url: '',
  nocobase_token: '',
});

const budgetMonthly = ref(3500);

onMounted(async () => {
  try {
    // Load services
    const svcs = await getAiServices();
    if (svcs.length === 0) {
      // Migrate from legacy config
      const config = await getAllConfig();
      if (config.ai_api_key) {
        const legacy: AiService = {
          id: 'legacy',
          name: '旧版配置',
          api_url: config.ai_api_url || 'https://coding.dashscope.aliyuncs.com/v1',
          api_key: config.ai_api_key,
          model: config.ai_model || 'qwen3.6-plus',
          active: true,
        };
        services.value = [legacy];
        await saveAiServices([legacy]);
      }
    } else {
      services.value = svcs;
    }
    activeId.value = services.value.find(s => s.active)?.id || services.value[0]?.id || '';
    // Pre-fill form with active service
    const activeSvc = services.value.find(s => s.active);
    if (activeSvc) {
      editingId.value = activeSvc.id;
      editForm.value = { name: activeSvc.name, api_url: activeSvc.api_url, api_key: activeSvc.api_key, model: activeSvc.model };
    }

    // Load other config
    const config = await getAllConfig();
    syncForm.value.nocobase_url = config.nocobase_url || '';
    syncForm.value.nocobase_token = config.nocobase_token || '';
    budgetMonthly.value = config.budget_monthly;
  } catch {
    // 配置为空时使用默认值
  }
});

async function activateAndSelect(svc: AiService) {
  activeId.value = svc.id;
  editingId.value = svc.id;
  editForm.value = {
    name: svc.name,
    api_url: svc.api_url,
    api_key: svc.api_key,
    model: svc.model,
  };
  // Activate this service (deactivate others)
  for (const s of services.value) {
    s.active = s.id === svc.id;
  }
  try {
    await activateAiService(svc.id);
  } catch (e: unknown) {
    ElMessage.error('切换服务失败');
  }
}

function addNewService() {
  editingId.value = '';
  activeId.value = '';
  editForm.value = { name: '', api_url: '', api_key: '', model: '' };
}

function cancelEdit() {
  editingId.value = '';
  editForm.value = { name: '', api_url: '', api_key: '', model: '' };
}

async function saveService() {
  if (!editForm.value.name || !editForm.value.api_url) {
    ElMessage.warning('请填写名称和 API URL');
    return;
  }
  saving.value = true;
  try {
    const id = editingId.value || `svc_${Date.now()}`;
    const wasActive = !!(editingId.value && services.value.some(s => s.id === editingId.value && s.active));

    const newSvc: AiService = {
      id,
      name: editForm.value.name,
      api_url: editForm.value.api_url,
      api_key: editForm.value.api_key,
      model: editForm.value.model,
      active: wasActive,
    };

    // Replace or add
    const idx = services.value.findIndex(s => s.id === editingId.value);
    if (idx >= 0) {
      services.value[idx] = newSvc;
    } else {
      services.value.push(newSvc);
    }

    // Ensure at least one active (new service added, no active yet)
    if (!services.value.some(s => s.active)) {
      services.value[0].active = true;
      activeId.value = services.value[0].id;
    }

    await saveAiServices(services.value);
    ElMessage.success('服务已保存');
    if (!editingId.value || idx < 0) {
      editingId.value = id;
      editForm.value = { name: newSvc.name, api_url: newSvc.api_url, api_key: newSvc.api_key, model: newSvc.model };
    }
  } finally {
    saving.value = false;
  }
}

async function removeService(id: string) {
  if (services.value.length <= 1) {
    ElMessage.warning('至少保留一个服务');
    return;
  }
  await ElMessageBox.confirm('确定删除此服务？', '确认删除', { type: 'warning' });
  services.value = services.value.filter(s => s.id !== id);
  // If removed service was active, activate the first remaining
  if (!services.value.some(s => s.active) && services.value.length > 0) {
    services.value[0].active = true;
    activeId.value = services.value[0].id;
  }
  await saveAiServices(services.value);
  if (id === editingId.value) {
    cancelEdit();
  }
  ElMessage.success('已删除');
}

async function testAiConnection() {
  testing.value = true;
  try {
    const res = await testAi();
    if (res.success) {
      ElMessage.success('AI 连接成功');
    } else {
      ElMessage.error(res.message);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(msg);
  } finally {
    testing.value = false;
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

function testNocobaseConnection() {
  if (!syncForm.value.nocobase_url) {
    ElMessage.warning('请先填写服务器地址');
    return;
  }
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

.service-list {
  margin-bottom: 8px;
}

.service-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 4px;
  cursor: pointer;
}

.service-item:hover {
  background: #f5f7fa;
}

.service-item.active {
  background: #e8f4fd;
}

.service-url {
  display: block;
  font-size: 0.85em;
  color: #999;
  margin-top: 2px;
}

.hint {
  margin-left: 12px;
  color: #999;
  font-size: 0.9em;
}
</style>
