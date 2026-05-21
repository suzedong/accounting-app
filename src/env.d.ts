/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

declare module 'vue-data-ui' {
  import type { DefineComponent } from 'vue';
  export const VueUiXy: DefineComponent<{}, {}, any>;
  export const VueUiDonut: DefineComponent<{}, {}, any>;
  export const VueUiSparkline: DefineComponent<{}, {}, any>;
  export const VueUiScatter: DefineComponent<{}, {}, any>;
  export const VueUiWaterfall: DefineComponent<{}, {}, any>;
  export const VueUiGauge: DefineComponent<{}, {}, any>;
  export const VueUiRadar: DefineComponent<{}, {}, any>;
  export const VueUiTreemap: DefineComponent<{}, {}, any>;
  export const VueUiTable: DefineComponent<{}, {}, any>;
  export const VueUiFunnel: DefineComponent<{}, {}, any>;
  export const VueUiHeatmap: DefineComponent<{}, {}, any>;
  export const VueUiTreeGraph: DefineComponent<{}, {}, any>;
}
