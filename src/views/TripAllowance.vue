<template>
  <div class="trip-page">
    <div class="page-header">
      <h2>差旅补助</h2>
      <div class="page-actions">
        <el-button @click="fetchTrips" :loading="loading">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
        <el-button type="primary" @click="showCreateDialog">新增出差</el-button>
      </div>
    </div>

    <!-- Filter -->
    <el-card class="filters" :body-style="{ padding: '12px 20px' }">
      <el-form inline>
        <el-form-item label="状态">
          <el-select v-model="filterStatus" placeholder="全部" clearable style="width: 120px" @change="fetchTrips">
            <el-option label="待发放" value="⏳ 待发放" />
            <el-option label="已发放" value="✅ 已发放" />
            <el-option label="已过期" value="❌ 已过期" />
          </el-select>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- Summary -->
    <el-row :gutter="20" class="summary-row">
      <el-col :span="6">
        <el-card class="stat-card">
          <template #header>补助总额</template>
          <div class="value">{{ formatIntMoney(summary.totalAllowance) }}</div>
          <div class="value-sub">{{ summary.totalCount }} 笔</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <template #header>已发总额</template>
          <div class="value">{{ formatIntMoney(summary.totalPaid) }}</div>
          <div class="value-sub">{{ summary.paidCount }} 笔</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <template #header>待发</template>
          <div class="value">{{ formatIntMoney(summary.pendingAmount) }}</div>
          <div class="value-sub">{{ summary.pendingCount }} 笔</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card class="stat-card">
          <template #header>已过期</template>
          <div class="value">{{ formatIntMoney(summary.expiredAmount) }}</div>
          <div class="value-sub">{{ summary.expiredCount }} 笔</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- Table -->
    <el-table :data="trips" v-loading="loading" stripe size="small">
      <el-table-column prop="trip_id" label="申请单号" width="130" />
      <el-table-column prop="start_date" label="开始日期" width="90" />
      <el-table-column prop="end_date" label="结束日期" width="90" />
      <el-table-column prop="days" label="天数" width="40" />
      <el-table-column label="补助" width="80">
        <template #default="{ row }">
          <div class="nowrap">
            <span class="text-allowance">{{ formatIntMoney(row.trip_allowance) }}</span>
            <span class="text-transport">+{{ formatIntMoney(row.transport_allowance) }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="total" label="合计" width="60">
        <template #default="{ row }">
          <span class="text-total nowrap">{{ formatIntMoney(row.total) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="statusTag(row.status)" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="已发" width="60">
        <template #default="{ row }">
          <span class="nowrap">
            <template v-if="row.paid_trip_allowance || row.paid_transport_allowance">
              {{ formatIntMoney(row.paid_trip_allowance + row.paid_transport_allowance) }}
            </template>
            <template v-else-if="row.status === '✅ 已发放'">
              {{ formatIntMoney(row.total) }}
            </template>
            <span v-else class="text-muted">—</span>
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="paid_date" label="发放日期" width="150">
        <template #default="{ row }">
          <span class="nowrap">
            <template v-if="row.paid_date">{{ row.paid_date }}</template>
            <span v-else class="text-muted">—</span>
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="notes" label="备注" />
      <el-table-column label="操作" width="100" fixed="right" align="center">
        <template #default="{ row }">
          <span class="action-btns">
            <el-button link size="small" @click="showEditDialog(row)">标记</el-button>
            <el-button link size="small" type="danger" @click="handleDelete(row.id)">删除</el-button>
          </span>
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
        <el-form-item label="备注">
          <el-input v-model="createForm.notes" type="textarea" />
        </el-form-item>
      </el-form>
      <div v-if="createForm.days" class="allowance-preview">
        补助：{{ formatIntMoney(createForm.days * 100) }}（100元/天）
        + 交通：{{ formatIntMoney(createForm.days * 30) }}（30元/天）
        = <strong>{{ formatIntMoney(createForm.days * 130) }}</strong>
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
          {{ formatIntMoney((editingTrip?.trip_allowance || 0) + (editingTrip?.transport_allowance || 0)) }}
        </el-form-item>
        <el-form-item label="发放状态">
          <el-select v-model="editForm.status" style="width: 100%">
            <el-option label="待发放" value="⏳ 待发放" />
            <el-option label="已发放" value="✅ 已发放" />
            <el-option label="已过期" value="❌ 已过期" />
          </el-select>
        </el-form-item>
        <el-form-item label="已发补助">
          <el-input-number v-model="editForm.paid_trip_allowance" :min="0" :precision="0" />
        </el-form-item>
        <el-form-item label="已发交通">
          <el-input-number v-model="editForm.paid_transport_allowance" :min="0" :precision="0" />
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
import { ref, onMounted, computed, watch } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import { getTrips, createTrip, updateTrip, deleteTrip } from '@/api/tauri';
import { formatIntMoney } from '@/utils/formatters';
import { useChatStore } from '@/stores/chat';
import type { TripRecord, TripStatus } from '@/types';

const chat = useChatStore();

const trips = ref<TripRecord[]>([]);
const loading = ref(false);
const filterStatus = ref('');
const submitting = ref(false);

const summary = computed(() => {
  const all = trips.value;
  const paidTrips = all.filter(t => t.status.includes('已发放'));
  const pendingTrips = all.filter(t => t.status.includes('待发放'));
  const expiredTrips = all.filter(t => t.status.includes('已过期'));
  return {
    totalAllowance: all.reduce((s, t) => s + t.total, 0),
    totalCount: all.length,
    totalPaid: paidTrips.reduce((s, t) => s + t.total, 0),
    paidCount: paidTrips.length,
    pendingAmount: pendingTrips.reduce((s, t) => s + t.total, 0),
    pendingCount: pendingTrips.length,
    expiredAmount: expiredTrips.reduce((s, t) => s + t.total, 0),
    expiredCount: expiredTrips.length,
  };
});

// Create
const createVisible = ref(false);
const createDateRange = ref<[Date, Date] | null>(null);
const createForm = ref({
  trip_id: '',
  start_date: '',
  end_date: '',
  days: 1,
  notes: '',
});

// Edit
const editVisible = ref(false);
const editingTrip = ref<TripRecord | null>(null);
const editForm = ref({
  status: '⏳ 待发放',
  paid_trip_allowance: 0,
  paid_transport_allowance: 0,
  paid_date: '',
});

onMounted(() => {
  fetchTrips();

  // 监听 AI 对话发放/创建/修改差旅补助的更新，自动刷新页面
  watch(() => chat.recordUpdated, () => {
    fetchTrips();
  });
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
    trip_id: '',
    start_date: '',
    end_date: '',
    days: 1,
    notes: '',
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
  if (status.includes('待发放')) return 'warning';
  if (status.includes('已发放')) return 'success';
  if (status.includes('已过期')) return 'info';
  return 'info';
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

.page-actions {
  display: flex;
  gap: 8px;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.filters {
  margin-bottom: 16px;
}

.filters :deep(.el-form-item) {
  margin-bottom: 0;
}

.summary-row {
  margin-bottom: 20px;
}

.stat-card .value {
  font-size: 1.8em;
  font-weight: bold;
  color: #333;
}

.stat-card .value-sub {
  font-size: 0.85em;
  color: #999;
  margin-top: 4px;
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

.nowrap {
  white-space: nowrap;
}

.allowance-preview {
  padding: 12px;
  background: #f0f9ff;
  border-radius: 6px;
  text-align: center;
  margin-bottom: 12px;
  color: #1890ff;
}

.action-btns {
  white-space: nowrap;
  display: inline-flex;
  gap: 0;
}
</style>
