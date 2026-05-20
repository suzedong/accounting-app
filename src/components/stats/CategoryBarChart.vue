<template>
  <VueUiXy :dataset="dataset" :config="config" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { VueUiXy } from 'vue-data-ui';
import type { CategoryStat } from '@/types';

const props = defineProps<{
  data: CategoryStat[];
  type?: '支出' | '收入';
}>();

const dataset = computed(() => {
  return {
    series: [
      {
        name: props.type || '金额',
        values: props.data.map(d => ({ name: d.category, value: d.total })),
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
    color: '#667eea',
  },
  tooltip: {
    show: true,
  },
  legend: {
    show: true,
  },
};
</script>
