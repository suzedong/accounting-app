import { invoke } from '@tauri-apps/api/core';
import type { AccountRecord, RecordInput, TripRecord, ApiResponse, StatsSummary, CategoryStat, AccountStat, MonthTrend, ComparisonResult, BudgetAnalysis, AppConfig, AiService } from '@/types';

// Records
export async function getRecords(params: {
  page?: number;
  pageSize?: number;
  filterType?: string;
  filterCategory?: string;
  filterAccount?: string;
  datetimeGte?: string;
  datetimeLte?: string;
  sort?: string;
}): Promise<ApiResponse<AccountRecord[]>> {
  return invoke('get_records', params);
}

export async function getRecord(id: number): Promise<AccountRecord> {
  const res = await invoke<{ data: AccountRecord }>('get_record', { id });
  return res.data;
}

export async function createRecord(fields: RecordInput): Promise<AccountRecord> {
  const res = await invoke<{ data: AccountRecord }>('create_record', { fields });
  return res.data;
}

export async function updateRecord(id: number, fields: Partial<RecordInput>): Promise<AccountRecord> {
  const res = await invoke<{ data: AccountRecord }>('update_record', { id, fields });
  return res.data;
}

export async function deleteRecord(id: number): Promise<void> {
  return invoke('delete_record', { id });
}

// Categories & Payment Methods
export async function getCategories(type?: string): Promise<string[]> {
  return invoke('get_categories', { ...(type ? { type } : {}) });
}

export async function getPaymentMethods(): Promise<string[]> {
  return invoke('get_payment_methods');
}

// Trips
export async function getTrips(status?: string): Promise<ApiResponse<TripRecord[]>> {
  return invoke('get_business_trips', { ...(status ? { status } : {}) });
}

export async function createTrip(fields: Partial<TripRecord>): Promise<TripRecord> {
  const res = await invoke<{ data: TripRecord }>('create_business_trip', { fields });
  return res.data;
}

export async function updateTrip(id: number, fields: Partial<TripRecord>): Promise<TripRecord> {
  const res = await invoke<{ data: TripRecord }>('update_business_trip', { id, fields });
  return res.data;
}

export async function deleteTrip(id: number): Promise<void> {
  return invoke('delete_business_trip', { id });
}

// Stats
export async function getStatsSummary(datetimeGte: string, datetimeLte?: string): Promise<StatsSummary> {
  return invoke('get_stats_summary', {
    datetimeGte,
    ...(datetimeLte ? { datetimeLte } : {}),
  });
}

export async function getStatsByCategory(datetimeGte: string, type: string, datetimeLte?: string): Promise<CategoryStat[]> {
  return invoke('get_stats_by_category', {
    datetimeGte,
    type,
    ...(datetimeLte ? { datetimeLte } : {}),
  });
}

export async function getStatsByAccount(datetimeGte: string, datetimeLte?: string): Promise<AccountStat[]> {
  return invoke('get_stats_by_account', {
    datetimeGte,
    ...(datetimeLte ? { datetimeLte } : {}),
  });
}

export async function getMonthlyTrend(months?: number): Promise<MonthTrend[]> {
  return invoke('get_monthly_trend', { months: months || undefined });
}

export async function getComparison(): Promise<ComparisonResult> {
  return invoke('get_comparison');
}

export async function getBudgetAnalysis(period: string, budgetMonthly: number): Promise<BudgetAnalysis> {
  return invoke('get_budget_analysis', { period, budgetMonthly });
}

// Config
export async function getConfig(key: string): Promise<string> {
  return invoke('get_config', { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
  return invoke('set_config', { key, value });
}

export async function getAllConfig(): Promise<AppConfig> {
  return invoke('get_all_config');
}

// Prompts (includes preferences as a prompt document)
export async function getSystemPrompt(name: string): Promise<{ data: { name: string; content: string } }> {
  return invoke('get_system_prompt', { name });
}

export async function updateSystemPrompt(name: string, content: string): Promise<void> {
  return invoke('update_system_prompt', { name, content });
}

// Preferences: update a single key within preferences.md document
export async function updatePreference(key: string, value: string): Promise<void> {
  return invoke('update_preference', { key, value });
}

// Learning
export async function getLearningCorrections(): Promise<{ data: Array<{ id: number; keyword: string; field: string; value: string }> }> {
  return invoke('get_learning_corrections');
}

export async function saveCorrection(keyword: string, field: string, value: string): Promise<void> {
  return invoke('save_correction', { keyword, field, value });
}

export async function deleteCorrection(id: number): Promise<void> {
  return invoke('delete_correction', { id });
}

export async function clearCorrections(): Promise<void> {
  return invoke('clear_corrections');
}

// Chat History
export async function getChatHistory(limit?: number): Promise<{ data: Array<{ id: number; uuid: string; role: string; content: string | null; data: string | null; skill: string | null; confidence: number | null; created_at: string }> }> {
  return invoke('get_chat_history', { limit: limit || 50 });
}

export async function saveChatMessage(role: string, content: string | null, data: string | null, skill: string | null, confidence: number | null): Promise<void> {
  return invoke('save_chat_message', { message: { role, content, data, skill, confidence } });
}

export async function clearChatHistory(): Promise<void> {
  return invoke('clear_chat_history');
}

// LLM (via Rust backend, avoids CORS)
export async function callLLM(systemMessage: string, userMessage: string): Promise<string> {
  try {
    const result = await invoke('call_llm', { systemMessage, userMessage });
    return result as string;
  } catch (e) {
    console.error('[callLLM invoke] error:', e);
    throw e;
  }
}

/** LLM Function Calling — 带 tools 参数，返回 { content, toolCalls } */
export async function callLLMWithTools(
  systemMessage: string,
  userMessage: string,
  tools: string, // JSON string of tool definitions
): Promise<{ content: string; toolCalls: Array<{ id: string; type?: string; function: { name: string; arguments: string } }> | null }> {
  try {
    const result = await invoke('call_llm_with_tools', {
      systemMessage,
      userMessage,
      toolsJson: tools,
      includeToolCalls: true,
    });
    const parsed = typeof result === 'string' ? JSON.parse(result) : result;
    return {
      content: parsed.content || '',
      toolCalls: parsed.tool_calls || null,
    };
  } catch (e) {
    console.error('[callLLMWithTools invoke] error:', e);
    throw e;
  }
}

// AI Services Management
export async function getAiServices(): Promise<AiService[]> {
  return invoke('get_ai_services');
}

export async function saveAiServices(services: AiService[]): Promise<void> {
  return invoke('save_ai_services', { services });
}

export async function activateAiService(id: string): Promise<void> {
  return invoke('activate_ai_service', { id });
}

// Config test
export async function testAiConnection(): Promise<{ success: boolean; message: string }> {
  return invoke('test_ai_connection');
}

// OCR
export async function checkOcrStatus(): Promise<{ available: boolean }> {
  return invoke('check_ocr_status');
}

export interface OcrModel {
  id: string;
  name: string;
  size_mb: number;
  sha256: string;
  file_name: string;
  download_urls: string[];
  downloaded: boolean;
}

export async function getOcrModels(): Promise<OcrModel[]> {
  return invoke('get_ocr_models');
}

export async function downloadOcrModel(modelId: string): Promise<string> {
  return invoke('download_ocr_model', { modelId });
}

export async function deleteOcrModel(modelId: string): Promise<string> {
  return invoke('delete_ocr_model', { modelId });
}

export async function ocrRecognize(imageBase64: string): Promise<string> {
  return invoke('ocr_recognize', { imageBase64 });
}

