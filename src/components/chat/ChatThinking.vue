<template>
  <div class="chat-thinking">
    <span class="dot dot-1"></span>
    <span class="dot dot-2"></span>
    <span class="dot dot-3"></span>
    <span class="thinking-text">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  text?: string;
}>();
</script>

<style scoped>
.chat-thinking {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
}

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
</style>
