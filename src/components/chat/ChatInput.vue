<template>
  <div class="chat-input">
    <!-- Image preview -->
    <ImagePreview
      v-if="imageSrc"
      :src="imageSrc"
      :loading="ocrLoading"
      removable
      @remove="removeImage"
    />

    <div class="input-row">
      <!-- Image upload button -->
      <el-button
        class="upload-btn"
        :icon="Picture"
        circle
        @click="triggerFileInput"
      />
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="hidden-input"
        @change="handleFileChange"
      />

      <!-- Text input -->
      <el-input
        v-model="text"
        placeholder="输入消费或收入，或粘贴截图..."
        @keyup.enter.exact="handleSend"
        resize="none"
        :autosize="{ minRows: 1, maxRows: 4 }"
      />

      <!-- Send button -->
      <el-button @click="handleSend" :loading="sending" type="primary">
        <el-icon><Promotion /></el-icon>
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Picture, Promotion } from '@element-plus/icons-vue';
import ImagePreview from './ImagePreview.vue';

const emit = defineEmits<{
  send: [text: string, imageBase64?: string, imageFullSrc?: string];
}>();

const text = ref('');
const imageSrc = ref<string | null>(null);
const imageBase64 = ref<string | null>(null);
const sending = defineModel<boolean>('sending', { default: false });
const ocrLoading = defineModel<boolean>('ocrLoading', { default: false });
const fileInput = ref<HTMLInputElement | null>(null);

function triggerFileInput() {
  fileInput.value?.click();
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result as string;
    imageSrc.value = result;
    imageBase64.value = result.includes(',') ? result.split(',')[1] : result;
  };
  reader.readAsDataURL(file);

  // Reset input so same file can be selected again
  input.value = '';
}

function removeImage() {
  imageSrc.value = null;
  imageBase64.value = null;
}

function handleSend() {
  if (!text.value.trim() && !imageBase64.value) return;
  emit('send', text.value.trim(), imageBase64.value ?? undefined, imageSrc.value ?? undefined);
  text.value = '';
  removeImage();
}
</script>

<style scoped>
.chat-input {
  padding: 12px 16px;
  border-top: 1px solid #ebeef5;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.upload-btn {
  flex-shrink: 0;
  color: #999;
}

.upload-btn:hover {
  color: #667eea;
}

.hidden-input {
  display: none;
}
</style>
