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
    // 127.0.0.1 explícito: la API escucha solo en IPv4 local y en algunos sistemas
    // "localhost" se resuelve primero a ::1 (hallazgo QA N-03).
    proxy: { '/api': 'http://127.0.0.1:3000', '/health': 'http://127.0.0.1:3000' },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
