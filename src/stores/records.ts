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
        page_size: pageSize.value,
        sort: filters.value.sort || 'datetime_desc',
      };
      if (filters.value.type) params.filter_type = filters.value.type;
      if (filters.value.category) params.filter_category = filters.value.category;
      if (filters.value.account) params.filter_account = filters.value.account;
      if (filters.value.datetimeGte) params.datetime_gte = filters.value.datetimeGte;
      if (filters.value.datetimeLte) params.datetime_lte = filters.value.datetimeLte;

      const result = await api.getRecords(params);
      records.value = result.data;
      total.value = result.meta?.count ?? 0;
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
