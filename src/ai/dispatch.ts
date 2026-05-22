import { getSystemPrompt, getAllPreferences, getLearningCorrections, callLLM } from '@/api/tauri';
import type { DispatchResult, SkillMeta } from '@/types';

// Default render/title mappings (matching old agent-core.js)
const DEFAULT_RENDER: Record<string, string> = {
  'create_record': 'card',
  'query_records': 'list',
  'render_stats': 'chart',
  'render_budget': 'chart',
  'query_collection': 'table',
  'correct_record': 'text',
  'save_preference': 'text',
  'update_prompt': 'text',
  'ask_follow_up': 'text',
  'reply_text': 'text',
  'create_trip_record': 'card',
  'record_trip_payment': 'card',
};

const DEFAULT_TITLE: Record<string, string> = {
  'create_record': '记账',
  'query_records': '查询记录',
  'render_stats': '统计分析',
  'render_budget': '预算管理',
  'query_collection': '数据查询',
  'correct_record': '纠正记录',
  'save_preference': '偏好设置',
  'update_prompt': '规则更新',
  'ask_follow_up': '追问补充',
  'reply_text': '闲聊',
  'create_trip_record': '登记出差',
  'record_trip_payment': '登记发放',
};

const INTENT_MAP: Record<string, string> = {
  'create_record': '记账',
  'correct_record': '纠正记录',
  'update_record': '修改记录',
  'query_records': '查询记录',
  'query_collection': '数据查询',
  'render_stats': '统计分析',
  'render_budget': '预算管理',
  'save_preference': '偏好设置',
  'update_prompt': '修改规则',
  'ask_follow_up': '追问补充',
  'reply_text': '闲聊',
  'create_trip_record': '登记出差',
  'record_trip_payment': '登记发放',
  'update_trip_record': '修改出差记录',
  'delete_trip_record': '删除出差记录',
};

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

/**
 * LLM 降级方案：规则解析
 * 当 LLM 失败时，尝试用简单的规则提取字段
 */
async function fallbackParse(text: string): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};

  // 提取金额
  const amountMatch = text.match(/(\d+\.?\d*)\s*元/);
  if (amountMatch) fields.amount = parseFloat(amountMatch[1]);

  // 提取类型
  if (text.includes('收入') || text.includes('工资') || text.includes('奖金') || text.includes('提成')) {
    fields.type = '收入';
  } else {
    fields.type = '支出';
  }

  // 提取时间
  if (text.includes('今天')) fields.datetime = new Date().toISOString().replace('T', ' ').substring(0, 19);
  else if (text.includes('昨天')) {
    const y = new Date(); y.setDate(y.getDate() - 1);
    fields.datetime = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')} 00:00:00`;
  }

  // 提取备注（简单关键词）
  if (text.includes('吃饭') || text.includes('午餐') || text.includes('晚餐') || text.includes('早餐')) {
    fields.category = '餐饮';
    fields.note = text.includes('吃饭') ? '吃饭' : (text.includes('午餐') ? '午餐' : '餐饮');
  } else if (text.includes('打车') || text.includes('公交') || text.includes('地铁') || text.includes('地铁') || text.includes('交通')) {
    fields.category = '交通出行';
  } else if (text.includes('工资')) {
    fields.category = '工资';
  }

  // 提取支付方式
  if (text.includes('微信')) fields.payment_method = '微信支付';
  else if (text.includes('支付宝')) fields.payment_method = '支付宝';
  else if (text.includes('现金')) fields.payment_method = '现金';
  else if (text.includes('银行卡') || text.includes('银行')) fields.payment_method = '银行卡';

  if (!fields.amount) return {};

  fields.account = fields.account || '个人';
  return fields;
}

export async function dispatchLLM(text: string, conversationContext?: string): Promise<DispatchResult> {
  let result: DispatchResult | null = null;

  try {
    // callLLM (Rust backend) checks for active AI service internally
    const context = await fetchContext();
    let systemMessage = buildSystemMessage(context.dispatchPrompt, context.preferenceText, context.learningText);

    // Inject conversation context if provided
    if (conversationContext) {
      systemMessage += `\n\n## 最近对话上下文\n${conversationContext}\n\n**重要**：以上是对话历史，用户可能在纠正上一条记录。请根据上下文理解用户意图。`;
    }

    console.log('[dispatchLLM] calling LLM with:', text.substring(0, 50));
    const content = await callLLM(systemMessage, text);
    console.log('[dispatchLLM] raw response length:', content?.length ?? 0);
    if (content) {
      console.log('[dispatchLLM] raw response:', JSON.stringify(content.substring(0, 200)));
    }

    if (!content || content.trim().length === 0) {
      throw new Error('LLM 返回空响应');
    }

    // Extract JSON from possible markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    const parsed = JSON.parse(jsonStr.trim()) as DispatchResult;
    if (!parsed.action || !parsed.params) {
      throw new Error('LLM 返回格式不正确');
    }
    result = parsed;
  } catch (e) {
    if (e instanceof SyntaxError || (e instanceof Error && (e.message.includes('LLM 返回') || e.message.includes('空响应')))) {
      console.warn('[dispatchLLM] LLM 解析失败，使用降级方案:', e);
      const fallbackFields = await fallbackParse(text);
      if (Object.keys(fallbackFields).length > 0) {
        const skill: SkillMeta = { name: 'create_record', displayName: '记账', confidence: 0.5 };
        return {
          action: 'create_record',
          params: { fields: fallbackFields },
          render: 'card',
          title: '记账',
          confidence: 0.5,
          _skill: skill,
          _intent: INTENT_MAP['create_record'],
          _fallback: true,
          _error_detail: e instanceof Error ? e.message : String(e),
        } as DispatchResult & { _fallback: boolean; _error_detail: string };
      }
    }
    // Re-throw if no fallback available
    throw e;
  }

  // Enrich result with _skill, _intent, defaults
  const action = result.action;
  const render = result.render || DEFAULT_RENDER[action] || 'text';
  const title = result.title || DEFAULT_TITLE[action] || '';
  const skill: SkillMeta = {
    name: action,
    displayName: DEFAULT_TITLE[action] || action,
    confidence: result.confidence || 0,
  };

  return {
    ...result,
    render,
    title,
    _skill: result._skill || skill,
    _intent: result._intent || INTENT_MAP[action] || action,
  };
}
