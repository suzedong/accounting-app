import { inferCategory } from '@/utils/keywords';
import type { RecordInput } from '@/types';

/**
 * 规则解析 composable
 * 从自然语言输入提取记账信息（作为 LLM 失败时的降级方案）
 */
export interface ParsedRecord {
  amount?: number;
  type?: '收入' | '支出';
  category?: string;
  note?: string;
  account?: string;
}

export function useParse() {
  /**
   * 从文本中解析金额（支持多种格式）
   */
  function parseAmount(text: string): number | null {
    // Match patterns like: 100, 100.5, ￥100, ¥100, 100元, 100块
    const patterns = [
      /[￥¥]?\s*(\d+\.?\d*)\s*(?:元|块|元整)?/i,
      /(\d+\.?\d*)\s*元/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const amount = parseFloat(match[1]);
        if (!isNaN(amount) && amount > 0) {
          return amount;
        }
      }
    }

    return null;
  }

  /**
   * 判断收入/支出
   */
  function parseType(text: string): '收入' | '支出' {
    const incomeKeywords = ['收入', '赚', '收', '工资', '奖金', '报销', '利息', '收益', '分红', '到账'];
    for (const kw of incomeKeywords) {
      if (text.includes(kw)) return '收入';
    }
    return '支出'; // Default to expense
  }

  /**
   * 提取备注（去除金额和类型关键词后的剩余文本）
   */
  function parseNote(text: string): string {
    // Remove amount patterns
    let note = text
      .replace(/[￥¥]\s*\d+\.?\d*/g, '')
      .replace(/\d+\.?\d*\s*元/g, '')
      .replace(/\d+\.?\d*\s*块/g, '');

    // Remove common type keywords
    const typeKeywords = ['收入', '支出', '花了', '花了', '买', '付了', '支付', '消费', '收到'];
    for (const kw of typeKeywords) {
      note = note.replace(kw, '');
    }

    return note.trim();
  }

  /**
   * 完整解析
   */
  function parse(text: string): ParsedRecord {
    const amount = parseAmount(text);
    const type = parseType(text);
    const category = inferCategory(text);
    const note = parseNote(text);

    return { amount: amount ?? undefined, type, category, note };
  }

  /**
   * 构建 RecordInput
   */
  function toRecordInput(text: string): RecordInput | null {
    const parsed = parse(text);
    if (!parsed.amount) return null;

    return {
      datetime: new Date().toISOString().replace('T', ' ').substring(0, 19),
      type: parsed.type || '支出',
      category: parsed.category || '其他',
      amount: parsed.amount,
      account: '个人',
      note: parsed.note || '',
    };
  }

  return {
    parseAmount, parseType, parseNote, parse, toRecordInput,
  };
}
