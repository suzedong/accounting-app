import { createRecord, updateRecord, getRecords, getStatsSummary, getStatsByCategory, getBudgetAnalysis } from '@/api/tauri';
import type { RecordInput, AccountRecord, DispatchResult } from '@/types';

export interface ActionResult {
  success: boolean;
  message: string;
  data?: unknown;
  render: string;
}

export type ActionHandler = (params: Record<string, unknown>) => Promise<ActionResult>;

const actionHandlers = new Map<string, ActionHandler>();

export function registerActionHandler(action: string, handler: ActionHandler) {
  actionHandlers.set(action, handler);
}

export async function executeAction(result: DispatchResult): Promise<ActionResult> {
  const { action, params } = result;
  const handler = actionHandlers.get(action);
  if (!handler) {
    return {
      success: false,
      message: `未知的 action: ${action}`,
      render: 'text',
    };
  }
  try {
    return await handler(params);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      success: false,
      message: `执行失败: ${message}`,
      render: 'text',
    };
  }
}

// --- Action Handlers ---

export async function handleCreateRecord(params: Record<string, unknown>): Promise<ActionResult> {
  const raw = params.fields as Record<string, unknown> | undefined;
  if (!raw || !raw.amount) return { success: false, message: '缺少金额信息', render: 'text' };
  const amount = typeof raw.amount === 'number' ? raw.amount : parseFloat(String(raw.amount));
  if (!amount || amount <= 0) return { success: false, message: '金额必须大于 0', render: 'text' };

  const fields: RecordInput = {
    datetime: typeof raw.datetime === 'string' ? raw.datetime : new Date().toISOString().replace('T', ' ').substring(0, 19),
    type: (raw.type === '收入' ? '收入' : '支出') as RecordInput['type'],
    category: typeof raw.category === 'string' ? raw.category : '其他',
    amount,
    account: typeof raw.account === 'string' ? raw.account : '个人',
    note: typeof raw.note === 'string' ? raw.note : '',
    payment_method: typeof raw.payment_method === 'string' ? raw.payment_method : (typeof raw.payment === 'string' ? raw.payment : ''),
  };

  const record = await createRecord(fields);

  return {
    success: true,
    message: `已创建记录: ${fields.type} ${fields.amount}元 - ${fields.category}`,
    data: record,
    render: (params.render as string) || 'card',
  };
}

export async function handleCorrectRecord(params: Record<string, unknown>): Promise<ActionResult> {
  const fields = params.fields as Record<string, unknown> | undefined;
  const context = params.context as Record<string, unknown> | undefined;

  if (!fields) {
    return { success: false, message: '缺少修正信息', render: 'text' };
  }

  // Try to find the record to correct using context
  if (context) {
    const records = await getRecords({ page: 1, page_size: 100, sort: 'datetime_desc' });
    let target: AccountRecord | undefined;

    // Search by matching context fields
    for (const r of records.data) {
      let match = true;
      if (context.amount && Math.abs(r.amount - (context.amount as number)) > 0.01) match = false;
      if (context.note && !r.note?.includes(context.note as string)) match = false;
      if (context.datetime && r.datetime !== context.datetime) match = false;
      if (match) { target = r; break; }
    }

    if (target) {
      await updateRecord(target.id, fields as Partial<RecordInput>);
      return { success: true, message: '已修正记录', data: target, render: 'text' };
    }
  }

  // Fallback: update the most recent record
  const records = await getRecords({ page: 1, page_size: 1, sort: 'datetime_desc' });
  if (records.data.length > 0) {
    const latest = records.data[0];
    await updateRecord(latest.id, fields as Partial<RecordInput>);
    return { success: true, message: '已修正最新记录', data: latest, render: 'text' };
  }

  return { success: false, message: '未找到可修正的记录', render: 'text' };
}

export async function handleUpdateRecord(params: Record<string, unknown>): Promise<ActionResult> {
  const recordId = params.recordId as number | undefined;
  const fields = params.fields as Record<string, unknown> | undefined;

  if (!recordId || !fields) {
    return { success: false, message: '缺少记录ID或修改字段', render: 'text' };
  }

  await updateRecord(recordId, fields as Partial<RecordInput>);
  return { success: true, message: '已更新记录', render: 'text' };
}

export async function handleQueryRecords(params: Record<string, unknown>): Promise<ActionResult> {
  const timeRange = params.timeRange as string | undefined;
  const type = params.type as string | undefined;

  let datetimeGte = '';
  const now = new Date();

  switch (timeRange) {
    case 'today':
      datetimeGte = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 00:00:00`;
      break;
    case 'yesterday': {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      datetimeGte = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')} 00:00:00`;
      break;
    }
    case 'week': {
      const w = new Date(now); w.setDate(w.getDate() - 7);
      datetimeGte = `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, '0')}-${String(w.getDate()).padStart(2, '0')} 00:00:00`;
      break;
    }
    case 'month':
      datetimeGte = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
      break;
    case 'last_month': {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      datetimeGte = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
      break;
    }
  }

  const records = await getRecords({
    page: 1,
    page_size: (params.limit as number) || 10,
    datetime_gte: datetimeGte || undefined,
    filter_type: type === 'all' ? undefined : type || undefined,
    sort: 'datetime_desc',
  });

  return {
    success: true,
    message: `找到 ${records.meta?.count || 0} 条记录`,
    data: records.data,
    render: 'list',
  };
}

export async function handleRenderStats(params: Record<string, unknown>): Promise<ActionResult> {
  const dimension = params.dimension as string;
  const timeRange = params.timeRange as string;
  const type = (params.type as string) || '支出';

  let datetimeGte = '';
  const now = new Date();

  switch (timeRange) {
    case 'month':
      datetimeGte = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
      break;
    case 'last_month': {
      const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      datetimeGte = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
      break;
    }
    case 'year':
      datetimeGte = `${now.getFullYear()}-01-01 00:00:00`;
      break;
    default:
      datetimeGte = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01 00:00:00`;
  }

  let data: unknown;

  if (dimension === 'category') {
    const stats = await getStatsByCategory(datetimeGte, type);
    data = stats;
  } else if (dimension === 'account') {
    const summary = await getStatsSummary(datetimeGte);
    data = summary;
  } else {
    const summary = await getStatsSummary(datetimeGte);
    data = summary;
  }

  return {
    success: true,
    message: `${timeRange} ${type}统计`,
    data,
    render: 'chart',
  };
}

export async function handleRenderBudget(): Promise<ActionResult> {
  const config = await import('@/api/tauri').then(m => m.getAllConfig());
  const budgetMonthly = config.budget_monthly || 3500;

  const analysis = await getBudgetAnalysis('month', budgetMonthly);

  return {
    success: true,
    message: `本月预算状态: ${analysis.status}`,
    data: analysis,
    render: 'chart',
  };
}

export async function handleAskFollowUp(params: Record<string, unknown>): Promise<ActionResult> {
  const question = params.question as string || '请补充更多信息';
  return {
    success: false,
    message: question,
    render: 'text',
  };
}

export async function handleReplyText(params: Record<string, unknown>): Promise<ActionResult> {
  const text = params.text as string || '';
  return {
    success: true,
    message: text,
    render: 'text',
  };
}

// --- Auto-register all handlers ---

registerActionHandler('create_record', handleCreateRecord);
registerActionHandler('correct_record', handleCorrectRecord);
registerActionHandler('update_record', handleUpdateRecord);
registerActionHandler('query_records', handleQueryRecords);
registerActionHandler('render_stats', handleRenderStats);
registerActionHandler('render_budget', handleRenderBudget);
registerActionHandler('ask_follow_up', handleAskFollowUp);
registerActionHandler('reply_text', handleReplyText);
