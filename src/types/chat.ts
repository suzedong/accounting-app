// ============================================================
// Chat 相关类型定义
// ============================================================

/** LLM 消息（传给 API 的标准格式） */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | null;
  tool_call_id?: string;
}

/** 工具调用记录（持久化事实） */
export interface PersistedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/** 操作结果（持久化事实） */
export interface PersistedResult {
  success: boolean;
  action?: string;
  message?: string;
  recordId?: number;
}

/** 持久化消息数据（存储事实，非 UI 状态） */
export interface PersistedChatData {
  /** LLM 对话消息（用于恢复 Agent 上下文） */
  llmMessages?: LLMMessage[];
  /** 工具调用（用于学习引擎分析） */
  toolCall?: PersistedToolCall;
  /** 操作结果 */
  result?: PersistedResult;
  /** 记录数据（用于卡片展示） */
  record?: Record<string, unknown>;
  /** 修正相关数据 */
  correction?: {
    targetRecord?: Record<string, unknown>;
    changes?: Array<{ field: string; label: string; oldValue: unknown; newValue: unknown }>;
    reason?: string;
  };
  /** 追问相关数据 */
  followUp?: {
    question: string;
    missingFields: string[];
    originalFields: Record<string, unknown>;
  };
}

/** 推理链步骤 */
export interface Step {
  id: string;
  title: string;
  status: 'running' | 'success' | 'error';
  detail?: StepDetail;
  collapsed: boolean;
}

export interface CorrectionChange {
  field: string;
  label: string;
  oldValue: unknown;
  newValue: unknown;
}

/** 步骤详情 */
export interface StepDetail {
  action?: string;
  confidence?: number;
  fields?: Array<{
    label: string;
    value: string;
    source: 'extracted' | 'inferred' | 'default';
  }>;
  result?: {
    message?: string;
    id?: unknown;
  };
  correction?: {
    targetRecord: Record<string, unknown>;
    changes: CorrectionChange[];
    risk: 'low' | 'high';
    reason?: string;
  };
  ocr?: {
    status: 'success' | 'error';
    latency: number;
    recognizedText: string;
    imageWidth?: number;
    imageHeight?: number;
    error?: string;
  };
  error?: string;
}

/** UI 消息（展示用） */
export interface ChatMessage {
  id: number;
  role: 'user' | 'ai';
  content: string;
  imageSrc?: string;
  data?: Record<string, unknown>;
  render?: string;
  title?: string;
  loading?: boolean;
  status?: 'pending' | 'confirmed' | 'cancelled' | 'success';
  skill?: SkillMeta;
  steps?: Step[];
}

/** 技能元数据 */
export interface SkillMeta {
  name: string;
  displayName: string;
  confidence: number;
}

/** 对话状态 */
export interface ConversationState {
  waitingForConfirm: boolean;
  pendingRecord: Record<string, unknown> | null;
  pendingAction: string | null;
  awaitingFollowUp: boolean;
  pendingFollowUp: {
    question: string;
    missingFields: string[];
    originalFields: Record<string, unknown>;
  } | null;
  editingField: string | null;
  originalParse: Record<string, unknown> | null;
  recordSkill: SkillMeta | null;
}

/** 会话信息（从后端查询） */
export interface SessionInfo {
  session_id: string;
  message_count: number;
  started_at: string;
  last_message_at: string;
}
