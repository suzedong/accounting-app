/**
 * Invoke 拦截器 — 自动记录所有 Tauri IPC 调用
 *
 * 替代直接使用 invoke()，调用方式不变但自动记录日志到 DevConsole。
 */

import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export interface IpcLogEntry {
  id: number;
  /** 请求 ID，用于关联 LLM/Rust 日志 */
  requestId: string;
  timestamp: string;
  command: string;
  params: Record<string, unknown>;
  result: unknown;
  error?: string;
  latency: number;
  success: boolean;
}

let nextId = 1;
let nextRequestId = 1;
const entries: IpcLogEntry[] = [];
const MAX_ENTRIES = 200;

/** 生成唯一的请求 ID，用于关联 IPC ↔ LLM ↔ Rust 日志 */
function generateRequestId(): string {
  return `req-${Date.now().toString(36)}-${nextRequestId++}`;
}

// Listeners for new entries
const listeners = new Set<(entry: IpcLogEntry) => void>();

export function addIpcListener(fn: (entry: IpcLogEntry) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getIpcLogs(): IpcLogEntry[] {
  return [...entries];
}

export function clearIpcLogs() {
  entries.length = 0;
  nextId = 1;
  nextRequestId = 1;
}

/** 获取当前的请求 ID（可关联到 IPC 日志） */
let currentRequestId = '';
export function getCurrentRequestId(): string {
  return currentRequestId;
}
export function setCurrentRequestId(id: string): void {
  currentRequestId = id;
}

/**
 * 封装的 invoke — 记录每次调用的命令名、参数、耗时、结果/错误
 */
export async function invoke<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const id = nextId++;
  const requestId = generateRequestId();
  const timestamp = new Date().toLocaleTimeString();
  const startTime = Date.now();

  try {
    const result = await tauriInvoke<T>(command, args || {});
    const latency = Date.now() - startTime;

    const entry: IpcLogEntry = {
      id,
      requestId,
      timestamp,
      command,
      params: args || {},
      result,
      latency,
      success: true,
    };

    pushEntry(entry);
    return result;
  } catch (e) {
    const latency = Date.now() - startTime;
    const errorMsg = e instanceof Error ? e.message : String(e);

    const entry: IpcLogEntry = {
      id,
      requestId,
      timestamp,
      command,
      params: args || {},
      result: null,
      error: errorMsg,
      latency,
      success: false,
    };

    pushEntry(entry);
    throw e;
  }
}

function pushEntry(entry: IpcLogEntry) {
  entries.push(entry);
  // Trim old entries
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  // Notify listeners
  for (const fn of listeners) {
    try { fn(entry); } catch { /* ignore */ }
  }
}
