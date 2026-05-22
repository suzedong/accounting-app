<template>
  <div class="chat-thinking">
    <!-- Simple loading (default) -->
    <template v-if="!thinkingSteps">
      <span class="dot dot-1"></span>
      <span class="dot dot-2"></span>
      <span class="dot dot-3"></span>
      <span class="thinking-text">{{ text }}</span>
    </template>

    <!-- Step-by-step thinking process -->
    <template v-else>
      <div class="thinking-step" :class="thinkingSteps === 'done' ? 'done' : ''">
        <span class="step-icon">{{ stepIcon }}</span>
        <span>意图识别：<strong>{{ intentLabel }}</strong> ({{ (confidence ?? 0).toFixed(2) }})</span>
      </div>

      <!-- Intent detail rows (shown after intent is recognized) -->
      <template v-if="showDetails && detailFields && detailFields.length > 0">
        <div v-for="field in detailFields" :key="field.label" class="thinking-detail-row">
          <span class="detail-label">{{ field.label }}</span>
          <span class="detail-value">{{ field.value }}</span>
        </div>
      </template>

      <!-- Skill execution step -->
      <div v-if="showExecuteStep" class="thinking-step" :class="thinkingSteps === 'execute' ? 'active' : 'done'">
        <span class="step-icon">{{ executeIcon }}</span>
        <span>执行 Skill：{{ executeLabel }}</span>
        <span v-if="thinkingSteps === 'execute'" class="step-spinner"></span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  text?: string;
  thinkingSteps?: 'intent' | 'execute' | 'done';
  intentLabel?: string;
  confidence?: number;
  detailFields?: Array<{ label: string; value: string }>;
  showDetails?: boolean;
  executeLabel?: string;
  showExecuteStep?: boolean;
}>();

const stepIcon = computed(() => {
  if (props.thinkingSteps === 'done') return '✅';
  return '💭';
});

const executeIcon = computed(() => {
  if (props.thinkingSteps === 'done') return '✅';
  return '⚙️';
});
</script>

<style scoped>
.chat-thinking {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 14px;
  background: #f0f2ff;
  border-radius: 12px;
  border: 1px solid #e0e4ff;
}

/* Simple loading dots */
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #999;
  animation: thinking-bounce 1.4s ease-in-out infinite;
}

.dot-1 { animation-delay: 0s; }
.dot-2 { animation-delay: 0.2s; }
.dot-3 { animation-delay: 0.4s; }

.thinking-text {
  color: #999;
  font-style: italic;
  font-size: 0.9em;
  margin-left: 4px;
}

@keyframes thinking-bounce {
  0%, 80%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  40% {
    transform: translateY(-6px);
    opacity: 1;
  }
}

/* Step-by-step thinking */
.thinking-step {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 0.8em;
  color: #888;
  animation: thinking-fade-in 0.3s ease;
}

.thinking-step.active {
  color: #667eea;
  font-weight: 500;
}

.thinking-step.done {
  color: #666;
}

.step-icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  font-size: 0.9em;
  flex-shrink: 0;
}

.step-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid #667eea;
  border-top-color: transparent;
  border-radius: 50%;
  animation: thinking-spin 0.8s linear infinite;
  margin-left: 6px;
}

@keyframes thinking-spin {
  to { transform: rotate(360deg); }
}

/* Detail rows */
.thinking-detail-row {
  display: flex;
  gap: 8px;
  padding: 2px 0 2px 26px;
  font-size: 0.75em;
  color: #666;
}

.detail-label {
  color: #999;
  min-width: 40px;
  flex-shrink: 0;
}

.detail-value {
  color: #333;
  font-weight: 500;
}

@keyframes thinking-fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
