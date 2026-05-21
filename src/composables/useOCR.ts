import { ref } from 'vue';
import { ocrRecognize, loadOcrModels } from '@/api/tauri';

/**
 * OCR composable
 * 封装 Tauri OCR 推理调用
 */
export function useOCR() {
  const loading = ref(false);
  const error = ref<string | null>(null);
  const lastResult = ref<string | null>(null);
  const ready = ref(false);

  /**
   * 加载 OCR 模型
   */
  async function loadModels(modelsDir: string): Promise<void> {
    try {
      await loadOcrModels(modelsDir);
      ready.value = true;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    }
  }

  /**
   * 识别图片中的文字
   */
  async function recognize(imageBase64: string): Promise<string> {
    loading.value = true;
    error.value = null;

    try {
      const text = await ocrRecognize(imageBase64);
      lastResult.value = text;
      return text;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 从 File 对象读取 Base64（包含 data URL 前缀）
   */
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Keep full data URL for display, strip prefix for API
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * 从 data URL 中提取纯 Base64（无前缀）
   */
  function extractBase64(dataUrl: string): string {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  }

  /**
   * 从图片 URL 读取 Base64
   */
  async function imageUrlToBase64(url: string): Promise<string> {
    const response = await fetch(url);
    const blob = await response.blob();
    return fileToBase64(new File([blob], 'image.png', { type: blob.type }));
  }

  return {
    loading, error, lastResult, ready,
    loadModels, recognize, fileToBase64, extractBase64, imageUrlToBase64,
  };
}
