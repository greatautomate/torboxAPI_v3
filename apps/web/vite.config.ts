import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.TBG_API_PROXY ?? 'http://localhost:10000';
// Backend paths proxied in dev. Regex keys with a path boundary so `/s` does not swallow `/src/*`.
const proxied = ['^/admin/api(/|$)', '^/api(/|$)', '^/v1(/|$)', '^/public(/|$)', '^/openapi\\.json$', '^/docs(/|$)', '^/dl(/|$)', '^/s(/|$)', '^/hooks(/|$)'];

export default defineConfig({
  base: '/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
          charts: ['recharts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target, changeOrigin: false }])),
  },
});
