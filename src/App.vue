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

  // Check OCR status on startup
  try {
    const status = await checkOcrStatus();
    if (!status.available) {
      ElMessageBox.confirm(
        'OCR 识别功能需要模型文件才能使用。是否前往设置页下载？',
        'OCR 模型未找到',
        {
          confirmButtonText: '前往设置',
          cancelButtonText: '稍后再说',
          type: 'warning',
        }
      ).then(() => {
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
