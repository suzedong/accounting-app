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
      <el-button 
        @click="handleSend" 
        :loading="sending || ocrLoading || isProcessing" 
        :disabled="sending || ocrLoading || isProcessing"
        type="primary"
      >
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
const isProcessing = ref(false);
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
  // 验证文件大小（最大 10MB）
  const maxSize = 10 * 1024 * 1024;
  if (file.size > maxSize) {
    ElMessage.error(`图片过大，最大支持 10MB，当前文件 ${(file.size / 1024 / 1024).toFixed(1)}MB`);
    return;
  }

  // 验证文件类型
  const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/bmp', 'image/gif', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    ElMessage.error(`不支持的图片格式: ${file.type}`);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const result = reader.result as string;
    imageSrc.value = result;
    imageBase64.value = result.includes(',') ? result.split(',')[1] : result;
  };
  reader.onerror = () => {
    ElMessage.error('图片读取失败');
  };
  reader.readAsDataURL(file);
}

function removeImage() {
  imageSrc.value = null;
  imageBase64.value = null;
}

async function handleSend() {
  if (!text.value.trim() && !imageBase64.value) return;

  isProcessing.value = true;
  const hasImage = !!imageBase64.value;
  const mergedText = text.value.trim();

  if (hasImage) {
    // OCR 预处理：检查可用性
    const status = await checkOcrStatusFast();
    if (!status.available) {
      ElMessage.error('OCR 识别未就绪，请前往设置页安装 PaddleOCR');
      isProcessing.value = false;
      return;
    }

    // 调用 OCR
    ocrLoading.value = true;
    try {
      const ocrText = await ocrRecognize(imageBase64.value!);
      
      // 检查 OCR 结果：未识别到文字且用户没有输入文字，则不发送
      const isEmptyResult = ocrText === '未识别到文字' || ocrText.trim() === '';
      if (isEmptyResult && !mergedText) {
        ElMessage.warning('图片中未识别到文字，请上传包含文字的图片');
        ocrLoading.value = false;
        isProcessing.value = false;
        return;
      }
      
      // 合并文本：用户文字 + OCR 识别文字
      const finalText = mergedText
        ? `${mergedText} ${ocrText}`
        : ocrText;
      emit('send', finalText, imageBase64.value!, imageSrc.value!);
    } catch (e) {
      ElMessage.error('OCR 识别失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      ocrLoading.value = false;
      isProcessing.value = false;
    }
  } else {
    // 无图片，直接发送
    emit('send', mergedText);
    isProcessing.value = false;
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
