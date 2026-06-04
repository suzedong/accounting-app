import { ref } from 'vue';
import { ocrRecognize, checkOcrStatus } from '@/api/tauri';

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
   * 检查 OCR 是否可用
   */
  async function checkReady(): Promise<boolean> {
    try {
      const status = await checkOcrStatus();
      ready.value = status.available;
      return status.available;
    } catch {
      ready.value = false;
      return false;
    }
  }

  /**
   * 识别图片中的文字（自动过滤 OCR 调试信息）
   */
  async function recognize(imageBase64: string): Promise<string> {
    loading.value = true;
    error.value = null;

    try {
      // 验证 Base64 数据
      if (!imageBase64 || typeof imageBase64 !== 'string') {
        throw new Error('无效的图片数据');
      }

      // 检查数据大小（最大 50MB Base64）
      if (imageBase64.length > 50 * 1024 * 1024) {
        throw new Error('图片数据过大');
      }

      const rawText = await ocrRecognize(imageBase64);
      const cleanText = rawText.split('\n')
        .filter(line => !line.startsWith('[OCR]') && line !== '[OCR 识别结果]')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n');
      lastResult.value = cleanText;
      return cleanText;
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

  return {
    loading, error, lastResult, ready,
    checkReady, recognize, fileToBase64, extractBase64,
  };
}
