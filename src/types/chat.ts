// ============================================================
// Chat 相关类型定义
// ============================================================

/** LLM 消息（传给 API 的标准格式） */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | null;
  tool_call_id?: string;
}

/** 推理链步骤 */
export interface Step {
  id: string;
  title: string;
  status: 'running' | 'success' | 'error';
  detail?: StepDetail;
  collapsed: boolean;
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
