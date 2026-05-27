<template>
  <div class="app-container">
    <AppNavbar />
    <main class="main-content">
      <router-view />
    </main>
    <ChatWidget />
    <DevConsole ref="devConsoleRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import AppNavbar from '@/components/layout/AppNavbar.vue';
import ChatWidget from '@/components/chat/ChatWidget.vue';
import DevConsole from '@/components/chat/DevConsole.vue';
import { checkOcrStatus } from '@/api/tauri';

const router = useRouter();
const devConsoleRef = ref<InstanceType<typeof DevConsole> | null>(null);

function handleKeyDown(e: KeyboardEvent) {
  // Ctrl+` (backtick)
  if (e.ctrlKey && e.key === '`') {
    e.preventDefault();
    devConsoleRef.value?.toggle();
  }
}

onMounted(async () => {
  document.addEventListener('keydown', handleKeyDown);

  // Check OCR status on startup — prompt only if enabled but not ready
  try {
    const status = await checkOcrStatus();
    if (!status.available && status.enabled) {
      const msg = status.activePython
        ? 'OCR 识别已启用，但尚未安装 PaddleOCR 依赖。是否前往设置页安装？'
        : 'OCR 识别已启用，但未找到 Python 3.8+。是否前往设置页查看？';
      ElMessageBox.confirm(msg, 'OCR 未就绪', {
        confirmButtonText: '前往设置',
        cancelButtonText: '稍后再说',
        type: 'warning',
      }).then(() => {
        router.push('/settings');
      }).catch(() => {
        // User dismissed
      });
    }
  } catch {
    // Ignore check errors
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown);
});
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f5f7fa;
  color: #333;
}

.app-container {
  min-height: 100vh;
}

.main-content {
  max-width: 1200px;
  margin: 0 auto;
  padding: 60px 20px 20px;
}
</style>
