<template>
  <div class="step-list">
    <div
      v-for="step in steps"
      :key="step.id"
      class="step-item"
      :class="`step-${step.status}`"
    >
      <!-- 步骤标题行 -->
      <div class="step-header" @click="step.collapsed = !step.collapsed">
        <span class="step-status-icon">
          <span v-if="step.status === 'running'" class="spinner">⟳</span>
          <span v-else-if="step.status === 'success'" class="success-icon">✅</span>
          <span v-else class="error-icon">❌</span>
        </span>
        <span class="step-title">{{ step.title }}</span>
        <span v-if="step.detail?.confidence" class="confidence-badge">
          {{ Math.round(step.detail.confidence * 100) }}%
        </span>
        <span v-if="step.detail?.ocr?.latency" class="latency-badge">
          {{ step.detail.ocr.latency }}ms
        </span>
        <span class="chevron-icon" :class="{ rotated: !step.collapsed }">▾</span>
      </div>

      <!-- 步骤详情 -->
      <div v-show="!step.collapsed" class="step-detail">
        <!-- OCR 识别 -->
        <div v-if="step.detail?.ocr" class="detail-section">
          <dl>
            <div class="field-row">
              <dt>识别文本</dt>
              <dd class="ocr-text">{{ step.detail.ocr.recognizedText || '识别失败' }}</dd>
            </div>
            <div class="field-row">
              <dt>耗时</dt>
              <dd>{{ step.detail.ocr.latency }}ms</dd>
            </div>
            <div v-if="step.detail.ocr.error" class="field-row">
              <dt>错误</dt>
              <dd class="error-text">{{ step.detail.ocr.error }}</dd>
            </div>
          </dl>
        </div>

        <!-- 意图识别 -->
        <div v-if="step.detail?.action" class="detail-section">
          <div class="action-label">
            动作: <code>{{ step.detail.action }}</code>
          </div>
        </div>

        <!-- 字段列表 -->
        <div v-if="step.detail?.fields && step.detail.fields.length > 0" class="detail-section">
          <dl class="fields-list">
            <div v-for="field in step.detail.fields" :key="field.label" class="field-row">
              <dt>{{ field.label }}</dt>
              <dd>
                <span class="field-value">{{ field.value }}</span>
                <span class="source-badge" :class="`source-${field.source}`">
                  {{ sourceLabel(field.source) }}
                </span>
              </dd>
            </div>
          </dl>
        </div>

        <!-- 执行结果 -->
        <div v-if="step.detail?.result" class="detail-section">
          <p class="result-text">{{ step.detail.result.message || '操作完成' }}</p>
        </div>

        <!-- 错误信息 -->
        <div v-if="step.detail?.error" class="detail-section">
          <p class="error-text">{{ step.detail.error }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Step } from '@/types/chat';

defineProps<{
  steps: Step[];
}>();

function sourceLabel(source: 'extracted' | 'inferred' | 'default'): string {
  return { extracted: '提取', inferred: '推断', default: '默认' }[source];
}
</script>

<style scoped>
.step-list {
  margin: 0;
}

.step-item {
  border: none;
  border-bottom: 1px solid #e5e7eb;
  border-radius: 0;
  margin-bottom: 0;
  overflow: visible;
  transition: border-color 0.2s;
  background: transparent;
}

.step-item:last-child {
  border-bottom: none;
}

.step-item.step-running {
  border-color: transparent;
  background: rgba(59, 130, 246, 0.05);
}

.step-item.step-success {
  border-color: transparent;
  background: transparent;
}

.step-item.step-error {
  border-color: transparent;
  background: rgba(239, 68, 68, 0.05);
}

.step-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  cursor: pointer;
  user-select: none;
  font-size: 12px;
}

.step-header:hover {
  background: rgba(0, 0, 0, 0.02);
}

.step-status-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.spinner {
  animation: spin 1s linear infinite;
  color: #3b82f6;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.success-icon {
  color: #10b981;
}

.error-icon {
  color: #ef4444;
}

.step-title {
  font-weight: 500;
  color: #374151;
  flex: 1;
}

.confidence-badge {
  font-size: 11px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: 10px;
}

.latency-badge {
  font-size: 11px;
  color: #6b7280;
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: 10px;
}

.chevron-icon {
  font-size: 10px;
  color: #9ca3af;
  transition: transform 0.2s;
}

.chevron-icon.rotated {
  transform: rotate(180deg);
}

.step-detail {
  padding: 2px 6px 6px 24px;
  font-size: 12px;
  color: #4b5563;
}

.detail-section {
  margin-bottom: 6px;
}

.detail-section:last-child {
  margin-bottom: 0;
}

.fields-list {
  display: grid;
  gap: 2px;
}

.field-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.field-row dt {
  color: #6b7280;
  min-width: 50px;
  font-weight: 500;
}

.field-row dd {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.field-value {
  color: #111827;
}

.source-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 500;
}

.source-extracted {
  background: #dbeafe;
  color: #1d4ed8;
}

.source-inferred {
  background: #fef3c7;
  color: #92400e;
}

.source-default {
  background: #e5e7eb;
  color: #6b7280;
}

.action-label {
  color: #4b5563;
}

.action-label code {
  background: #f3f4f6;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
  color: #1f2937;
}

.ocr-text {
  font-style: italic;
  color: #6b7280;
}

.result-text {
  color: #059669;
  margin: 0;
}

.error-text {
  color: #dc2626;
  margin: 0;
}
</style>
