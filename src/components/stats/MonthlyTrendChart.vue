<template>
  <v-chart class="chart" :option="option" autoresize />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart, BarChart } from 'echarts/charts';
import { TooltipComponent, GridComponent, LegendComponent } from 'echarts/components';
import VChart from 'vue-echarts';
import type { MonthTrend } from '@/types';

use([CanvasRenderer, LineChart, BarChart, TooltipComponent, GridComponent, LegendComponent]);

const props = defineProps<{
  data: MonthTrend[];
}>();

const option = computed(() => ({
  tooltip: {
    trigger: 'axis' as const,
  },
  legend: {
    top: 0,
    data: ['收入', '支出'],
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
    data: props.data.map(d => d.month),
  },
  yAxis: {
    type: 'value' as const,
    axisLabel: { formatter: '¥{value}' },
  },
  series: [
    {
      name: '收入',
      type: 'line' as const,
      data: props.data.map(d => d.income),
      smooth: true,
      areaStyle: { opacity: 0.2 },
      itemStyle: { color: '#52c41a' },
    },
    {
      name: '支出',
      type: 'bar' as const,
      data: props.data.map(d => d.expense),
      itemStyle: { color: '#ff6b6b' },
    },
  ],
}));
</script>

<style scoped>
.chart {
  width: 100%;
  height: 350px;
}
</style>
