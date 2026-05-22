import { z } from 'zod';
import {
  createRecord, updateRecord, getRecords, getStatsSummary, getStatsByCategory,
  getBudgetAnalysis, updateSystemPrompt, updatePreference, clearChatHistory,
  createTrip, updateTrip, deleteTrip, getTrips, getRecords as getRecordsApi,
} from '@/api/tauri';
import type { RecordInput, TripRecord } from '@/types';

// ============================================================
// Tool Schema 定义（一个定义，三种用途：JSON Schema / TS 类型 / 运行时校验）
// ============================================================

const CreateRecordSchema = z.object({
  datetime: z.string().optional(),
  type: z.enum(['收入', '支出']),
  category: z.string().optional(),
  amount: z.number().positive(),
  account: z.string().optional(),
  note: z.string().optional(),
  payment: z.string().optional(),
});

const CorrectRecordSchema = z.object({
  fields: z.object({
    datetime: z.string().optional(),
    type: z.enum(['收入', '支出']).optional(),
    category: z.string().optional(),
    amount: z.number().positive().optional(),
    account: z.string().optional(),
    note: z.string().optional(),
    payment_method: z.string().optional(),
  }),
  context: z.object({
    amount: z.number().optional(),
    note: z.string().optional(),
    datetime: z.string().optional(),
  }).optional(),
});

const UpdateRecordSchema = z.object({
  recordId: z.number(),
  fields: z.object({
    datetime: z.string().optional(),
    type: z.enum(['收入', '支出']).optional(),
    category: z.string().optional(),
    amount: z.number().positive().optional(),
    account: z.string().optional(),
    note: z.string().optional(),
    payment_method: z.string().optional(),
  }),
});

const QueryRecordsSchema = z.object({
  timeRange: z.enum(['today', 'yesterday', 'week', 'month', 'last_month']).optional(),
  type: z.enum(['支出', '收入', 'all']).optional(),
  category: z.string().optional(),
  account: z.string().optional(),
  limit: z.number().optional(),
});

const RenderStatsSchema = z.object({
  dimension: z.enum(['category', 'account', 'trend', 'comparison']),
  timeRange: z.enum(['month', 'last_month', 'year']).optional(),
  type: z.enum(['收入', '支出']).optional(),
});

const RenderBudgetSchema = z.object({});

const AskFollowUpSchema = z.object({
  question: z.string(),
  missingFields: z.array(z.string()),
  originalFields: z.record(z.string(), z.unknown()),
});

const ReplyTextSchema = z.object({
  text: z.string(),
});

const SavePreferenceSchema = z.object({
  key: z.string(),
  value: z.string(),
});

const UpdatePromptSchema = z.object({
  name: z.string(),
  content: z.string(),
});

const ClearChatSchema = z.object({});

const CreateTripRecordSchema = z.object({
  trip_id: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  days: z.number().positive(),
  notes: z.string().optional(),
});

const ConfirmTripRecordSchema = z.object({
  trip_id: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  days: z.number().positive(),
  notes: z.string().optional(),
});

const RecordTripPaymentSchema = z.object({
  amount: z.number().positive(),
  datetime: z.string().optional(),
});

const ConfirmTripPaymentSchema = z.object({
  tripId: z.number(),
  amount: z.number().positive(),
  matchType: z.enum(['trip_allowance', 'transport_allowance', 'full', 'manual']).optional(),
  datetime: z.string().optional(),
});

const UpdateTripRecordSchema = z.object({
  recordId: z.number().optional(),
  trip_id: z.string().optional(),
  fields: z.object({
    trip_id: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    days: z.number().optional(),
    notes: z.string().optional(),
  }),
});

const DeleteTripRecordSchema = z.object({
  recordId: z.number().optional(),
  trip_id: z.string().optional(),
});

const QueryCollectionSchema = z.object({
  collection: z.enum(['records', 'business_trip']),
});

// ============================================================
// 类型推断
// ============================================================

export type CreateRecordArgs = z.infer<typeof CreateRecordSchema>;
export type CorrectRecordArgs = z.infer<typeof CorrectRecordSchema>;
export type UpdateRecordArgs = z.infer<typeof UpdateRecordSchema>;
export type QueryRecordsArgs = z.infer<typeof QueryRecordsSchema>;
export type RenderStatsArgs = z.infer<typeof RenderStatsSchema>;
export type AskFollowUpArgs = z.infer<typeof AskFollowUpSchema>;
export type ReplyTextArgs = z.infer<typeof ReplyTextSchema>;
export type SavePreferenceArgs = z.infer<typeof SavePreferenceSchema>;
export type UpdatePromptArgs = z.infer<typeof UpdatePromptSchema>;
export type CreateTripRecordArgs = z.infer<typeof CreateTripRecordSchema>;
export type ConfirmTripRecordArgs = z.infer<typeof ConfirmTripRecordSchema>;
export type RecordTripPaymentArgs = z.infer<typeof RecordTripPaymentSchema>;
export type ConfirmTripPaymentArgs = z.infer<typeof ConfirmTripPaymentSchema>;
export type UpdateTripRecordArgs = z.infer<typeof UpdateTripRecordSchema>;
export type DeleteTripRecordArgs = z.infer<typeof DeleteTripRecordSchema>;
export type QueryCollectionArgs = z.infer<typeof QueryCollectionSchema>;

// ============================================================
// ToolResult / Tool 接口
// ============================================================

export interface ToolResult {
  success: boolean;
  result?: unknown;
  error?: string;
  render?: string;      // UI 渲染提示（可选，AgentEngine 会根据此组装 ActionResult）
  message?: string;     // 给用户看的文字（可选）
  data?: unknown;       // 结构化的数据（可选）
}

export interface Tool<Args> {
  name: string;
  description: string;
  schema: z.ZodType<Args>;
  execute: (args: Args) => Promise<ToolResult>;
}

// ============================================================
// 工具注册表
// ============================================================

class ToolRegistry {
  private tools = new Map<string, Tool<unknown>>();

  register<Args>(tool: Tool<Args>) {
    this.tools.set(tool.name, tool as Tool<unknown>);
  }

  /** 获取 LLM 所需的 tools 数组（JSON Schema 格式） */
  getTools(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }> {
    return [...this.tools.values()].map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: this._zodToJsonSchema(t.schema) as Record<string, unknown>,
      },
    }));
  }

  /** 执行工具（带运行时校验） */
  async execute(name: string, args: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { success: false, error: `未知工具: ${name}` };

    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      return { success: false, error: `参数校验失败: ${(parsed.error as Error).message || 'unknown'}` };
    }

    try {
      const result = await tool.execute(parsed.data);
      return result;
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** 获取所有工具名称 */
  getNames(): string[] {
    return [...this.tools.keys()];
  }

  /** 检查工具是否存在 */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 将 zod schema 转为 JSON Schema（兼容 zod v4 内部结构）
   */
  private _zodToJsonSchema(schema: unknown): Record<string, unknown> {
    const def = (schema as { _def?: { type?: string } })?._def;
    if (!def || def.type !== 'object') return { type: 'object', properties: {} };

    const shape = (schema as { _def?: { shape: Record<string, unknown> } })?._def?.shape;
    if (!shape) return { type: 'object', properties: {} };

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const vDef = (value as { _def?: { type?: string } })?._def;
      properties[key] = this._zodTypeToJsonSchema(value);
      if (vDef?.type !== 'optional') {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  private _zodTypeToJsonSchema(schema: unknown): Record<string, unknown> {
    const def = (schema as { _def?: { type?: string; innerType?: unknown; element?: unknown; entries?: Record<string, string> } })?._def;
    if (!def) return {};

    switch (def.type) {
      case 'string': return { type: 'string' };
      case 'number': return { type: 'number' };
      case 'boolean': return { type: 'boolean' };
      case 'array': return { type: 'array', items: this._zodTypeToJsonSchema(def.element) };
      case 'enum': {
        const entries = def.entries || {};
        return { type: 'string', enum: Object.values(entries) };
      }
      case 'optional': case 'nullable': return this._zodTypeToJsonSchema(def.innerType);
      case 'object': return this._zodToJsonSchema(schema);
      case 'record': return { type: 'object' };
      case 'default': return this._zodTypeToJsonSchema(def.innerType);
      default: return {};
    }
  }
}

// ============================================================
// 工具实现
// ============================================================

const toolRegistry = new ToolRegistry();

// --- create_record ---
toolRegistry.register<CreateRecordArgs>({
  name: 'create_record',
  description: '创建一条记账记录，返回确认卡片（不直接入库，等用户确认后再保存）',
  schema: CreateRecordSchema,
  execute: async (args) => {
    const now = new Date();
    return {
      success: true,
      render: 'card',
      message: '我帮你整理了一下，请确认：',
      data: {
        datetime: args.datetime || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 12:00:00`,
        type: args.type,
        category: args.category || '其他',
        amount: args.amount,
        account: args.account || '个人',
        note: args.note || '',
        payment: args.payment || '',
      },
    };
  },
});

// --- confirm_record ---
toolRegistry.register<CreateRecordArgs>({
  name: 'confirm_record',
  description: '确认并保存一条记账记录（用户确认后调用）',
  schema: CreateRecordSchema,
  execute: async (args) => {
    const now = new Date();
    const fields: RecordInput = {
      datetime: args.datetime || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} 12:00:00`,
      type: args.type,
      category: args.category || '其他',
      amount: args.amount,
      account: args.account || '个人',
      note: args.note || '',
      payment_method: args.payment || '',
    };
    await createRecord(fields);
    return {
      success: true,
      render: 'text',
      message: `已记录：${fields.type} ${fields.amount}元 - ${fields.category}`,
      data: fields,
    };
  },
});

// --- correct_record ---
toolRegistry.register<CorrectRecordArgs>({
  name: 'correct_record',
  description: '纠正上一条或最近的记录，根据 context 匹配目标记录并更新',
  schema: CorrectRecordSchema,
  execute: async (args) => {
    if (!args.fields || Object.keys(args.fields).length === 0) {
      return { success: false, error: '缺少修正信息', render: 'text' };
    }

    let target: { id: number } | undefined;

    if (args.context) {
      const records = await getRecords({ page: 1, pageSize: 100, sort: 'datetime_desc' });
      for (const r of records.data) {
        let match = true;
        if (args.context.amount && Math.abs(r.amount - args.context.amount) > 0.01) match = false;
        if (args.context.note && !r.note?.includes(args.context.note)) match = false;
        if (args.context.datetime && r.datetime !== args.context.datetime) match = false;
        if (match) { target = { id: r.id }; break; }
      }
    }

    if (!target) {
      const records = await getRecords({ page: 1, pageSize: 1, sort: 'datetime_desc' });
      if (records.data.length > 0) target = { id: records.data[0].id };
    }

    if (!target) return { success: false, error: '未找到可修正的记录', render: 'text' };

    const updated = await updateRecord(target.id, args.fields as Partial<RecordInput>);
    return { success: true, render: 'text', message: '已修正记录', data: updated };
  },
});

// --- update_record ---
toolRegistry.register<UpdateRecordArgs>({
  name: 'update_record',
  description: '按记录 ID 修改指定记录',
  schema: UpdateRecordSchema,
  execute: async (args) => {
    await updateRecord(args.recordId, args.fields as Partial<RecordInput>);
    return { success: true, render: 'text', message: '已更新记录' };
  },
});

// --- query_records ---
toolRegistry.register<QueryRecordsArgs>({
  name: 'query_records',
  description: '查询记账记录列表',
  schema: QueryRecordsSchema,
  execute: async (args) => {
    const now = new Date();
    let datetimeGte = '';

    switch (args.timeRange) {
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
      pageSize: args.limit || 10,
      datetimeGte: datetimeGte || undefined,
      filterType: args.type === 'all' ? undefined : args.type || undefined,
      sort: 'datetime_desc',
    });

    return {
      success: true,
      render: 'list',
      message: `找到 ${records.meta?.count || 0} 条记录`,
      data: records.data,
    };
  },
});

// --- render_stats ---
toolRegistry.register<RenderStatsArgs>({
  name: 'render_stats',
  description: '统计分析，按分类/账户/趋势/对比维度展示',
  schema: RenderStatsSchema,
  execute: async (args) => {
    const now = new Date();
    let datetimeGte = '';

    switch (args.timeRange) {
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
    if (args.dimension === 'category') {
      data = await getStatsByCategory(datetimeGte, args.type || '支出');
    } else {
      data = await getStatsSummary(datetimeGte);
    }

    return { success: true, render: 'chart', message: `${args.timeRange || 'month'} ${args.type || '支出'}统计`, data };
  },
});

// --- render_budget ---
toolRegistry.register<typeof RenderBudgetSchema._output>({
  name: 'render_budget',
  description: '展示预算执行状态',
  schema: RenderBudgetSchema,
  execute: async () => {
    const config = await import('@/api/tauri').then(m => m.getAllConfig());
    const budgetMonthly = config.budget_monthly || 3500;
    const analysis = await getBudgetAnalysis('month', budgetMonthly);
    return { success: true, render: 'chart', message: `本月预算状态: ${analysis.status}`, data: analysis };
  },
});

// --- ask_follow_up ---
toolRegistry.register<AskFollowUpArgs>({
  name: 'ask_follow_up',
  description: '追问用户补充缺失的信息',
  schema: AskFollowUpSchema,
  execute: async (args) => ({
    success: false,
    render: 'followUp',
    message: args.question,
    data: { question: args.question, missingFields: args.missingFields, originalFields: args.originalFields },
  }),
});

// --- reply_text ---
toolRegistry.register<ReplyTextArgs>({
  name: 'reply_text',
  description: '纯文本回复用户',
  schema: ReplyTextSchema,
  execute: async (args) => ({
    success: true,
    render: 'text',
    message: args.text,
  }),
});

// --- save_preference ---
toolRegistry.register<SavePreferenceArgs>({
  name: 'save_preference',
  description: '保存用户偏好设置',
  schema: SavePreferenceSchema,
  execute: async (args) => {
    try {
      await updatePreference(args.key, args.value);
      return { success: true, render: 'text', message: `已保存偏好: ${args.key} = ${args.value}` };
    } catch (e) {
      return { success: false, error: `保存偏好失败: ${e instanceof Error ? e.message : String(e)}`, render: 'text' };
    }
  },
});

// --- update_prompt ---
toolRegistry.register<UpdatePromptArgs>({
  name: 'update_prompt',
  description: '修改系统 prompt 内容',
  schema: UpdatePromptSchema,
  execute: async (args) => {
    try {
      await updateSystemPrompt(args.name, args.content);
      return { success: true, render: 'text', message: `已更新 prompt: ${args.name}` };
    } catch (e) {
      return { success: false, error: `更新 prompt 失败: ${e instanceof Error ? e.message : String(e)}`, render: 'text' };
    }
  },
});

// --- clear_chat ---
toolRegistry.register<{}>({
  name: 'clear_chat',
  description: '清空对话历史',
  schema: ClearChatSchema,
  execute: async () => {
    try {
      await clearChatHistory();
      return { success: true, render: 'text', message: '已清空对话历史' };
    } catch (e) {
      return { success: false, error: `清空历史失败: ${e instanceof Error ? e.message : String(e)}`, render: 'text' };
    }
  },
});

// --- create_trip_record ---
toolRegistry.register<CreateTripRecordArgs>({
  name: 'create_trip_record',
  description: '创建差旅补助记录，返回确认卡片（不直接入库）',
  schema: CreateTripRecordSchema,
  execute: async (args) => {
    const tripAllowance = args.days * 100;
    const transportAllowance = args.days * 30;
    const total = tripAllowance + transportAllowance;
    return {
      success: true,
      render: 'card',
      message: '我帮你整理了出差记录，请确认：',
      data: {
        trip_id: args.trip_id,
        start_date: args.start_date,
        end_date: args.end_date,
        days: args.days,
        trip_allowance: tripAllowance,
        transport_allowance: transportAllowance,
        total,
        status: '⏳ 待发放',
        notes: args.notes || '',
      },
    };
  },
});

// --- confirm_trip_record ---
toolRegistry.register<ConfirmTripRecordArgs>({
  name: 'confirm_trip_record',
  description: '确认并保存差旅补助记录',
  schema: ConfirmTripRecordSchema,
  execute: async (args) => {
    const trip = await createTrip({
      trip_id: args.trip_id,
      start_date: args.start_date,
      end_date: args.end_date,
      days: args.days,
      trip_allowance: args.days * 100,
      transport_allowance: args.days * 30,
      total: args.days * 130,
      status: '⏳ 待发放',
      notes: args.notes,
    });
    return {
      success: true,
      render: 'text',
      message: `已记录出差：${trip.trip_id}（${trip.days}天，补助 ¥${trip.total.toFixed(2)}）`,
      data: trip,
    };
  },
});

// --- record_trip_payment ---
toolRegistry.register<RecordTripPaymentArgs>({
  name: 'record_trip_payment',
  description: '登记出差补助发放，自动匹配待发放记录',
  schema: RecordTripPaymentSchema,
  execute: async (args) => {
    const tripsRes = await getTrips('⏳ 待发放');
    const pendingTrips = tripsRes.data;

    if (pendingTrips.length === 0) {
      return { success: true, render: 'text', message: '当前没有待发放补助的出差记录。' };
    }

    // Match by amount
    interface MatchedTrip { trip: typeof pendingTrips[0]; type: string; label: string; }
    const matchedTrips: MatchedTrip[] = [];

    for (const trip of pendingTrips) {
      const days = trip.days || 0;
      const tripAllowanceTotal = days * 100;
      const transportAllowanceTotal = days * 30;
      const paidTrip = trip.paid_trip_allowance || 0;
      const paidTransport = trip.paid_transport_allowance || 0;
      const needTrip = paidTrip < tripAllowanceTotal - 0.01;
      const needTransport = paidTransport < transportAllowanceTotal - 0.01;

      if (needTrip && Math.abs(args.amount - tripAllowanceTotal) < 0.01) {
        matchedTrips.push({ trip, type: 'trip_allowance', label: '差旅补助' });
      }
      if (needTransport && Math.abs(args.amount - transportAllowanceTotal) < 0.01) {
        matchedTrips.push({ trip, type: 'transport_allowance', label: '交通补助' });
      }
      if (needTrip && needTransport && Math.abs(args.amount - (tripAllowanceTotal + transportAllowanceTotal)) < 0.01) {
        matchedTrips.push({ trip, type: 'full', label: '补助全额' });
      }
    }

    let best: MatchedTrip;
    if (matchedTrips.length === 0) {
      const sorted = [...pendingTrips].sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''));
      const first = sorted[0];
      const total = (first.days || 0) * 130;
      best = { trip: first, type: 'manual', label: `补助（¥${total}）` };
    } else {
      matchedTrips.sort((a, b) => (a.trip.start_date || '').localeCompare(b.trip.start_date || ''));
      best = matchedTrips[0];
    }

    const now = new Date();
    return {
      success: true,
      render: 'card',
      message: '匹配到出差记录，请确认发放：',
      data: {
        tripId: best.trip.id,
        tripId_str: best.trip.trip_id || '',
        amount: args.amount,
        matchType: best.type,
        dateRange: `${(best.trip.start_date || '').substring(0, 10)} ~ ${(best.trip.end_date || '').substring(0, 10)}`,
        label: best.label,
        datetime: args.datetime || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`,
      },
    };
  },
});

// --- confirm_trip_payment ---
toolRegistry.register<ConfirmTripPaymentArgs>({
  name: 'confirm_trip_payment',
  description: '确认并发放出差补助',
  schema: ConfirmTripPaymentSchema,
  execute: async (args) => {
    const trips = await getTrips();
    const trip = trips.data.find(t => t.id === args.tripId);
    if (!trip) return { success: false, error: '未找到出差记录', render: 'text' };

    const days = trip.days || 0;
    const tripAllowanceTotal = days * 100;
    const transportAllowanceTotal = days * 30;
    const paidTrip = trip.paid_trip_allowance || 0;
    const paidTransport = trip.paid_transport_allowance || 0;

    let newPaidTrip = paidTrip;
    let newPaidTransport = paidTransport;

    if (args.matchType === 'trip_allowance') newPaidTrip = paidTrip + args.amount;
    else if (args.matchType === 'transport_allowance') newPaidTransport = paidTransport + args.amount;
    else { newPaidTrip = paidTrip + args.amount; newPaidTransport = paidTransport + args.amount; }

    const status = newPaidTrip >= tripAllowanceTotal - 0.01 && newPaidTransport >= transportAllowanceTotal - 0.01
      ? '✅ 已发放' : '⏳ 待发放';

    const now = new Date();
    await updateTrip(args.tripId, {
      paid_trip_allowance: newPaidTrip,
      paid_transport_allowance: newPaidTransport,
      paid_date: args.datetime || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`,
      status,
    } as Partial<TripRecord>);

    const statusText = status === '✅ 已发放' ? '已发放完毕' : '已登记发放';
    return {
      success: true,
      render: 'text',
      message: `${statusText}：编号 ${trip.trip_id || `ID:${args.tripId}`} 金额 ¥${args.amount.toFixed(2)}`,
    };
  },
});

// --- update_trip_record ---
toolRegistry.register<UpdateTripRecordArgs>({
  name: 'update_trip_record',
  description: '修改出差记录',
  schema: UpdateTripRecordSchema,
  execute: async (args) => {
    let targetId = args.recordId;
    if (!targetId && args.trip_id) {
      const trips = await getTrips();
      const found = trips.data.find(t => t.trip_id === args.trip_id);
      if (found) targetId = found.id;
    }
    if (!targetId) {
      const trips = await getTrips();
      if (trips.data.length > 0) targetId = trips.data[trips.data.length - 1].id;
    }
    if (!targetId) return { success: false, error: '未找到出差记录', render: 'text' };

    await updateTrip(targetId, args.fields);
    return { success: true, render: 'text', message: '已更新出差记录' };
  },
});

// --- delete_trip_record ---
toolRegistry.register<DeleteTripRecordArgs>({
  name: 'delete_trip_record',
  description: '删除出差记录',
  schema: DeleteTripRecordSchema,
  execute: async (args) => {
    let targetId = args.recordId;
    if (!targetId && args.trip_id) {
      const trips = await getTrips();
      const found = trips.data.find(t => t.trip_id === args.trip_id);
      if (found) targetId = found.id;
    }
    if (!targetId) return { success: false, error: '未找到出差记录', render: 'text' };

    await deleteTrip(targetId);
    return { success: true, render: 'text', message: '已删除出差记录' };
  },
});

// --- query_collection ---
toolRegistry.register<QueryCollectionArgs>({
  name: 'query_collection',
  description: '查询指定数据集合',
  schema: QueryCollectionSchema,
  execute: async (args) => {
    if (args.collection === 'records') {
      const res = await getRecordsApi({ page: 1, pageSize: 20, sort: 'datetime_desc' });
      return { success: true, render: 'table', message: `记账记录（共 ${res.data.length} 条）`, data: res.data };
    }
    if (args.collection === 'business_trip') {
      const res = await getTrips();
      return { success: true, render: 'table', message: `差旅补助（共 ${res.data.length} 条）`, data: res.data };
    }
    return { success: false, error: `未知集合: ${args.collection}`, render: 'text' };
  },
});

export { toolRegistry };
export type { ToolRegistry };
