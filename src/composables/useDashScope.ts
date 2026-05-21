import { ref } from 'vue';
import { getAllConfig } from '@/api/tauri';

/**
 * 百炼 API 直连调用 composable
 * 封装 LLM chat completions 调用
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function useDashScope() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function chat(
    messages: LLMMessage[],
    options?: {
      model?: string;
      temperature?: number;
      max_tokens?: number;
    },
  ): Promise<LLMResponse> {
    loading.value = true;
    error.value = null;

    try {
      const config = await getAllConfig();
      if (!config.ai_api_key) {
        throw new Error('未配置 AI API Key，请在设置中配置');
      }

      const apiUrl = config.ai_api_url;
      const model = options?.model || config.ai_model;
      const temperature = options?.temperature ?? 0.1;
      const maxTokens = options?.max_tokens ?? 1000;

      const response = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.ai_api_key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`LLM API 错误 (${response.status}): ${errText}`);
      }

      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('LLM 返回空响应');
      }

      return {
        content,
        usage: json.usage
          ? {
              prompt_tokens: json.usage.prompt_tokens,
              completion_tokens: json.usage.completion_tokens,
              total_tokens: json.usage.total_tokens,
            }
          : undefined,
      };
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 解析 LLM 返回的 JSON（支持 markdown code block 包裹）
   */
  function parseJsonResponse(content: string): unknown {
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;
    return JSON.parse(jsonStr.trim());
  }

  return {
    loading, error,
    chat, parseJsonResponse,
  };
}
