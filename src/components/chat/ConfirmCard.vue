<template>
  <div class="confirm-card" :class="{ editing: isEditing }">
    <div v-if="!readonly" class="card-header">
      {{ title || '请确认（尚未保存）' }}
    </div>
    <div class="card-body">
      <!-- Trip payment fields (差旅补助发放确认) -->
      <template v-if="isTripPayment">
        <div v-if="fields.label" class="card-field">
          <span class="label">发放类型</span>
          <el-tag type="success" size="small">{{ fields.label }}</el-tag>
        </div>
        <div v-if="fields.tripId_str" class="card-field">
          <span class="label">申请单号</span>
          <span class="value">{{ fields.tripId_str }}</span>
        </div>
        <div v-if="fields.dateRange" class="card-field">
          <span class="label">出差日期</span>
          <span class="value">{{ fields.dateRange }}</span>
        </div>
        <div v-if="fields.amount != null" class="card-field">
          <span class="label">金额</span>
          <span class="value amount text-success">¥{{ formatAmount(fields.amount) }}</span>
        </div>
        <div v-if="fields.datetime" class="card-field">
          <span class="label">发放时间</span>
          <span class="value">{{ formatDateTime(fields.datetime) }}</span>
        </div>
      </template>

      <!-- Regular record fields -->
      <template v-else-if="!isTripRecord">
        <div v-if="showField('type')" class="card-field">
          <span class="label">类型</span>
          <el-select v-if="isEditing" v-model="editFields.type" size="small" style="width: 100px">
            <el-option label="支出" value="支出" />
            <el-option label="收入" value="收入" />
          </el-select>
          <el-tag v-else :type="fields.type === '收入' ? 'success' : 'danger'" size="small">
            {{ fields.type }}
          </el-tag>
        </div>
        <div v-if="showField('amount')" class="card-field">
          <span class="label">金额</span>
          <el-input-number v-if="isEditing" v-model="editFields.amount" :min="0" :precision="2" size="small" style="width: 130px" />
          <span v-else class="value amount" :class="fields.type === '收入' ? 'text-success' : 'text-danger'">
            ¥{{ formatAmount(fields.amount) }}
          </span>
        </div>
        <div v-if="showField('category')" class="card-field">
          <span class="label">分类</span>
          <el-input v-if="isEditing" v-model="editFields.category" size="small" style="width: 120px" />
          <span v-else class="value">{{ fields.category }}</span>
        </div>
        <div v-if="showField('account')" class="card-field">
          <span class="label">账户</span>
          <el-select v-if="isEditing" v-model="editFields.account" size="small" style="width: 100px">
            <el-option label="个人" value="个人" />
            <el-option label="家庭" value="家庭" />
            <el-option label="公司" value="公司" />
          </el-select>
          <span v-else class="value">{{ fields.account }}</span>
        </div>
        <div v-if="isEditing || showField('payment') || showField('payment_method')" class="card-field">
          <span class="label">支付</span>
          <el-input v-if="isEditing" v-model="editFields.payment" size="small" style="width: 160px" />
          <span v-else class="value">{{ fields.payment || fields.payment_method || '' }}</span>
        </div>
        <div v-if="showField('datetime')" class="card-field">
          <span class="label">时间</span>
          <el-input v-if="isEditing" v-model="editFields.datetime" size="small" style="width: 160px" />
          <span v-else class="value">{{ formatDateTime(fields.datetime) }}</span>
        </div>
        <div v-if="showField('note')" class="card-field">
          <span class="label">备注</span>
          <el-input v-if="isEditing" v-model="editFields.note" size="small" style="width: 180px" />
          <span v-else class="value">{{ fields.note }}</span>
        </div>
      </template>

      <!-- Trip record fields -->
      <template v-else>
        <div v-if="fields.trip_id" class="card-field">
          <span class="label">申请单号</span>
          <span class="value">{{ fields.trip_id }}</span>
        </div>
        <div v-if="fields.start_date" class="card-field">
          <span class="label">出发日期</span>
          <span class="value">{{ fields.start_date }}</span>
        </div>
        <div v-if="fields.end_date" class="card-field">
          <span class="label">返程日期</span>
          <span class="value">{{ fields.end_date }}</span>
        </div>
        <div v-if="fields.days" class="card-field">
          <span class="label">出差天数</span>
          <span class="value">{{ fields.days }} 天</span>
        </div>
        <div v-if="fields.trip_allowance" class="card-field">
          <span class="label">差旅补助</span>
          <span class="value">¥{{ formatAmount(fields.trip_allowance) }}（100元/天）</span>
        </div>
        <div v-if="fields.transport_allowance" class="card-field">
          <span class="label">交通补助</span>
          <span class="value">¥{{ formatAmount(fields.transport_allowance) }}（30元/天）</span>
        </div>
        <div v-if="fields.total" class="card-field">
          <span class="label">合计</span>
          <span class="value amount text-danger">¥{{ formatAmount(fields.total) }}</span>
        </div>
        <div v-if="fields.notes" class="card-field">
          <span class="label">备注</span>
          <span class="value">{{ fields.notes }}</span>
        </div>
      </template>
    </div>
    <div v-if="!readonly" class="save-hint">点击“确认”后才会写入账本</div>
    <div v-if="!readonly" class="card-actions">
      <template v-if="isEditing">
        <el-button size="small" type="primary" @click="$emit('save', editFields)">
          <el-icon><Check /></el-icon> 保存
        </el-button>
        <el-button size="small" @click="cancelEdit">
          <el-icon><Close /></el-icon> 取消
        </el-button>
      </template>
      <template v-else>
        <el-button size="small" type="success" @click="$emit('confirm')">
          <el-icon><Check /></el-icon> 确认
        </el-button>
        <el-button size="small" @click="startEdit">
          <el-icon><Edit /></el-icon> 修改
        </el-button>
        <el-button size="small" type="info" @click="$emit('cancel')">
          <el-icon><Close /></el-icon> 取消
        </el-button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Check, Edit, Close } from '@element-plus/icons-vue';
import { formatDateTimeShort } from '@/utils/formatters';

const props = defineProps<{
  fields: Record<string, unknown>;
  title?: string;
  readonly?: boolean;
}>();

defineEmits<{
  confirm: [];
  edit: [];
  cancel: [];
  save: [fields: Record<string, unknown>];
}>();

const isTripRecord = computed(() => 'trip_id' in props.fields);
// 差旅补助发放确认：record_trip_payment 返回的卡片，特征是含 tripId（数字 ID）但不含 trip_allowance
const isTripPayment = computed(() => 'tripId' in props.fields && !('trip_allowance' in props.fields));

// Edit mode state
const isEditing = ref(false);
const editFields = ref<Record<string, unknown>>({});

function startEdit() {
  editFields.value = { ...props.fields };
  isEditing.value = true;
}

function cancelEdit() {
  isEditing.value = false;
  editFields.value = {};
}

// 保存后父组件会将 msg.status 置为非 pending，readonly 变为 true；
// 此时必须重置 isEditing，否则模板仍会渲染可编辑的输入控件
watch(() => props.readonly, (v) => {
  if (v) {
    isEditing.value = false;
    editFields.value = {};
  }
});

// Show field if it has a value (handle both extracted and edited states)
function showField(key: string): boolean {
  if (isEditing.value) return key in editFields.value && editFields.value[key] != null;
  const val = props.fields[key];
  return key in props.fields && val != null && val !== '';
}

function formatAmount(val: unknown): string {
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  return isNaN(n) ? String(val) : n.toFixed(2);
}

function formatDateTime(val: unknown): string {
  if (typeof val !== 'string' || !val) return '';
  return formatDateTimeShort(val);
}
</script>

<style scoped>
.confirm-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  min-width: 260px;
}

.card-header {
  font-weight: 600;
  margin-bottom: 8px;
  color: #333;
  font-size: 0.95em;
}

.card-field {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  font-size: 0.9em;
}

.confirm-card.editing .card-field {
  padding: 6px 0;
}

.card-field .label {
  color: #999;
}

.card-field .amount {
  font-weight: 600;
}

.save-hint {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
  color: #909399;
  font-size: 12px;
}

.card-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.text-success { color: #52c41a; }
.text-danger { color: #ff4d4f; }
</style>
