import { invoke } from '@tauri-apps/api/core';
import type { Record, RecordInput, TripRecord, ApiResponse } from '@/types';

// Records
export async function getRecords(params: {
  page?: number;
  page_size?: number;
  filter_type?: string;
  filter_category?: string;
  filter_account?: string;
  datetime_gte?: string;
  datetime_lte?: string;
  sort?: string;
}): Promise<ApiResponse<Record[]>> {
  return invoke('get_records', params);
}

export async function getRecord(id: number): Promise<Record> {
  const res = await invoke<{ data: Record }>('get_record', { id });
  return res.data;
}

export async function createRecord(fields: RecordInput): Promise<Record> {
  const res = await invoke<{ data: Record }>('create_record', { fields });
  return res.data;
}

export async function updateRecord(id: number, fields: Partial<RecordInput>): Promise<Record> {
  const res = await invoke<{ data: Record }>('update_record', { id, fields });
  return res.data;
}

export async function deleteRecord(id: number): Promise<void> {
  return invoke('delete_record', { id });
}

// Trips
export async function getTrips(status?: string): Promise<ApiResponse<TripRecord[]>> {
  return invoke('get_business_trips', { status: status || null });
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
export async function getStatsSummary(datetimeGte: string, datetimeLte?: string) {
  return invoke('get_stats_summary', { datetime_gte: datetimeGte, datetime_lte: datetimeLte || null });
}

export async function getStatsByCategory(datetimeGte: string, type: string, datetimeLte?: string) {
  return invoke('get_stats_by_category', { datetime_gte: datetimeGte, type, datetime_lte: datetimeLte || null });
}

export async function getStatsByAccount(datetimeGte: string, datetimeLte?: string) {
  return invoke('get_stats_by_account', { datetime_gte: datetimeGte, datetime_lte: datetimeLte || null });
}

export async function getMonthlyTrend(months?: number) {
  return invoke('get_monthly_trend', { months: months || null });
}

export async function getComparison() {
  return invoke('get_comparison');
}

export async function getBudgetAnalysis(period: string, budgetMonthly: number) {
  return invoke('get_budget_analysis', { period, budget_monthly: budgetMonthly });
}

// Config
export async function getConfig(key: string): Promise<string> {
  return invoke('get_config', { key });
}

export async function setConfig(key: string, value: string): Promise<void> {
  return invoke('set_config', { key, value });
}

export async function getAllConfig() {
  return invoke('get_all_config');
}

// OCR
export async function ocrRecognize(imageBase64: string): Promise<string> {
  return invoke('ocr_recognize', { image_base64: imageBase64 });
}
