<template>
  <VueUiDonut :dataset="dataset" :config="config" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { VueUiDonut } from 'vue-data-ui';
import type { AccountStat } from '@/types';

const props = defineProps<{
  data: AccountStat[];
}>();

const colors = ['#667eea', '#764ba2', '#52c41a', '#ff6b6b', '#1890ff', '#ffc107'];

const dataset = computed(() => {
  return props.data.map((d, i) => ({
    name: d.account,
    values: [d.total],
    color: colors[i % colors.length],
  }));
});

const config = {
  style: {
    colors: colors,
  },
  tooltip: {
    show: true,
  },
  legend: {
    show: true,
  },
};
</script>
