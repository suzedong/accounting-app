import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { AccountRecord, RecordInput } from '@/types';
import * as api from '@/api/tauri';

export const useRecordsStore = defineStore('records', () => {
  const records = ref<AccountRecord[]>([]);
  const total = ref(0);
  const page = ref(1);
  const pageSize = ref(20);
  const loading = ref(false);

  const filters = ref({
    type: '',
    category: '',
    account: '',
    datetimeGte: '',
    datetimeLte: '',
    sort: 'datetime_desc',
  });

  const totalPages = computed(() => Math.ceil(total.value / pageSize.value));

  async function fetchRecords() {
    loading.value = true;
    try {
      const params: Record<string, unknown> = {
        page: page.value,
        pageSize: pageSize.value,
        sort: filters.value.sort || 'datetime_desc',
      };
      if (filters.value.type) params.filterType = filters.value.type;
      if (filters.value.category) params.filterCategory = filters.value.category;
      if (filters.value.account) params.filterAccount = filters.value.account;
      if (filters.value.datetimeGte) params.datetimeGte = filters.value.datetimeGte;
      if (filters.value.datetimeLte) params.datetimeLte = filters.value.datetimeLte;

      console.log('[Records] fetchRecords params:', JSON.stringify(params));
      const result = await api.getRecords(params);
      console.log('[Records] 返回数据:', result.meta?.count, '条');
      records.value = result.data;
      total.value = result.meta?.count ?? 0;
    } catch (e) {
      console.error('[Records] fetchRecords 失败:', e);
    } finally {
      loading.value = false;
    }
  }

  async function createRecord(fields: RecordInput) {
    const record = await api.createRecord(fields);
    await fetchRecords();
    return record;
  }

  async function updateRecord(id: number, fields: Partial<RecordInput>) {
    await api.updateRecord(id, fields);
    await fetchRecords();
  }

  async function deleteRecord(id: number) {
    await api.deleteRecord(id);
    await fetchRecords();
  }

  return {
    records, total, page, pageSize, loading, filters, totalPages,
    fetchRecords, createRecord, updateRecord, deleteRecord,
  };
});
