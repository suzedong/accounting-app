<template>
  <div class="records-page">
    <div class="page-header">
      <h2>记账记录</h2>
      <div class="page-actions">
        <el-button @click="store.fetchRecords" :loading="store.loading">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
        <el-button type="primary" @click="showCreateDialog">新增记录</el-button>
      </div>
    </div>

    <!-- Filters -->
    <el-card class="filters" :body-style="{ padding: '12px 20px' }">
      <el-form :model="store.filters" inline style="margin: 0">
        <el-form-item label="类型">
          <el-select v-model="store.filters.type" placeholder="全部" clearable style="width: 120px" @change="onFilterChange">
            <el-option label="支出" value="支出" />
            <el-option label="收入" value="收入" />
          </el-select>
        </el-form-item>
        <el-form-item label="账户">
          <el-select v-model="store.filters.account" placeholder="全部" clearable style="width: 120px" @change="onFilterChange">
            <el-option label="个人" value="个人" />
            <el-option label="家庭" value="家庭" />
            <el-option label="公司" value="公司" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始"
            end-placeholder="结束"
            @change="onDateRangeChange"
          />
        </el-form-item>
        <el-form-item style="margin-bottom: 0">
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- Table -->
    <el-table :data="store.records" v-loading="store.loading" stripe size="small">
      <el-table-column prop="datetime" label="时间" width="170">
        <template #default="{ row }">
          <span 
            class="nowrap sync-status"
            :class="getSyncStatusClass(row)"
            :title="getSyncStatusTooltip(row)"
          >
            {{ formatDatetime(row.datetime) }}
            <span class="sync-indicator" :class="getSyncStatusClass(row)"></span>
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="type" label="类型" width="70">
        <template #default="{ row }">
          <el-tag :type="row.type === '收入' ? 'success' : 'danger'" size="small">
            {{ row.type }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="category" label="分类" width="100">
        <template #default="{ row }">
          <span class="nowrap">{{ row.category }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="amount" label="金额" width="100">
        <template #default="{ row }">
          <span :class="row.type === '收入' ? 'text-success' : 'text-danger'" class="nowrap">
            {{ formatMoney(row.amount) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="account" label="账户" width="80" />
      <el-table-column prop="payment_method" label="支付方式" min-width="120" />
      <el-table-column prop="note" label="备注" min-width="140" />
      <el-table-column label="操作" width="100" fixed="right" align="center">
        <template #default="{ row }">
          <span class="action-btns">
            <el-button link size="small" @click="showEditDialog(row)">编辑</el-button>
            <el-button link size="small" type="danger" @click="handleDelete(row.id)">删除</el-button>
          </span>
        </template>
      </el-table-column>
    </el-table>

    <!-- Pagination -->
    <el-pagination
      v-model:current-page="store.page"
      v-model:page-size="store.pageSize"
      :total="store.total"
      :page-sizes="[10, 20, 50]"
      layout="total, sizes, prev, pager, next"
      @current-change="store.fetchRecords"
      @size-change="store.fetchRecords"
      style="margin-top: 16px; justify-content: flex-end"
    />

    <!-- Create/Edit Dialog -->
    <el-dialog v-model="dialogVisible" :title="editMode ? '编辑记录' : '新增记录'" width="500px">
      <el-form :model="form" label-width="80px">
        <el-form-item label="时间">
          <el-date-picker v-model="form.datetime" type="datetime" placeholder="选择时间" />
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="form.type">
            <el-radio value="支出">支出</el-radio>
            <el-radio value="收入">收入</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="form.category" placeholder="如：餐饮、交通出行" />
        </el-form-item>
        <el-form-item label="金额">
          <el-input-number v-model="form.amount" :min="0" :precision="2" />
        </el-form-item>
        <el-form-item label="账户">
          <el-select v-model="form.account" style="width: 100%">
            <el-option label="个人" value="个人" />
            <el-option label="家庭" value="家庭" />
            <el-option label="公司" value="公司" />
          </el-select>
        </el-form-item>
        <el-form-item label="支付方式">
          <el-input v-model="form.payment_method" placeholder="如：微信支付、招商银行信用卡" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { ElMessageBox, ElMessage } from 'element-plus';
import { Refresh } from '@element-plus/icons-vue';
import { useRecordsStore } from '@/stores/records';
import { useChatStore } from '@/stores/chat';
import { formatMoney, formatDatetime } from '@/utils/formatters';
import type { RecordInput, AccountRecord } from '@/types';

const store = useRecordsStore();
const chat = useChatStore();
const dialogVisible = ref(false);
const editMode = ref(false);
const editingId = ref<number | null>(null);
const submitting = ref(false);
const dateRange = ref<[Date, Date] | null>(null);

const defaultForm: RecordInput = {
  datetime: new Date().toISOString().replace('T', ' ').substring(0, 19),
  type: '支出',
  amount: 0,
  account: '个人',
  category: '',
  payment_method: '',
  note: '',
};

const form = ref<RecordInput>({ ...defaultForm });

onMounted(() => {
  store.fetchRecords();
  
  // 监听 AI 对话确认记录的更新，自动刷新页面
  watch(() => chat.recordUpdated, () => {
    store.fetchRecords();
  });
});

function showCreateDialog() {
  editMode.value = false;
  editingId.value = null;
  form.value = { ...defaultForm };
  dialogVisible.value = true;
}

function showEditDialog(row: RecordInput & { id: number }) {
  editMode.value = true;
  editingId.value = row.id;
  form.value = {
    datetime: row.datetime,
    type: row.type,
    category: row.category || '',
    amount: row.amount,
    account: row.account,
    payment_method: row.payment_method || '',
    note: row.note || '',
  };
  dialogVisible.value = true;
}

async function handleSubmit() {
  if (form.value.amount <= 0) {
    ElMessage.warning('金额必须大于 0');
    return;
  }
  submitting.value = true;
  try {
    if (editMode.value && editingId.value !== null) {
      await store.updateRecord(editingId.value, form.value);
      ElMessage.success('更新成功');
    } else {
      await store.createRecord(form.value);
      ElMessage.success('创建成功');
    }
    dialogVisible.value = false;
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(id: number) {
  await ElMessageBox.confirm('确定要删除这条记录吗？', '确认删除', {
    type: 'warning',
  });
  await store.deleteRecord(id);
  ElMessage.success('删除成功');
}

function onFilterChange() {
  store.page = 1;
  store.fetchRecords();
}

function onDateRangeChange(val: [Date, Date] | null) {
  if (val) {
    store.filters.datetimeGte = `${val[0].getFullYear()}-${String(val[0].getMonth() + 1).padStart(2, '0')}-${String(val[0].getDate()).padStart(2, '0')} 00:00:00`;
    store.filters.datetimeLte = `${val[1].getFullYear()}-${String(val[1].getMonth() + 1).padStart(2, '0')}-${String(val[1].getDate()).padStart(2, '0')} 23:59:59`;
  } else {
    store.filters.datetimeGte = '';
    store.filters.datetimeLte = '';
  }
  store.page = 1;
  store.fetchRecords();
}

function resetFilters() {
  store.filters.type = '';
  store.filters.category = '';
  store.filters.account = '';
  store.filters.datetimeGte = '';
  store.filters.datetimeLte = '';
  store.filters.sort = 'datetime_desc';
  dateRange.value = null;
  store.page = 1;
  store.fetchRecords();
}

/**
 * 判断同步状态
 */
function getSyncStatus(row: AccountRecord): 'unsynced' | 'synced' | 'local_newer' | 'remote_newer' {
  // 未同步
  if (row.synced === 0) {
    return 'unsynced';
  }
  
  // 已同步，比较更新时间
  const localTime = row.local_updated_at;
  const remoteTime = row.nocobase_updated_at;
  
  if (!remoteTime) {
    return 'synced';
  }
  
  // 将时间字符串转换为 Date 对象进行比较
  // local_updated_at 格式: 'YYYY-MM-DD HH:MM:SS' (SQLite)
  // nocobase_updated_at 格式: 'YYYY-MM-DDTHH:MM:SS.sssZ' (ISO 8601)
  const localDate = parseTime(localTime);
  const remoteDate = parseTime(remoteTime);
  
  if (!localDate || !remoteDate) {
    return 'synced';
  }
  
  // 计算时间差（毫秒）
  const diff = remoteDate.getTime() - localDate.getTime();
  
  // 设置阈值：5分钟内视为一致（避免微小时间差异导致的误判）
  const threshold = 5 * 60 * 1000;
  
  if (diff > threshold) {
    return 'remote_newer';  // 云端明显较新
  } else if (diff < -threshold) {
    return 'local_newer';   // 本地明显较新
  } else {
    return 'synced';        // 时间接近，视为一致
  }
}

/**
 * 解析时间字符串为 Date 对象
 * 支持两种格式：
 * - SQLite 格式: 'YYYY-MM-DD HH:MM:SS'
 * - ISO 8601 格式: 'YYYY-MM-DDTHH:MM:SS.sssZ'
 */
function parseTime(timeStr: string): Date | null {
  if (!timeStr) return null;
  
  // 尝试 ISO 8601 格式（带 T 和 Z）
  if (timeStr.includes('T')) {
    return new Date(timeStr);
  }
  
  // SQLite 格式（空格分隔），需要替换为 T 并添加 Z（假设是 UTC）
  const isoStr = timeStr.replace(' ', 'T') + 'Z';
  return new Date(isoStr);
}

/**
 * 获取同步状态样式类
 */
function getSyncStatusClass(row: AccountRecord): string {
  const status = getSyncStatus(row);
  return `sync-${status}`;
}

/**
 * 获取同步状态提示文本
 */
function getSyncStatusTooltip(row: AccountRecord): string {
  const status = getSyncStatus(row);
  switch (status) {
    case 'unsynced':
      return '未同步';
    case 'synced':
      return '已同步（完全一致）';
    case 'local_newer':
      return '已同步（本地较新）';
    case 'remote_newer':
      return '已同步（云端较新）';
    default:
      return '';
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

.page-actions {
  display: flex;
  gap: 8px;
}

.filters {
  margin-bottom: 8px;
}

.filters :deep(.el-form-item) {
  margin-bottom: 0;
}

.text-success {
  color: #52c41a;
  font-weight: 500;
}

.text-danger {
  color: #ff4d4f;
  font-weight: 500;
}

.nowrap {
  white-space: nowrap;
}

.action-btns {
  white-space: nowrap;
  display: inline-flex;
  gap: 0;
}

/* 同步状态样式 */
.sync-status {
  position: relative;
  padding-right: 20px;
}

.sync-indicator {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

/* 未同步 - 红色 */
.sync-unsynced .sync-indicator {
  background-color: #ff4d4f;
}

.sync-unsynced {
  color: #ff4d4f;
}

/* 已同步（完全一致）- 绿色 */
.sync-synced .sync-indicator {
  background-color: #52c41a;
}

.sync-synced {
  color: #52c41a;
}

/* 本地较新 - 橙色 */
.sync-local_newer .sync-indicator {
  background-color: #fa8c16;
}

.sync-local_newer {
  color: #fa8c16;
}

/* 云端较新 - 蓝色 */
.sync-remote_newer .sync-indicator {
  background-color: #1890ff;
}

.sync-remote_newer {
  color: #1890ff;
}
</style>
