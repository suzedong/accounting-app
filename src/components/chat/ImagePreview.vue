<template>
  <div class="image-preview">
    <img :src="src" :alt="alt" class="preview-image" @click="$emit('click')" />
    <div v-if="removable" class="remove-btn" @click="$emit('remove')">
      <el-icon><CircleClose /></el-icon>
    </div>
    <div v-if="loading" class="loading-overlay">
      <el-icon class="loading-icon"><Loading /></el-icon>
      <span>识别中...</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CircleClose, Loading } from '@element-plus/icons-vue';

defineProps<{
  src: string;
  alt?: string;
  removable?: boolean;
  loading?: boolean;
}>();

defineEmits<{
  click: [];
  remove: [];
}>();
</script>

<style scoped>
.image-preview {
  position: relative;
  display: inline-block;
  max-width: 200px;
  border-radius: 8px;
  overflow: hidden;
}

.preview-image {
  width: 100%;
  height: auto;
  display: block;
  cursor: pointer;
}

.remove-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 14px;
}

.remove-btn:hover {
  background: rgba(0, 0, 0, 0.8);
}

.loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 0.85em;
  gap: 4px;
}

.loading-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
