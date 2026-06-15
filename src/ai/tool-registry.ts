import { z } from 'zod';
import {
  createRecord, updateRecord, getRecords, getStatsSummary, getStatsByCategory,
  getBudgetAnalysis, updateSystemPrompt, updatePreference, clearChatHistory,
  createTrip, updateTrip, deleteTrip, getTrips, getRecords as getRecordsApi,
} from '@/api/tauri';
import type { AccountRecord, RecordInput, RecordType, TripRecord } from '@/types';

// ============================================================
// Tool Schema 定义（一个定义，三种用途：JSON Schema / TS 类型 / 运行时校验）
// ============================================================

// 收入/支出类型：先 trim 再做 enum 校验，容忍 LLM 返回带空格的值
const RecordTypeSchema = z.preprocess(
  v => (typeof v === 'string' ? v.trim() : v),
  z.enum(['收入', '支出']),
);

const CreateRecordSchema = z.object({
  datetime: z.string().optional(),
  type: RecordTypeSchema,
  category: z.string().optional(),
  // OCR 可能提取负数（如 -8.00），自动取绝对值
  amount: z.coerce.number().transform(a => Math.abs(a)).refine(a => a > 0, '金额必须大于 0'),
  account: z.string().optional(),
  note: z.string().optional(),
  payment: z.string().optional(),
});

const CorrectRecordSchema = z.object({
  fields: z.object({
    datetime: z.string().optional(),
    type: RecordTypeSchema.optional(),
    category: z.string().optional(),
    amount: z.coerce.number().transform(a => Math.abs(a)).refine(a => a > 0, '金额必须大于 0').optional(),
    account: z.string().optional(),
    note: z.string().optional(),
    payment_method: z.string().optional(),
    payment: z.string().optional(),
  }),
  context: z.object({
    amount: z.coerce.number().optional(),
    note: z.string().optional(),
    datetime: z.string().optional(),
  }).optional(),
});

const UpdateRecordSchema = z.object({
  recordId: z.number(),
  fields: z.object({
    datetime: z.string().optional(),
    type: RecordTypeSchema.optional(),
    category: z.string().optional(),
    amount: z.coerce.number().transform(a => Math.abs(a)).refine(a => a > 0, '金额必须大于 0').optional(),
    account: z.string().optional(),
    note: z.string().optional(),
    payment_method: z.string().optional(),
    payment: z.string().optional(),
  }),
});

const ConfirmCorrectionSchema = z.object({
  recordId: z.number(),
  fields: z.object({
    datetime: z.string().optional(),
    type: RecordTypeSchema.optional(),
    category: z.string().optional(),
    amount: z.coerce.number().transform(a => Math.abs(a)).refine(a => a > 0, '金额必须大于 0').optional(),
    account: z.string().optional(),
    note: z.string().optional(),
    payment_method: z.string().optional(),
    payment: z.string().optional(),
  }),
});

const QueryRecordsSchema = z.object({
  timeRange: z.enum(['today', 'yesterday', 'week', 'month', 'last_month']).optional(),
  type: z.preprocess(
    v => (typeof v === 'string' ? v.trim() : v),
    z.enum(['支出', '收入', 'all']),
  ).optional(),
  category: z.string().optional(),
  account: z.string().optional(),
  limit: z.number().optional(),
});

const RenderStatsSchema = z.object({
  dimension: z.enum(['category', 'account', 'trend', 'comparison']),
  timeRange: z.enum(['month', 'last_month', 'year']).optional(),
  type: RecordTypeSchema.optional(),
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
  amount: z.coerce.number().transform(a => Math.abs(a)).refine(a => a > 0, '金额必须大于 0'),
  datetime: z.string().optional(),
});

const ConfirmTripPaymentSchema = z.object({
  tripId: z.number(),
  amount: z.coerce.number().transform(a => Math.abs(a)).refine(a => a > 0, '金额必须大于 0'),
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
export type ConfirmCorrectionArgs = z.infer<typeof ConfirmCorrectionSchema>;
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

export interface ToolRuntimeContext {
  userMessage: string;
  lastConfirmedRecord?: AccountRecord | null;
}

export interface CorrectionChange {
  field: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface CorrectionResultData {
  targetRecord: Record<string, unknown>;
  changes: CorrectionChange[];
  risk: 'low' | 'high';
  reason?: string;
  pendingUpdate?: {
    recordId: number;
    fields: Record<string, unknown>;
  };
  updatedRecord?: Record<string, unknown>;
}

export interface Tool<Args> {
  name: string;
  description: string;
  schema: z.ZodType<Args>;
  execute: (args: Args, context?: ToolRuntimeContext) => Promise<ToolResult>;
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
  async execute(name: string, args: unknown, context?: ToolRuntimeContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { success: false, error: `未知工具: ${name}` };

    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
      return { success: false, error: `参数校验失败: ${(parsed.error as Error).message || 'unknown'}` };
    }

    try {
      const result = await tool.execute(parsed.data, context);
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
    const def = (schema as { _def?: { type?: string; innerType?: unknown; element?: unknown; entries?: Record<string, string>; in?: unknown; out?: unknown } })?._def;
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
      case 'pipe': return this._zodTypeToJsonSchema(def.in); // Zod v4 transform/pipe
      case 'object': return this._zodToJsonSchema(schema);
      case 'record': return { type: 'object' };
      case 'default': return this._zodTypeToJsonSchema(def.innerType);
      case 'coerce': return this._zodTypeToJsonSchema(def.innerType || def.type);
      default: return {};
    }
  }
}

// ============================================================
// 修正流程工具函数
// ============================================================

const LOW_RISK_FIELDS = new Set(['account', 'category', 'note', 'payment_method', 'payment']);
const HIGH_RISK_FIELDS = new Set(['amount', 'datetime', 'type']);
const RECENT_RECORD_KEYWORDS = ['上一条', '刚才那条', '刚刚那条', '这条', '刚才的', '上一笔'];

const FIELD_LABELS: Record<string, string> = {
  datetime: '时间',
  type: '类型',
  category: '分类',
  amount: '金额',
  account: '账户',
  note: '备注',
  payment_method: '支付方式',
  payment: '支付方式',
};

function normalizeRecordFields(fields: Record<string, unknown>): Partial<RecordInput> {
  const normalized: Partial<RecordInput> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    const targetKey = key === 'payment' ? 'payment_method' : key;
    if (targetKey === 'amount') {
      const amount = typeof value === 'number' ? value : parseFloat(String(value));
      if (!Number.isNaN(amount) && amount > 0) normalized.amount = Math.abs(amount);
    } else if (targetKey === 'type') {
      const trimmed = String(value).trim();
      if (trimmed === '收入' || trimmed === '支出') normalized.type = trimmed;
    } else if (['datetime', 'category', 'account', 'note', 'payment_method'].includes(targetKey)) {
      (normalized as Record<string, unknown>)[targetKey] = String(value);
    }
  }
  return normalized;
}

function hasRecentRecordReference(message: string): boolean {
  return RECENT_RECORD_KEYWORDS.some(keyword => message.includes(keyword));
}

function recordToCorrectionTarget(record: AccountRecord): Record<string, unknown> {
  return {
    id: record.id,
    datetime: record.datetime,
    type: record.type,
    amount: record.amount,
    category: record.category,
    account: record.account,
    note: record.note,
    payment_method: record.payment_method,
  };
}

function buildCorrectionChanges(target: AccountRecord, fields: Partial<RecordInput>): CorrectionChange[] {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .filter(([field, value]) => String((target as unknown as Record<string, unknown>)[field] ?? '') !== String(value ?? ''))
    .map(([field, value]) => ({
      field,
      label: FIELD_LABELS[field] || field,
      oldValue: (target as unknown as Record<string, unknown>)[field] ?? '',
      newValue: value,
    }));
}

function hasContextConflict(target: AccountRecord, context?: CorrectRecordArgs['context']): boolean {
  if (!context) return false;
  if (context.amount !== undefined && Math.abs(target.amount - context.amount) > 0.01) return true;
  if (context.note && !(target.note || '').includes(context.note)) return true;
  if (context.datetime && target.datetime !== context.datetime) return true;
  return false;
}

function classifyCorrectionRisk(
  changes: CorrectionChange[],
  targetSource: 'lastConfirmed' | 'latest' | 'context' | 'none',
  contextConflict: boolean,
  userMessage: string,
): { risk: 'low' | 'high'; reason?: string } {
  if (targetSource === 'none') return { risk: 'high', reason: '未找到明确目标记录' };
  if (targetSource === 'context') return { risk: 'high', reason: '只能通过上下文模糊匹配目标记录' };
  if (contextConflict) return { risk: 'high', reason: '检测到目标信息不一致，请确认修改' };
  if (changes.length === 0) return { risk: 'high', reason: '没有检测到实际修改内容' };
  if (changes.length > 1) return { risk: 'high', reason: '一次修改多个字段，需要确认' };
  const field = changes[0].field;
  if (HIGH_RISK_FIELDS.has(field)) return { risk: 'high', reason: `修改${FIELD_LABELS[field] || field}，需要确认` };
  if (!LOW_RISK_FIELDS.has(field)) return { risk: 'high', reason: `修改${FIELD_LABELS[field] || field}，需要确认` };
  if (/那条改一下|这个不对|改一下|不对$/.test(userMessage)) return { risk: 'high', reason: '用户表达较含糊，需要确认' };
  return { risk: 'low' };
}

async function resolveCorrectionTarget(
  args: CorrectRecordArgs,
  context?: ToolRuntimeContext,
): Promise<{ record: AccountRecord | null; source: 'lastConfirmed' | 'latest' | 'context' | 'none' }> {
  if (context?.lastConfirmedRecord) {
    return { record: context.lastConfirmedRecord, source: 'lastConfirmed' };
  }

  if (context?.userMessage && hasRecentRecordReference(context.userMessage)) {
    const records = await getRecords({ page: 1, pageSize: 1, sort: 'datetime_desc' });
    if (records.data.length > 0) return { record: records.data[0], source: 'latest' };
  }

  if (args.context) {
    const records = await getRecords({ page: 1, pageSize: 100, sort: 'datetime_desc' });
    for (const record of records.data) {
      if (args.context.amount !== undefined && Math.abs(record.amount - args.context.amount) > 0.01) continue;
      if (args.context.note && !(record.note || '').includes(args.context.note)) continue;
      if (args.context.datetime && record.datetime !== args.context.datetime) continue;
      return { record, source: 'context' };
    }
  }

  return { record: null, source: 'none' };
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
        payment: args.payment || '现金',
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
      type: args.type as RecordType,
      category: args.category || '其他',
      amount: args.amount,
      account: args.account || '个人',
      note: args.note || '',
      payment_method: args.payment || '',
    };
    const created = await createRecord(fields);
    return {
      success: true,
      render: 'text',
      message: `已记录：${fields.type} ${fields.amount}元 - ${fields.category}`,
      data: created,
    };
  },
});

// --- correct_record ---
toolRegistry.register<CorrectRecordArgs>({
  name: 'correct_record',
  description: '纠正上一条或最近的记录，应用定位目标记录并按风险分级执行',
  schema: CorrectRecordSchema,
  execute: async (args, context) => {
    const fields = normalizeRecordFields(args.fields as Record<string, unknown>);
    if (Object.keys(fields).length === 0) {
      return { success: false, error: '缺少修正信息', render: 'text' };
    }

    const { record: target, source } = await resolveCorrectionTarget(args, context);
    if (!target) return { success: false, error: '未找到可修正的记录，请说明要修改哪一条。', render: 'text' };

    const changes = buildCorrectionChanges(target, fields);
    const contextConflict = hasContextConflict(target, args.context);
    const { risk, reason } = classifyCorrectionRisk(changes, source, contextConflict, context?.userMessage || '');
    const targetRecord = recordToCorrectionTarget(target);

    if (risk === 'high') {
      const data: CorrectionResultData = {
        targetRecord,
        changes,
        risk,
        reason,
        pendingUpdate: {
          recordId: target.id,
          fields: fields as Record<string, unknown>,
        },
      };
      return {
        success: true,
        render: 'correctionCard',
        message: '请确认修改（尚未保存）',
        data,
      };
    }

    const updated = await updateRecord(target.id, fields);
    const data: CorrectionResultData = {
      targetRecord,
      changes,
      risk,
      updatedRecord: updated as unknown as Record<string, unknown>,
    };
    return { success: true, render: 'text', message: '已修正记录', data };
  },
});

// --- update_record ---
toolRegistry.register<UpdateRecordArgs>({
  name: 'update_record',
  description: '按记录 ID 修改指定记录',
  schema: UpdateRecordSchema,
  execute: async (args) => {
    await updateRecord(args.recordId, normalizeRecordFields(args.fields as Record<string, unknown>));
    return { success: true, render: 'text', message: '已更新记录' };
  },
});

// --- confirm_correction ---
toolRegistry.register<ConfirmCorrectionArgs>({
  name: 'confirm_correction',
  description: '确认并执行高风险修正（仅由 UI 确认流程调用）',
  schema: ConfirmCorrectionSchema,
  execute: async (args) => {
    const fields = normalizeRecordFields(args.fields as Record<string, unknown>);
    const updated = await updateRecord(args.recordId, fields);
    const data: CorrectionResultData = {
      targetRecord: recordToCorrectionTarget(updated),
      changes: [],
      risk: 'high',
      updatedRecord: updated as unknown as Record<string, unknown>,
    };
    return { success: true, render: 'text', message: '已修正记录', data };
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

    // 业务规则：发放日期 ≥ end_date + 10 天
    // 优先在该窗口内匹配；若窗口内无候选，回退到所有待发放记录（保证不漏匹配）
    const txDate = args.datetime ? new Date(args.datetime) : new Date();
    const eligibleByWindow = pendingTrips.filter(trip => {
      if (!trip.end_date) return true; // end_date 缺失时不参与窗口过滤
      const endDate = new Date(trip.end_date);
      if (Number.isNaN(endDate.getTime())) return true;
      const earliest = new Date(endDate.getTime() + 10 * 24 * 60 * 60 * 1000);
      return txDate.getTime() >= earliest.getTime();
    });
    const candidatePool = eligibleByWindow.length > 0 ? eligibleByWindow : pendingTrips;

    // Match by amount
    interface MatchedTrip { trip: typeof pendingTrips[0]; type: string; label: string; }
    const matchedTrips: MatchedTrip[] = [];

    for (const trip of candidatePool) {
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
      // 回退：候选池中按 end_date 升序取最早一条（手动金额）
      const sorted = [...candidatePool].sort((a, b) => (a.end_date || '').localeCompare(b.end_date || ''));
      const first = sorted[0];
      const total = (first.days || 0) * 130;
      best = { trip: first, type: 'manual', label: `补助（¥${total}）` };
    } else {
      // 同金额多条命中时，按 end_date 升序优先（最早结束的优先发放）
      matchedTrips.sort((a, b) => (a.trip.end_date || '').localeCompare(b.trip.end_date || ''));
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
