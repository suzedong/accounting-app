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
        @paste="handlePaste"
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
import { ElMessage } from 'element-plus';
import { Picture, Promotion } from '@element-plus/icons-vue';
import ImagePreview from './ImagePreview.vue';
import { checkOcrStatusFast, ocrRecognize } from '@/api/tauri';

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
  loadImageFile(file);
  input.value = '';
}

function handlePaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items) return;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      event.preventDefault();
      const file = item.getAsFile();
      if (file) loadImageFile(file);
      return;
    }
  }
}

function loadImageFile(file: File) {
  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result as string;
    imageSrc.value = result;
    imageBase64.value = result.includes(',') ? result.split(',')[1] : result;
  };
  reader.readAsDataURL(file);
}

function removeImage() {
  imageSrc.value = null;
  imageBase64.value = null;
}

async function handleSend() {
  if (!text.value.trim() && !imageBase64.value) return;

  const hasImage = !!imageBase64.value;
  const mergedText = text.value.trim();

  if (hasImage) {
    // OCR 预处理：检查可用性
    const status = await checkOcrStatusFast();
    if (!status.available) {
      ElMessage.error('OCR 识别未就绪，请前往设置页安装 PaddleOCR');
      return;
    }

    // 调用 OCR
    ocrLoading.value = true;
    try {
      const ocrText = await ocrRecognize(imageBase64.value!);
      // 合并文本：用户文字 + OCR 识别文字
      const finalText = mergedText
        ? `${mergedText} ${ocrText}`
        : ocrText;
      emit('send', finalText, imageBase64.value!, imageSrc.value!);
    } catch (e) {
      ElMessage.error('OCR 识别失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      ocrLoading.value = false;
    }
  } else {
    // 无图片，直接发送
    emit('send', mergedText);
  }

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
