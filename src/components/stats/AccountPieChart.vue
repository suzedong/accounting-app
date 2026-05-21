<template>
  <v-chart class="chart" :option="option" autoresize />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { PieChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent } from 'echarts/components';
import VChart from 'vue-echarts';
import type { AccountStat } from '@/types';

use([CanvasRenderer, PieChart, TooltipComponent, LegendComponent]);

const props = defineProps<{
  data: AccountStat[];
}>();

const colors = ['#667eea', '#764ba2', '#52c41a', '#ff6b6b', '#1890ff', '#ffc107'];

const option = computed(() => ({
  tooltip: {
    trigger: 'item' as const,
    formatter: '{b}: ¥{c} ({d}%)',
  },
  legend: {
    bottom: '5%',
    left: 'center',
  },
  series: [
    {
      name: '账户',
      type: 'pie' as const,
      radius: ['40%', '70%'],
      avoidLabelOverlap: true,
      itemStyle: {
        borderRadius: 6,
      },
      label: {
        show: false,
      },
      color: colors,
      data: props.data.map(d => ({
        name: d.account,
        value: d.total,
      })),
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
