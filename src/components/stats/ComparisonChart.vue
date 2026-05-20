<template>
  <VueUiXy :dataset="dataset" :config="config" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { VueUiXy } from 'vue-data-ui';

const props = defineProps<{
  current: { label: string; income: number; expense: number; balance: number };
  previous: { label: string; income: number; expense: number; balance: number };
}>();

const dataset = computed(() => {
  return {
    series: [
      {
        name: '收入',
        values: [
          { name: props.previous.label, value: props.previous.income },
          { name: props.current.label, value: props.current.income },
        ],
        type: 'bar',
      },
      {
        name: '支出',
        values: [
          { name: props.previous.label, value: props.previous.expense },
          { name: props.current.label, value: props.current.expense },
        ],
        type: 'bar',
      },
    ],
  };
});

const config = {
  chart: {
    height: 300,
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
