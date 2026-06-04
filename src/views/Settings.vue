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
          <el-button type="primary" @click="saveSyncConfig" :loading="saving">保存配置</el-button>
          <el-button @click="testNocobaseConnection" :loading="testingSync">测试连接</el-button>
        </el-form-item>
      </el-form>

      <el-divider />

      <!-- 同步操作区 -->
      <div style="max-width: 600px">
        <div style="display: flex; gap: 8px; margin-bottom: 12px">
          <el-button type="primary" @click="handleSyncFull" :loading="syncing" :disabled="!syncConfigured">
            双向同步
          </el-button>
          <el-button @click="handleSyncPush" :loading="syncing" :disabled="!syncConfigured">
            推送本地
          </el-button>
          <el-button @click="handleSyncPull" :loading="syncing" :disabled="!syncConfigured">
            拉取远程
          </el-button>
        </div>
        <el-alert
          v-if="!syncConfigured"
          title="请先保存 NocoBase 配置"
          type="warning"
          :closable="false"
          style="margin-bottom: 12px"
        />

        <!-- 同步结果 -->
        <div v-if="syncResult" class="sync-result">
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="推送记录">{{ syncResult.pushed }} 条</el-descriptions-item>
            <el-descriptions-item label="拉取记录">{{ syncResult.pulled }} 条</el-descriptions-item>
          </el-descriptions>
          <div v-if="syncResult.errors.length > 0" class="sync-errors">
            <el-alert
              v-for="(err, idx) in syncResult.errors"
              :key="idx"
              :title="err"
              type="error"
              :closable="false"
              style="margin-top: 8px"
            />
          </div>
        </div>

        <!-- 同步日志 -->
        <div v-if="showSyncTerminal" class="sync-terminal">
          <div class="sync-terminal-header">
            <span>同步日志</span>
            <el-button size="small" text @click="showSyncTerminal = false">关闭</el-button>
          </div>
          <div ref="syncTerminalBodyRef" class="sync-terminal-body">
            <div v-for="(line, idx) in syncTerminalLines" :key="idx" class="sync-line">{{ line }}</div>
          </div>
        </div>
      </div>
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

    <!-- Prompt 管理 -->
    <el-card class="section">
      <template #header>Prompt 管理</template>
      <div style="max-width: 700px">
        <p class="prompt-hint">修改 dispatch.md 文件后，点击"从文件刷新"将更新同步到数据库。刷新后需重新加载 AI 对话上下文才能生效。</p>
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <el-button size="small" @click="handleRefreshPrompt('dispatch')">刷新 dispatch.md</el-button>
          <el-button size="small" @click="handleRefreshPrompt('record')">刷新 record.md</el-button>
          <el-button size="small" @click="handleRefreshPrompt('preferences')">刷新 preferences.md</el-button>
        </div>
      </div>
    </el-card>

    <!-- OCR 识别 -->
    <el-card class="section">
      <template #header>
        <div class="card-header">
          <span>OCR 识别</span>
          <el-switch
            v-model="ocrEnabled"
            @change="onToggleOcrEnabled"
          />
        </div>
      </template>
      <div style="max-width: 800px">
        <!-- OCR 状态 -->
        <div class="ocr-status">
          <el-tag :type="ocrStatusTag" size="large">
            {{ ocrStatusText }}
          </el-tag>
          <span class="ocr-hint">{{ ocrStatusHint }}</span>
        </div>

        <!-- 未找到兼容 Python 时的引导提示（仅 macOS 显示，Windows 使用内置 Python 区域的提示） -->
        <div v-if="!isWindows && !ocrAvailable && !activePython && !discoverLoading && systemPythons.length > 0" class="python-guide-card">
          <div class="guide-title">如何安装兼容的 Python</div>
          <ol class="guide-steps">
            <li>访问 python.org 下载 Python 3.12（推荐 3.12.10）</li>
            <li>安装时务必勾选 <strong>"Add Python to PATH"</strong></li>
            <li>安装完成后点击 <el-button text size="small" type="primary" @click="handleRefreshStatus">刷新状态</el-button> 重新扫描</li>
          </ol>
          <div class="guide-links">
            <el-button text size="small" type="primary" @click="openPythonDownload">
              <el-icon><Download /></el-icon>
              打开 Python 3.12.10 下载页 (Windows 64-bit)
            </el-button>
          </div>
        </div>

        <!-- 当前使用的 Python -->
        <div v-if="activePython" class="active-python-section">
          <div class="section-title">当前使用的 Python</div>
          <div class="active-python-card">
            <div class="python-info">
              <span class="python-version">{{ activePython.version }}</span>
              <el-tag :type="activePython.hasPaddleocr ? 'success' : 'warning'" size="small">
                {{ activePython.hasPaddleocr ? 'PaddleOCR 已安装' : '未安装 PaddleOCR' }}
              </el-tag>
              <el-tag v-if="activePython.isBundled" type="primary" size="small">内置</el-tag>
            </div>
            <div class="python-path" :title="activePython.path">{{ formatPythonPath(activePython.path) }}</div>
            <!-- PaddleOCR 详细信息 -->
            <div v-if="activePython.hasPaddleocr" class="paddle-details">
              <div class="paddle-info-row">
                <span v-if="activePython.paddleocrVersion" class="paddle-version">
                  PaddleOCR {{ activePython.paddleocrVersion }}
                </span>
                <span v-if="activePython.paddlepaddleVersion" class="paddle-version">
                  PaddlePaddle {{ activePython.paddlepaddleVersion }} (CPU)
                </span>
              </div>
            </div>
          </div>
          <div class="python-actions">
            <el-button size="small" @click="handleReinstallDepsForPython(activePython.path)">
              重新安装依赖
            </el-button>
          </div>
        </div>

        <!-- 系统 Python 列表 -->
        <div class="system-python-section">
          <div class="section-title">
            Python 列表
            <span v-if="discoverLoading" class="discover-loading">
              <el-icon class="is-loading"><Loading /></el-icon>
              <span class="discover-loading-text">正在扫描系统 Python…</span>
            </span>
          </div>
          <el-table :data="systemPythons" size="small" border stripe class="python-table">
            <el-table-column label="版本" width="160">
              <template #default="{ row }">
                <span>{{ versionDisplay(row.version) }}</span>
                <el-tag v-if="activePython && activePython.path === row.path" type="primary" size="small" class="current-tag">当前</el-tag>
                <el-tag v-if="!row.isCompatible" type="danger" size="small" class="source-tag">不兼容</el-tag>
                <el-tag v-else-if="row.source === 'store'" type="warning" size="small" class="source-tag">Microsoft Store</el-tag>
                <el-tag v-else-if="row.source === 'macos'" type="warning" size="small" class="source-tag">只读</el-tag>
                <el-tag v-else-if="row.source === 'uv'" type="info" size="small" class="source-tag">uv</el-tag>
                <el-tag v-else-if="row.source === 'bundled'" type="primary" size="small" class="source-tag">内置</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="路径" min-width="200">
              <template #default="{ row }">
                <span class="python-table-path" :title="row.path">{{ formatPythonPath(row.path) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="PaddleOCR" width="100">
              <template #default="{ row }">
                <el-tag v-if="row.isCompatible && row.hasPaddleocr" type="success" size="small">已安装</el-tag>
                <el-tag v-else-if="row.isCompatible" type="info" size="small">未安装</el-tag>
                <el-tag v-else type="info" size="small">—</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="160" align="left">
              <template #default="{ row }">
                <div class="action-buttons">
                  <template v-if="row.isCompatible && row.source !== 'macos'">
                    <!-- Microsoft Store Python 不可用 -->
                    <template v-if="row.source === 'store'">
                      <el-tooltip content="Microsoft Store Python 无法安装依赖，请从 python.org 下载 Python 3.8-3.12" placement="top">
                        <el-button size="small" disabled>不可用</el-button>
                      </el-tooltip>
                    </template>
                    <template v-else>
                      <el-button
                        v-if="activePython && activePython.path !== row.path"
                        size="small"
                        type="primary"
                        @click="handleSelectPython(row.path)"
                      >使用</el-button>
                      <el-button v-else-if="activePython" size="small" disabled>当前</el-button>
                      <el-button 
                        size="small" 
                        @click="handleInstallDepsForPython(row.path)"
                      >安装</el-button>
                      <el-button
                        v-if="row.hasPaddleocr"
                        size="small"
                        @click="handleUninstallDepsForPython(row.path)"
                      >卸载</el-button>
                    </template>
                  </template>
                  <span v-else-if="row.isCompatible && row.source === 'macos'" class="no-action">只读</span>
                  <span v-else class="no-action">—</span>
                </div>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 内置 Python 3.12 (仅 macOS 支持) -->
        <div v-if="!isWindows" class="bundled-python-section">
          <div class="bundled-header">
            <span class="bundled-title">内置 Python 3.12</span>
            <el-tag
              :type="bundledPythonInstalled ? 'success' : 'info'"
              size="small"
            >
              {{ bundledPythonInstalled ? '已安装' : '未安装' }}
            </el-tag>
          </div>
          <p v-if="bundledPythonInstalled" class="bundled-path-text">
            <code class="bundled-path" title="/Users/.../accounting-app/python/bin/python3">
              应用数据目录/python/bin/python3
            </code>
          </p>
          <p class="bundled-desc">
            在应用数据目录中安装独立的 Python 3.12 环境，不受系统 Python 版本影响，兼容 PaddleOCR。
          </p>
          <div style="display: flex; gap: 8px; flex-wrap: wrap">
            <el-button
              v-if="!bundledPythonInstalled"
              type="primary"
              size="small"
              @click="handleInstallBundledPython"
            >安装内置 Python</el-button>
            <template v-else>
              <el-button size="small" @click="handleUninstallBundledPython">卸载内置 Python</el-button>
              <el-button type="warning" size="small" @click="handleReinstallBundledPython">重装内置 Python</el-button>
            </template>
          </div>
        </div>
        <div v-else class="bundled-python-section">
          <div class="bundled-header">
            <span class="bundled-title">内置 Python 3.12</span>
            <el-tag type="info" size="small">不支持</el-tag>
          </div>
          <p class="bundled-desc">
            Windows 平台不支持自动安装内置 Python。请从 <a href="https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe" target="_blank">python.org</a> 下载 Python 3.12.10 并手动安装。
          </p>
          <div class="bundled-note">
            <el-icon><InfoFilled /></el-icon>
            <span>注意：Microsoft Store 版本的 Python 无法安装 PaddleOCR，请勿使用。</span>
          </div>
        </div>

        <!-- 共享终端面板 -->
        <div v-if="showTerminal" class="terminal-panel" :class="{ expanding: isOperationRunning }">
          <div class="terminal-header">
            <span class="terminal-title">安装日志</span>
            <el-button
              v-if="!isOperationRunning"
              type="primary"
              size="small"
              @click="handleRefreshStatus"
            >刷新状态</el-button>
            <el-button text size="small" @click="terminalLines = []">清空</el-button>
          </div>
          <div ref="terminalBodyRef" class="terminal-body">
            <div v-for="(line, i) in terminalLines" :key="i" class="terminal-line">{{ line }}</div>
            <div v-if="isOperationRunning" class="terminal-cursor">▋</div>
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Loading, Download, InfoFilled } from '@element-plus/icons-vue';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getAllConfig, setConfig, testAiConnection as testAi, getAiServices, saveAiServices, activateAiService, checkOcrStatusFast, startOcrDiscover, selectPython, setOcrEnabled, uninstallPaddleocrForPython, installPaddleocrForPython, reinstallPaddleocrForPython, installBundledPython, uninstallBundledPython, reinstallBundledPython, refreshPromptFromFile, syncFull, syncPush, syncPull, importFromNocobase } from '@/api/tauri';
import { agentEngine } from '@/ai/agent-engine';
import type { AiService } from '@/types';

// Types for OCR
import { syncFull, syncPush, syncPull } from '@/api/tauri';
interface SystemPython {
  path: string;
  version: string;
  minorVersion: number;
  isCompatible: boolean;
  hasPaddleocr: boolean;
  source: string; // macos | uv | homebrew | pythonorg | pyenv | store | unknown
  isUsable: boolean;
}

interface ActivePython {
  path: string;
  version: string;
  isBundled: boolean;
  hasPaddleocr: boolean;
  paddleocrVersion?: string;
  paddlepaddleVersion?: string;
}

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
const syncConfigured = computed(() => syncForm.value.nocobase_url && syncForm.value.nocobase_token);

// Sync state
const syncing = ref(false);
const testingSync = ref(false);
const syncResult = ref<{ pushed: number; pulled: number; errors: string[] } | null>(null);
const showSyncTerminal = ref(false);
const syncTerminalLines = ref<string[]>([]);
const syncTerminalBodyRef = ref<HTMLElement | null>(null);

const budgetMonthly = ref(3500);

// Platform detection
const isWindows = navigator.platform.includes('Win');

// OCR state
const ocrEnabled = ref(true);
const ocrAvailable = ref(false);
const ocrMessage = ref('');
const activePython = ref<ActivePython | null>(null);
const systemPythons = ref<SystemPython[]>([]);
const bundledPythonInstalled = ref(false);
const discoverLoading = ref(false); // True while background discover is running

// Shared terminal state for all operations
const showTerminal = ref(false);
const terminalLines = ref<string[]>([]);
const terminalBodyRef = ref<HTMLElement | null>(null);
const currentOperation = ref('');
const operationSessionId = ref('');

// Legacy compat
const isOperationRunning = computed(() => currentOperation.value !== '');

// Auto-scroll terminal on new lines
watch(() => terminalLines.value.length, () => {
  nextTick(() => {
    if (terminalBodyRef.value) {
      terminalBodyRef.value.scrollTop = terminalBodyRef.value.scrollHeight;
    }
  });
}, { flush: 'post' });

// Event listeners
let unlistenInstallLog: (() => void) | null = null;
let unlistenDiscoverResult: (() => void) | null = null;

async function setupEventListeners() {
  unlistenInstallLog = await listen('ocr_install_log', (event: any) => {
    const data = event.payload;
    // Route to shared terminal if session matches current operation
    if (data.sessionId === operationSessionId.value) {
      terminalLines.value.push(data.text);
    }
  });

  // Listen for background discover result
  unlistenDiscoverResult = await listen('ocr_discover_result', async (event: any) => {
    console.log('[Settings] Received ocr_discover_result event');
    try {
      const data = event.payload;
      systemPythons.value = data.systemPythons || [];
      console.log('[Settings] systemPythons updated:', systemPythons.value.length);
      
      // Update OCR status message based on discovered pythons
      const compatiblePythons = systemPythons.value.filter(p => p.isCompatible && p.source !== 'store');
      if (compatiblePythons.length > 0 && !activePython.value) {
        // Found compatible pythons but none selected yet
        ocrMessage.value = `找到 ${compatiblePythons.length} 个兼容的 Python，请选择一个使用`;
      } else if (compatiblePythons.length === 0) {
        ocrMessage.value = '未找到兼容的 Python (需要 3.8-3.12，非 Microsoft Store 版本)';
      } else {
        ocrMessage.value = '';
      }
      
      // Directly update without async
      discoverLoading.value = false;
      console.log('[Settings] discoverLoading set to:', discoverLoading.value);
    } catch (e) {
      console.error('[Settings] Error:', e);
      discoverLoading.value = false;
    }
  });
}

const ocrStatusTag = computed(() => {
  if (!ocrEnabled.value) return 'info';
  if (ocrAvailable.value) return 'success';
  if (activePython.value && !activePython.value.hasPaddleocr) return 'warning';
  return 'danger';
});

const ocrStatusText = computed(() => {
  if (!ocrEnabled.value) return '已禁用';
  if (discoverLoading.value) return '正在扫描...';
  if (ocrAvailable.value) return 'PaddleOCR 已就绪';
  if (activePython.value) return 'Python 已找到，需要安装依赖';
  return '未找到兼容的 Python';
});

const ocrStatusHint = computed(() => {
  if (discoverLoading.value) return '正在扫描系统 Python...';
  if (ocrMessage.value) return ocrMessage.value;
  if (activePython.value) return `${activePython.value.version} — ${activePython.value.path}`;
  return '需要 Python 3.8-3.12';
});

onMounted(async () => {
  // Render skeleton first, then load data asynchronously
  await nextTick();

  // Parallel: AI services + other config + OCR fast status (independent, no dependencies)
  const [svcsResult, configResult, ocrResult] = await Promise.allSettled([
    getAiServices(),
    getAllConfig(),
    checkOcrStatusFast(),
  ]);

  // Process AI services
  if (svcsResult.status === 'fulfilled') {
    services.value = svcsResult.value.length > 0 ? svcsResult.value : [];
    activeId.value = services.value.find(s => s.active)?.id || services.value[0]?.id || '';
    const activeSvc = services.value.find(s => s.active);
    if (activeSvc) {
      editingId.value = activeSvc.id;
      editForm.value = { name: activeSvc.name, api_url: activeSvc.api_url, api_key: activeSvc.api_key, model: activeSvc.model };
    }
  }

  // Process config
  if (configResult.status === 'fulfilled') {
    syncForm.value.nocobase_url = configResult.value.nocobase_url || '';
    syncForm.value.nocobase_token = configResult.value.nocobase_token || '';
    budgetMonthly.value = configResult.value.budget_monthly;
  }

  // Process OCR
  if (ocrResult.status === 'fulfilled') {
    const status = ocrResult.value;
    ocrAvailable.value = status.available;
    ocrEnabled.value = status.enabled;
    activePython.value = status.activePython || null;
    ocrMessage.value = status.message || '';
    bundledPythonInstalled.value = status.bundledPythonInstalled;
  }

  // Setup event listeners FIRST (before starting discover)
  await setupEventListeners();

  // Then start background discover (scans system Python, returns via event)
  try {
    discoverLoading.value = true;
    await startOcrDiscover();
  } catch (e) {
    console.error('[Settings] startOcrDiscover failed:', e);
    discoverLoading.value = false;
  }
});

onUnmounted(() => {
  unlistenInstallLog?.();
  unlistenDiscoverResult?.();
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

async function testNocobaseConnection() {
    if (!syncForm.value.nocobase_url) {
      ElMessage.warning('请先填写服务器地址');
      return;
    }
    testingSync.value = true;
    try {
      await invoke('nocobase_test_connection', {
        params: {
          url: syncForm.value.nocobase_url,
          token: syncForm.value.nocobase_token,
        },
      });
      ElMessage.success('NocoBase 连接成功');
    } catch (e: unknown) {
      ElMessage.error(`连接失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      testingSync.value = false;
    }
  }

async function handleSyncFull() {
  syncResult.value = null;
  syncing.value = true;
  try {
    const result = await syncFull();
    syncResult.value = result;
    if (result.errors.length > 0) {
      ElMessage.warning(`同步完成，但有 ${result.errors.length} 个错误`);
    } else {
      ElMessage.success(`同步完成：推送 ${result.pushed} 条，拉取 ${result.pulled} 条`);
    }
  } catch (e: unknown) {
    ElMessage.error(`同步失败: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    syncing.value = false;
  }
}

async function handleSyncPush() {
  syncResult.value = null;
  syncing.value = true;
  try {
    const result = await syncPush();
    syncResult.value = result;
    if (result.errors.length > 0) {
      ElMessage.warning(`推送完成，但有 ${result.errors.length} 个错误`);
    } else {
      ElMessage.success(`推送完成：${result.pushed} 条`);
    }
  } catch (e: unknown) {
    ElMessage.error(`推送失败: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    syncing.value = false;
  }
}

async function handleSyncPull() {
  syncResult.value = null;
  syncing.value = true;
  try {
    const result = await syncPull();
    syncResult.value = result;
    if (result.errors.length > 0) {
      ElMessage.warning(`拉取完成，但有 ${result.errors.length} 个错误`);
    } else {
      ElMessage.success(`拉取完成：${result.pulled} 条`);
    }
  } catch (e: unknown) {
    ElMessage.error(`拉取失败: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    syncing.value = false;
  }
}

// Prompt handlers
async function handleRefreshPrompt(name: string) {
  try {
    const result = await refreshPromptFromFile(name);
    ElMessage.success(result);
    // Reset agentEngine context so it reloads the updated prompt on next message
    agentEngine.resetContext();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(`刷新失败: ${msg}`);
  }
}

// OCR handlers
async function onToggleOcrEnabled(val: unknown) {
  const enabled = val === true;
  try {
    await setOcrEnabled(enabled);
    ocrEnabled.value = enabled;
    ElMessage.success(enabled ? 'OCR 已启用' : 'OCR 已禁用');
    await refreshOcrStatus();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(`切换失败: ${msg}`);
    ocrEnabled.value = !enabled;
  }
}

async function refreshOcrStatus() {
  try {
    // Fast path: active Python info
    const status = await checkOcrStatusFast();
    ocrAvailable.value = status.available;
    activePython.value = status.activePython || null;
    systemPythons.value = []; // Will be refilled by discover event
    ocrMessage.value = status.message || '';
    bundledPythonInstalled.value = status.bundledPythonInstalled;
    // Start background discover to refresh system Python list
    discoverLoading.value = true;
    await startOcrDiscover();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(`刷新 OCR 状态失败: ${msg}`);
  }
}

/** Start a terminal operation with a new session */
function startOperation(operation: string, initialLine: string) {
  currentOperation.value = operation;
  operationSessionId.value = `${operation}_${Date.now()}`;
  showTerminal.value = true;
  terminalLines.value = [initialLine];
}

async function handleSelectPython(path: string) {
  try {
    await selectPython(path);
    ElMessage.success('已切换 Python 版本');
    await refreshOcrStatus();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    ElMessage.error(`切换失败: ${msg}`);
  }
}

async function handleInstallDepsForPython(pythonPath: string) {
  startOperation('install_python', '>>> 开始安装 PaddleOCR 依赖...');
  try {
    const result = await installPaddleocrForPython(pythonPath, operationSessionId.value);
    terminalLines.value.push(`✓ ${result}`);
    ElMessage.success(result);
    await refreshOcrStatus();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    terminalLines.value.push(`✗ ${msg}`);
    ElMessage.error(`安装失败: ${msg}`);
  } finally {
    currentOperation.value = '';
  }
}

async function handleUninstallDepsForPython(pythonPath: string) {
  startOperation('uninstall', '>>> 正在卸载 PaddleOCR...');
  try {
    const result = await uninstallPaddleocrForPython(pythonPath, operationSessionId.value);
    terminalLines.value.push(`✓ ${result}`);
    ElMessage.success(result);
    await refreshOcrStatus();
  } catch (e: unknown) {
    if (e !== 'cancel') {
      const msg = e instanceof Error ? e.message : String(e);
      terminalLines.value.push(`✗ ${msg}`);
      ElMessage.error(`卸载失败: ${msg}`);
    }
  } finally {
    currentOperation.value = '';
  }
}

async function handleReinstallDepsForPython(pythonPath: string) {
  startOperation('reinstall_python', '>>> 正在重新安装 PaddleOCR ...');
  try {
    const result = await reinstallPaddleocrForPython(pythonPath, operationSessionId.value);
    terminalLines.value.push(`✓ ${result}`);
    ElMessage.success(result);
    await refreshOcrStatus();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    terminalLines.value.push(`✗ ${msg}`);
    ElMessage.error(`重装失败: ${msg}`);
  } finally {
    currentOperation.value = '';
  }
}

async function handleInstallBundledPython() {
  startOperation('install_bundled', '>>> 开始安装内置 Python 3.12 ...');
  try {
    const result = await installBundledPython(operationSessionId.value);
    terminalLines.value.push(`✓ ${result}`);
    ElMessage.success(result);
    bundledPythonInstalled.value = true;
    await refreshOcrStatus();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    terminalLines.value.push(`✗ ${msg}`);
    ElMessage.error(`安装失败: ${msg}`);
  } finally {
    currentOperation.value = '';
  }
}

async function handleUninstallBundledPython() {
  try {
    await ElMessageBox.confirm('确定卸载内置 Python？已安装的 PaddleOCR 也会被删除。', '确认卸载', { type: 'warning' });
    const result = await uninstallBundledPython();
    terminalLines.value.push(`✓ ${result}`);
    ElMessage.success(result);
    bundledPythonInstalled.value = false;
    await refreshOcrStatus();
  } catch (e: unknown) {
    if (e !== 'cancel') {
      const msg = e instanceof Error ? e.message : String(e);
      ElMessage.error(`卸载失败: ${msg}`);
    }
  }
}

async function handleReinstallBundledPython() {
  startOperation('reinstall_bundled', '>>> 正在重新安装内置 Python ...');
  try {
    const result = await reinstallBundledPython(operationSessionId.value);
    terminalLines.value.push(`✓ ${result}`);
    ElMessage.success(result);
    bundledPythonInstalled.value = true;
    await refreshOcrStatus();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    terminalLines.value.push(`✗ ${msg}`);
    ElMessage.error(`重装失败: ${msg}`);
  } finally {
    currentOperation.value = '';
  }
}

async function handleRefreshStatus() {
  await refreshOcrStatus();
  if (ocrAvailable.value) {
    ElMessage.success('OCR 已就绪');
  } else if (activePython.value) {
    ElMessage.info(ocrMessage.value);
  } else {
    ElMessage.warning(ocrMessage.value);
  }
}

function formatPythonPath(path: string): string {
  return path;
}

function versionDisplay(version: string): string {
  // Extract just "3.12.x" from "Python 3.12.x"
  const parts = version.split(' ');
  return parts.length > 1 ? parts[1] : version;
}

// 打开 Python 3.12.10 下载页
function openPythonDownload() {
  // Windows 64-bit 官方安装包
  window.open('https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe', '_blank');
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

.prompt-hint {
  color: #666;
  font-size: 0.9em;
  margin-bottom: 8px;
}

.sync-result {
  margin-top: 12px;
}

.sync-errors {
  margin-top: 8px;
}

.sync-terminal {
  margin-top: 12px;
  border: 1px solid #eee;
  border-radius: 4px;
  overflow: hidden;
}

.sync-terminal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f5f5f5;
  font-weight: bold;
  font-size: 0.9em;
}

.sync-terminal-body {
  padding: 8px;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: monospace;
  font-size: 0.85em;
  max-height: 300px;
  overflow-y: auto;
}

.sync-line {
  white-space: pre-wrap;
  line-height: 1.5;
}

.ocr-status {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ocr-hint {
  color: #666;
  font-size: 0.9em;
}

/* Python 安装引导卡片 */
.python-guide-card {
  margin-top: 16px;
  padding: 16px;
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 8px;
}

.guide-title {
  font-weight: 600;
  color: #333;
  margin-bottom: 12px;
  font-size: 0.95em;
}

.guide-steps {
  margin: 0 0 16px 0;
  padding-left: 20px;
  color: #555;
  font-size: 0.9em;
  line-height: 1.8;
}

.guide-steps strong {
  color: #e6a23c;
}

.guide-links {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ocr-info {
  margin-top: 16px;
}

/* Active Python section */
.active-python-section {
  margin-top: 20px;
  padding: 16px;
  background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
  border-radius: 8px;
  border: 1px solid #bae6fd;
}

.active-python-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.python-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.python-version {
  font-weight: 600;
  font-size: 1.05em;
  color: #1e40af;
}

.python-path {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.85em;
  color: #6b7280;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* PaddleOCR details */
.paddle-details {
  margin-top: 8px;
  padding: 8px 12px;
  background: #f9fafb;
  border-radius: 6px;
}

.paddle-info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.paddle-version {
  font-size: 0.85em;
  color: #6b7280;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.gpu-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.gpu-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8em;
  color: #4b5563;
}

.gpu-icon {
  font-size: 0.9em;
  width: 16px;
  text-align: center;
}

.gpu-name {
  font-weight: 500;
}

.gpu-vram {
  color: #9ca3af;
}

.gpu-tag {
  margin-left: auto;
  font-size: 0.75em;
  padding: 0 6px;
}

.python-actions {
  margin-top: 10px;
}

/* System Python table */
.system-python-section {
  margin-top: 20px;
}

.python-table {
  margin-top: 8px;
}

.python-table-path {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.8em;
  color: #6b7280;
  word-break: break-all;
  white-space: normal;
}

.current-tag {
  margin-left: 4px;
}

.compat-tag, .source-tag {
  margin-left: 4px;
}

.no-action {
  color: #ccc;
  font-size: 0.9em;
}

.action-buttons {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 2px;
  width: 100%;
}

.action-buttons :deep(.el-button) {
  padding: 4px 8px;
  margin: 0;
}

/* Override Element Plus cell padding for action column */
:deep(.python-table .el-table__cell:last-child) {
  padding: 8px 0;
}

/* Section title */
.section-title {
  font-weight: 600;
  color: #333;
  font-size: 0.95em;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Bundled Python note (Windows) */
.bundled-note {
  margin-top: 8px;
  padding: 8px 12px;
  background: #fff3e0;
  border: 1px solid #ffe0b2;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.85em;
  color: #e65100;
}

.bundled-note .el-icon {
  font-size: 16px;
}

.discover-loading {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 400;
  font-size: 0.85em;
  color: #999;
}

.discover-loading .el-icon {
  font-size: 14px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.download-progress {
  margin-top: 12px;
}

.progress-text {
  display: block;
  text-align: center;
  color: #999;
  font-size: 0.85em;
  margin-top: 4px;
}

.terminal-panel {
  margin-top: 16px;
  border: 1px solid #333;
  border-radius: 8px;
  overflow: hidden;
  background: #1e1e1e;
  transition: height 0.3s ease;
}

.terminal-panel.expanding {
  border-color: #409eff;
}

.terminal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #2d2d2d;
  border-bottom: 1px solid #333;
}

.terminal-title {
  flex: 1;
  color: #ccc;
  font-size: 0.85em;
  font-weight: 600;
}

.terminal-body {
  max-height: 400px;
  min-height: 120px;
  padding: 12px;
  overflow-y: auto;
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #d4d4d4;
}

.terminal-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.terminal-cursor {
  color: #409eff;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.bundled-python-section {
  margin-top: 20px;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
}

.bundled-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bundled-title {
  font-weight: 600;
  color: #333;
}

.bundled-desc {
  margin: 8px 0 12px;
  color: #666;
  font-size: 0.9em;
}

.bundled-path-text {
  margin: 4px 0 0;
}

.bundled-path {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.85em;
  color: #3b82f6;
  background: #eff6ff;
  padding: 2px 8px;
  border-radius: 4px;
}
</style>
