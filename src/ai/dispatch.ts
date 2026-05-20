import { getSystemPrompt, getAllPreferences, getLearningCorrections, getAllConfig } from '@/api/tauri';
import type { DispatchResult } from '@/types';

export async function fetchContext(): Promise<{ dispatchPrompt: string; preferenceText: string; learningText: string }> {
  const [promptRes, prefRes, learningRes] = await Promise.allSettled([
    getSystemPrompt('dispatch'),
    getAllPreferences(),
    getLearningCorrections(),
  ]);

  const dispatchPrompt = promptRes.status === 'fulfilled'
    ? promptRes.value.data.content
    : '';

  const preferenceText = prefRes.status === 'fulfilled'
    ? prefRes.value.data.map(p => `${p.key}: ${p.value}`).join('\n')
    : '';

  const learningText = learningRes.status === 'fulfilled'
    ? buildLearningContext(learningRes.value.data)
    : '';

  return { dispatchPrompt, preferenceText, learningText };
}

function buildLearningContext(data: Array<{ keyword: string; field: string; value: string }>): string {
  if (data.length === 0) return '';

  // Group by field, show top entries
  const grouped: Record<string, Array<{ keyword: string; value: string }>> = {};
  for (const d of data) {
    if (!grouped[d.field]) grouped[d.field] = [];
    grouped[d.field].push({ keyword: d.keyword, value: d.value });
  }

  let text = '\n## 学习数据（用户修正历史）\n';
  for (const [field, entries] of Object.entries(grouped)) {
    text += `\n### ${field}\n`;
    // Show most common ones
    const freq: Record<string, number> = {};
    for (const e of entries) {
      const key = `${e.keyword}→${e.value}`;
      freq[key] = (freq[key] || 0) + 1;
    }
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [k, count] of sorted) {
      text += `- ${k} (使用 ${count} 次)\n`;
    }
  }
  return text;
}

export function buildSystemMessage(
  dispatchPrompt: string,
  preferenceText: string,
  learningText: string,
): string {
  let system = dispatchPrompt;
  if (preferenceText) {
    system += `\n\n## 用户偏好\n${preferenceText}`;
  }
  if (learningText) {
    system += `\n\n${learningText}`;
  }
  return system;
}

export async function dispatchLLM(text: string): Promise<DispatchResult> {
  const config = await getAllConfig();
  if (!config.ai_api_key) {
    throw new Error('未配置 AI API Key，请在设置中配置');
  }

  const context = await fetchContext();
  const systemMessage = buildSystemMessage(context.dispatchPrompt, context.preferenceText, context.learningText);

  const response = await fetch(`${config.ai_api_url}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.ai_api_key}`,
    },
    body: JSON.stringify({
      model: config.ai_model,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 1000,
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

  // Extract JSON from possible markdown code blocks
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : content;

  try {
    const result = JSON.parse(jsonStr.trim()) as DispatchResult;
    if (!result.action || !result.params) {
      throw new Error('LLM 返回格式不正确');
    }
    return result;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error(`LLM 返回非 JSON 格式: ${content.slice(0, 200)}`);
    }
    throw e;
  }
}
