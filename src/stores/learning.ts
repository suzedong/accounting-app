import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { getLearningCorrections, saveCorrection } from '@/api/tauri';

export const useLearningStore = defineStore('learning', () => {
  const corrections = ref<Array<{ keyword: string; field: string; value: string }>>([]);
  const loading = ref(false);

  // Group corrections by field for prompt injection
  const correctionsByField = computed(() => {
    const grouped: Record<string, Array<{ keyword: string; value: string }>> = {};
    for (const c of corrections.value) {
      if (!grouped[c.field]) grouped[c.field] = [];
      grouped[c.field].push({ keyword: c.keyword, value: c.value });
    }
    return grouped;
  });

  // Build prompt injection text from corrections
  const promptInjection = computed(() => {
    const groups = correctionsByField.value;
    if (Object.keys(groups).length === 0) return '';

    let text = '\n## 学习数据（用户修正历史）\n';
    for (const [field, entries] of Object.entries(groups)) {
      text += `\n### ${field}\n`;
      const freq: Record<string, number> = {};
      for (const e of entries) {
        const key = `${e.keyword}→${e.value}`;
        freq[key] = (freq[key] || 0) + 1;
      }
      const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
      for (const [k, count] of sorted) {
        text += `- ${k} (使用 ${count} 次)\n`;
      }
    }
    return text;
  });

  async function loadCorrections() {
    loading.value = true;
    try {
      const res = await getLearningCorrections();
      corrections.value = res.data;
    } finally {
      loading.value = false;
    }
  }

  async function addCorrection(keyword: string, field: string, value: string) {
    await saveCorrection(keyword, field, value);
    // Add to local state immediately
    corrections.value.push({ keyword, field, value });
  }

  // Auto-learn: when user corrects a record, extract the correction
  function learnFromCorrection(original: Record<string, unknown>, corrected: Record<string, unknown>) {
    const changes: Array<{ field: string; keyword: string; value: string }> = [];

    for (const [key, value] of Object.entries(corrected)) {
      if (original[key] !== value && value !== undefined && value !== null) {
        const origValue = original[key];
        if (origValue !== undefined && origValue !== null) {
          // Extract keyword from the original value
          const keyword = typeof origValue === 'string' ? origValue.toLowerCase() : String(origValue).toLowerCase();
          changes.push({ field: key, keyword, value: String(value) });
        }
      }
    }

    return changes;
  }

  // Get the most likely value for a field given a keyword
  function getCorrectionForField(field: string, keyword: string): string | undefined {
    const entries = correctionsByField.value[field];
    if (!entries) return undefined;

    const match = entries.find(e =>
      e.keyword.toLowerCase().includes(keyword.toLowerCase()) ||
      keyword.toLowerCase().includes(e.keyword.toLowerCase())
    );
    return match?.value;
  }

  return {
    corrections, loading, correctionsByField, promptInjection,
    loadCorrections, addCorrection, learnFromCorrection, getCorrectionForField,
  };
});
