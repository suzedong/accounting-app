<template>
  <v-chart class="chart" :option="option" autoresize />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart } from 'echarts/charts';
import { TooltipComponent, GridComponent } from 'echarts/components';
import VChart from 'vue-echarts';
import type { CategoryStat } from '@/types';

use([CanvasRenderer, BarChart, TooltipComponent, GridComponent]);

const props = defineProps<{
  data: CategoryStat[];
  type?: '支出' | '收入';
}>();

const option = computed(() => ({
  tooltip: {
    trigger: 'axis' as const,
    formatter: '{b}: ¥{c}',
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true,
  },
  xAxis: {
    type: 'category' as const,
    data: props.data.map(d => d.category),
    axisTick: { alignWithLabel: true },
  },
  yAxis: {
    type: 'value' as const,
    axisLabel: { formatter: '¥{value}' },
  },
  series: [
    {
      name: props.type || '金额',
      type: 'bar' as const,
      data: props.data.map(d => d.total),
      itemStyle: { color: '#667eea' },
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
