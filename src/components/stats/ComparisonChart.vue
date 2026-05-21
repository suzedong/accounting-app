<template>
  <v-chart class="chart" :option="option" autoresize />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components';
import VChart from 'vue-echarts';

use([CanvasRenderer, BarChart, TooltipComponent, GridComponent, LegendComponent]);

const props = defineProps<{
  current: { label: string; income: number; expense: number; balance: number };
  previous: { label: string; income: number; expense: number; balance: number };
}>();

const option = computed(() => ({
  tooltip: {
    trigger: 'axis' as const,
  },
  legend: {
    top: 0,
    data: [props.previous.label, props.current.label],
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    top: '15%',
    containLabel: true,
  },
  xAxis: {
    type: 'category' as const,
    data: ['收入', '支出', '结余'],
  },
  yAxis: {
    type: 'value' as const,
    axisLabel: { formatter: '¥{value}' },
  },
  series: [
    {
      name: props.previous.label,
      type: 'bar' as const,
      data: [props.previous.income, props.previous.expense, props.previous.balance],
      itemStyle: { color: '#95e1d3' },
    },
    {
      name: props.current.label,
      type: 'bar' as const,
      data: [props.current.income, props.current.expense, props.current.balance],
      itemStyle: { color: '#667eea' },
    },
  ],
}));
</script>

<style scoped>
.chart {
  width: 100%;
  height: 300px;
}
</style>
