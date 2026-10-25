// SPDX-License-Identifier: AGPL-3.0-or-later
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // Sin mapas de fuente en producción ni recursos externos (sin CDN).
    sourcemap: false,
    outDir: 'dist',
  },
  server: {
    proxy: { '/api': 'http://localhost:3000', '/health': 'http://localhost:3000' },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
