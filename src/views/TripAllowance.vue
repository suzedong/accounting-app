<template>
  <div class="trip-page">
    <div class="page-header">
      <h2>差旅补助</h2>
      <el-button type="primary" @click="showCreateDialog">新增出差</el-button>
    </div>

    <!-- Filter -->
    <el-card class="filters">
      <el-form inline>
        <el-form-item label="状态">
          <el-select v-model="filterStatus" placeholder="全部" clearable style="width: 120px" @change="fetchTrips">
            <el-option label="待发放" value="待发放" />
            <el-option label="已发放" value="已发放" />
            <el-option label="已过期" value="已过期" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- Summary -->
    <el-row :gutter="20" class="summary-row">
      <el-col :span="8">
        <el-card class="stat-card">
          <template #header>补助总额</template>
          <div class="value">{{ formatMoney(summary.totalAllowance) }}</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="stat-card">
          <template #header>已发总额</template>
          <div class="value">{{ formatMoney(summary.totalPaid) }}</div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="stat-card">
          <template #header>待发笔数</template>
          <div class="value">{{ summary.pendingCount }} 笔</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- Table -->
    <el-table :data="trips" v-loading="loading" stripe>
      <el-table-column prop="trip_id" label="申请单号" width="120" />
      <el-table-column prop="employee_name" label="姓名" width="80" />
      <el-table-column prop="start_date" label="开始日期" width="110" />
      <el-table-column prop="end_date" label="结束日期" width="110" />
      <el-table-column prop="days" label="天数" width="70" />
      <el-table-column prop="destination" label="目的地" width="120" />
      <el-table-column label="补助" width="100">
        <template #default="{ row }">
          <div>
            <span class="text-allowance">{{ formatMoney(row.trip_allowance) }}</span>
            <span class="text-transport">+{{ formatMoney(row.transport_allowance) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="total" label="合计" width="100">
        <template #default="{ row }">
          <span class="text-total">{{ formatMoney(row.total) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="statusTag(row.status)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="已发" width="100">
        <template #default="{ row }">
          <div v-if="row.paid_trip_allowance || row.paid_transport_allowance">
            {{ formatMoney(row.paid_trip_allowance + row.paid_transport_allowance) }}
          </div>
          <span v-else class="text-muted">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="notes" label="备注" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="showEditDialog(row)">标记发放</el-button>
          <el-button size="small" type="danger" @click="handleDelete(row.id)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && trips.length === 0" description="暂无差旅记录" />

    <!-- Create Dialog -->
    <el-dialog v-model="createVisible" title="新增出差" width="500px">
      <el-form :model="createForm" label-width="80px">
        <el-form-item label="申请单号">
          <el-input v-model="createForm.trip_id" placeholder="可选" />
        </el-form-item>
        <el-form-item label="姓名">
          <el-input v-model="createForm.employee_name" placeholder="出差人姓名" />
        </el-form-item>
        <el-form-item label="目的地">
          <el-input v-model="createForm.destination" placeholder="出差地点" />
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker
            v-model="createDateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            @change="onCreateDatesChange"
          />
        </el-form-item>
        <el-form-item label="天数">
          <el-input-number v-model="createForm.days" :min="1" @change="calcAllowance" />
        </el-form-item>
        <el-form-item label="出差原因">
          <el-input v-model="createForm.reason" type="textarea" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="createForm.notes" type="textarea" />
        </el-form-item>
      </el-form>
      <div v-if="createForm.days" class="allowance-preview">
        补助：{{ formatMoney(createForm.days * 100) }}（100元/天）
        + 交通：{{ formatMoney(createForm.days * 30) }}（30元/天）
        = <strong>{{ formatMoney(createForm.days * 130) }}</strong>
      </div>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="handleCreate" :loading="submitting">保存</el-button>
      </template>
    </el-dialog>

    <!-- Edit Dialog (mark as paid) -->
    <el-dialog v-model="editVisible" title="标记发放" width="500px">
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="当前状态">
          <el-tag :type="statusTag(editingTrip?.status || '')">{{ editingTrip?.status }}</el-tag>
        </el-form-item>
        <el-form-item label="补助总额">
          {{ formatMoney((editingTrip?.trip_allowance || 0) + (editingTrip?.transport_allowance || 0)) }}
        </el-form-item>
        <el-form-item label="发放状态">
          <el-select v-model="editForm.status" style="width: 100%">
            <el-option label="待发放" value="待发放" />
            <el-option label="已发放" value="已发放" />
            <el-option label="已过期" value="已过期" />
          </el-select>
        </el-form-item>
        <el-form-item label="已发补助">
          <el-input-number v-model="editForm.paid_trip_allowance" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="已发交通">
          <el-input-number v-model="editForm.paid_transport_allowance" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="发放日期">
          <el-date-picker v-model="editForm.paid_date" type="date" placeholder="选择日期" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="handleEdit" :loading="submitting">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { getTrips, createTrip, updateTrip, deleteTrip } from '@/api/tauri';
import { formatMoney } from '@/utils/formatters';
import type { TripRecord, TripStatus } from '@/types';

const trips = ref<TripRecord[]>([]);
const loading = ref(false);
const filterStatus = ref('');
const submitting = ref(false);

const summary = computed(() => {
  const all = trips.value;
  return {
    totalAllowance: all.reduce((s, t) => s + t.total, 0),
    totalPaid: all.reduce((s, t) => s + t.paid_trip_allowance + t.paid_transport_allowance, 0),
    pendingCount: all.filter(t => t.status === '待发放').length,
  };
});

// Create
const createVisible = ref(false);
const createDateRange = ref<[Date, Date] | null>(null);
const createForm = ref({
  trip_id: '',
  employee_name: '',
  destination: '',
  start_date: '',
  end_date: '',
  days: 1,
  reason: '',
  notes: '',
});

// Edit
const editVisible = ref(false);
const editingTrip = ref<TripRecord | null>(null);
const editForm = ref({
  status: '待发放',
  paid_trip_allowance: 0,
  paid_transport_allowance: 0,
  paid_date: '',
});

onMounted(() => {
  fetchTrips();
});

async function fetchTrips() {
  loading.value = true;
  try {
    const status = filterStatus.value || undefined;
    const res = await getTrips(status);
    trips.value = res.data;
  } catch (e) {
    console.error('Failed to load trips', e);
  } finally {
    loading.value = false;
  }
}

function showCreateDialog() {
  createForm.value = {
    trip_id: '', employee_name: '', destination: '',
    start_date: '', end_date: '', days: 1, reason: '', notes: '',
  };
  createDateRange.value = null;
  createVisible.value = true;
}

function onCreateDatesChange(val: [Date, Date] | null) {
  if (val) {
    createForm.value.start_date = `${val[0].getFullYear()}-${String(val[0].getMonth() + 1).padStart(2, '0')}-${String(val[0].getDate()).padStart(2, '0')}`;
    createForm.value.end_date = `${val[1].getFullYear()}-${String(val[1].getMonth() + 1).padStart(2, '0')}-${String(val[1].getDate()).padStart(2, '0')}`;
    const diff = Math.ceil((val[1].getTime() - val[0].getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (diff > 0) {
      createForm.value.days = diff;
    }
  }
}

function calcAllowance() {
  // allowance preview auto-updates via template
}

async function handleCreate() {
  submitting.value = true;
  try {
    await createTrip({
      trip_id: createForm.value.trip_id || null,
      start_date: createForm.value.start_date || null,
      end_date: createForm.value.end_date || null,
      days: createForm.value.days,
      destination: createForm.value.destination || null,
      employee_name: createForm.value.employee_name || null,
      reason: createForm.value.reason || null,
      notes: createForm.value.notes || null,
    });
    ElMessage.success('创建成功');
    createVisible.value = false;
    await fetchTrips();
  } finally {
    submitting.value = false;
  }
}

function showEditDialog(row: TripRecord) {
  editingTrip.value = row;
  editForm.value = {
    status: row.status,
    paid_trip_allowance: row.paid_trip_allowance || 0,
    paid_transport_allowance: row.paid_transport_allowance || 0,
    paid_date: row.paid_date || '',
  };
  editVisible.value = true;
}

async function handleEdit() {
  if (!editingTrip.value) return;
  submitting.value = true;
  try {
    await updateTrip(editingTrip.value.id, {
      status: editForm.value.status as TripStatus,
      paid_trip_allowance: editForm.value.paid_trip_allowance,
      paid_transport_allowance: editForm.value.paid_transport_allowance,
      paid_date: editForm.value.paid_date || null,
    });
    ElMessage.success('更新成功');
    editVisible.value = false;
    await fetchTrips();
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(id: number) {
  await ElMessageBox.confirm('确定要删除这条差旅记录吗？', '确认删除', { type: 'warning' });
  await deleteTrip(id);
  ElMessage.success('删除成功');
  await fetchTrips();
}

function statusTag(status: string): 'info' | 'success' | 'warning' {
  switch (status) {
    case '待发放': return 'warning';
    case '已发放': return 'success';
    case '已过期': return 'info';
    default: return 'info';
  }
}
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.page-header h2 {
  font-size: 1.5em;
  color: #333;
}

.filters {
  margin-bottom: 16px;
}

.summary-row {
  margin-bottom: 20px;
}

.stat-card .value {
  font-size: 1.8em;
  font-weight: bold;
  color: #333;
}

.text-allowance {
  color: #1890ff;
  font-size: 0.85em;
}

.text-transport {
  color: #52c41a;
  font-size: 0.85em;
  margin-left: 4px;
}

.text-total {
  font-weight: 600;
  color: #333;
}

.text-muted {
  color: #ccc;
}

.allowance-preview {
  padding: 12px;
  background: #f0f9ff;
  border-radius: 6px;
  text-align: center;
  margin-bottom: 12px;
  color: #1890ff;
}
</style>
