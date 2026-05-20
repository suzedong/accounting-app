<template>
  <VueUiXy :dataset="dataset" :config="config" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { VueUiXy } from 'vue-data-ui';
import type { MonthTrend } from '@/types';

const props = defineProps<{
  data: MonthTrend[];
}>();

const dataset = computed(() => {
  return {
    series: [
      {
        name: '收入',
        values: props.data.map(d => ({ name: d.month, value: d.income })),
        type: 'line',
        useArea: true,
      },
      {
        name: '支出',
        values: props.data.map(d => ({ name: d.month, value: d.expense })),
        type: 'bar',
        useArea: false,
      },
    ],
  };
});

const config = {
  chart: {
    height: 350,
  },
  style: {
    colorPalette: ['#52c41a', '#ff6b6b'],
  },
  tooltip: {
    show: true,
  },
  legend: {
    show: true,
  },
};
</script>
