// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Las pruebas de integración hacen varias derivaciones argon2id y viajes a la base.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
