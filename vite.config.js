import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'web/index.html'),
        records: resolve(__dirname, 'web/records.html'),
        budget: resolve(__dirname, 'web/budget.html'),
        stats: resolve(__dirname, 'web/stats.html'),
        'trip-allowance': resolve(__dirname, 'web/trip_allowance.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:18080',
        changeOrigin: true,
      },
    },
  },
});
