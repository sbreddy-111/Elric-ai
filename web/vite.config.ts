import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  build: {
    target: 'es2022', outDir: 'dist', assetsInlineLimit: 0,
    rollupOptions: {
      // Main app (unchanged) + separate owner-only admin page at /admin/.
      input: { index: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin/index.html') },
    },
  },
});
