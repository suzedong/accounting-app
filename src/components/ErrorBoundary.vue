<template>
  <div v-if="hasError" class="error-boundary">
    <div class="error-icon">
      <el-icon :size="48"><AlertCircle /></el-icon>
    </div>
    <h3>加载失败</h3>
    <p class="error-message">{{ errorMessage }}</p>
    <el-button type="primary" @click="retry">重新加载</el-button>
  </div>
  <slot v-else />
</template>

<script setup lang="ts">
import { ref, onErrorCaptured, type ComponentPublicInstance } from 'vue';
import { AlertCircle } from '@element-plus/icons-vue';

const props = withDefaults(defineProps<{
  fallbackMessage?: string;
}>(), {
  fallbackMessage: '页面加载出现问题，请重试',
}); 

const emit = defineEmits<{
  retry: [];
}>(); 

const hasError = ref(false);
const errorMessage = ref('');

onErrorCaptured((err: Error, _instance: ComponentPublicInstance | null, _info: string) => {
  hasError.value = true;
  errorMessage.value = err.message || props.fallbackMessage;
  console.error('[ErrorBoundary] Caught error:', err);
  return true;
});

function retry() {
  hasError.value = false;
  errorMessage.value = '';
  emit('retry');
}
</script>

<style scoped>
.error-boundary {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  text-align: center;
}

.error-icon {
  color: #f56c6c;
  margin-bottom: 16px;
}

.error-boundary h3 {
  margin: 0 0 8px 0;
  color: #606266;
}

.error-message {
  color: #909399;
  margin: 0 0 16px 0;
}
</style>
