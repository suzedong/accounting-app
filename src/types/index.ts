export type RecordType = '收入' | '支出';
export type AccountType = '个人' | '家庭' | '公司';
export type TripStatus = '⏳ 待发放' | '✅ 已发放' | '❌ 已过期';

export interface AccountRecord {
  id: number;
  uuid: string;
  datetime: string;
  type: RecordType;
  category: string | null;
  amount: number;
  account: string;
  note: string | null;
  payment_method: string | null;
  local_updated_at: string;
  synced: number;
  nocobase_id: number | null;
  nocobase_updated_at: string | null;
  created_at: string;
}

export interface RecordInput {
  datetime: string;
  type: RecordType;
  category?: string;
  amount: number;
  account?: string;
  note?: string;
  payment_method?: string;
}

export interface TripRecord {
  id: number;
  uuid: string;
  trip_id: string | null;
  start_date: string | null;
  end_date: string | null;
  days: number;
  trip_allowance: number;
  transport_allowance: number;
  total: number;
  status: TripStatus;
  paid_trip_allowance: number;
  paid_transport_allowance: number;
  paid_date: string | null;
  notes: string | null;
  synced: number;
  nocobase_id: number | null;
  nocobase_updated_at: string | null;
  created_at: string;
}

export interface CategoryStat {
  category: string;
  total: number;
  count: number;
}

export interface AccountStat {
  account: string;
  total: number;
  count: number;
}

export interface StatsSummary {
  expense_total: number;
  expense_count: number;
  income_total: number;
  income_count: number;
  balance: number;
}

export interface MonthTrend {
  month: string;
  income: number;
  expense: number;
}

export interface BudgetAnalysis {
  budget_monthly: number;
  actual_expense: number;
  usage_rate: number;
  remaining: number;
  days: number;
  remaining_days: number;
  daily_avg: number;
  daily_remaining: number;
  status: '正常' | '紧张' | '超支';
}

export interface ComparisonPeriod {
  label: string;
  income: number;
  expense: number;
  balance: number;
}

export interface ComparisonResult {
  current: ComparisonPeriod;
  previous: ComparisonPeriod;
}

export interface SkillMeta {
  name: string;
  displayName: string;
  confidence: number;
}

export interface DispatchResult {
  action: string;
  params: Record<string, unknown>;
  render: 'text' | 'table' | 'card' | 'list' | 'chart';
  title: string;
  confidence: number;
  /** Skill metadata (set by dispatch or action handler) */
  _skill?: SkillMeta;
  /** Intent label for thinking UI */
  _intent?: string;
}

export interface ChatMessage {
  id: number;
  uuid: string;
  role: 'user' | 'ai';
  content: string | null;
  data: string | null;
  skill: string | null;
  confidence: number | null;
  created_at: string;
}

export interface AiService {
  id: string;
  name: string;
  api_url: string;
  api_key: string;
  model: string;
  active: boolean;
}

export interface FollowUpResult {
  question: string;
  missingFields: string[];
  originalFields: Record<string, unknown>;
}

export interface AppConfig {
  budget_monthly: number;
}

export interface AllConfig {
  nocobase_url: string;
  nocobase_token: string;
  budget_monthly: number;
}

export interface ApiResponse<T> {
  data: T;
  meta?: { count: number };
}
