import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'web/pages/index.html'),
        records: resolve(__dirname, 'web/pages/records.html'),
        budget: resolve(__dirname, 'web/pages/budget.html'),
        stats: resolve(__dirname, 'web/pages/stats.html'),
        'trip-allowance': resolve(__dirname, 'web/pages/trip_allowance.html'),
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
    middlewareMode: false,
  },
  plugins: [
    {
      name: 'root-redirect',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/') {
            res.writeHead(302, { Location: '/pages/index.html' });
            res.end();
          } else {
            next();
          }
        });
      },
    },
  ],
});
