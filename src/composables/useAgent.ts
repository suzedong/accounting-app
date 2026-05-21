import { ref } from 'vue';
import type { ActionResult } from '@/ai/actions';
import { dispatchLLM } from '@/ai/dispatch';
import { executeAction } from '@/ai/actions';
import type { DispatchResult } from '@/types';

/**
 * Agent dispatch + execute composable
 * 封装 LLM 意图识别 → Action 执行的完整流程
 */
export function useAgent() {
  const loading = ref(false);
  const lastResult = ref<DispatchResult | null>(null);
  const lastAction = ref<ActionResult | null>(null);
  const error = ref<string | null>(null);

  async function dispatch(text: string): Promise<DispatchResult> {
    loading.value = true;
    error.value = null;
    try {
      const result = await dispatchLLM(text);
      lastResult.value = result;
      return result;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function execute(result: DispatchResult): Promise<ActionResult> {
    loading.value = true;
    error.value = null;
    try {
      const actionResult = await executeAction(result);
      lastAction.value = actionResult;
      return actionResult;
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function run(text: string): Promise<ActionResult> {
    const dispatchResult = await dispatch(text);
    return execute(dispatchResult);
  }

  return {
    loading, lastResult, lastAction, error,
    dispatch, execute, run,
  };
}
