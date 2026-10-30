// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas E2E de 2C-2 (2C §2.5) contra la API real y PostgreSQL. El entorno efímero lo
 * levanta `e2e/support/global-setup.ts`. Ver docs/fase-1/ejecucion-local.md (pruebas E2E).
 *
 * Un solo proceso y en serie: todas las pruebas comparten una organización y su
 * administrador, y varias simulan el paso del tiempo en la base.
 */
const webPort = Number(process.env.E2E_WEB_PORT ?? 4187);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env.CI !== undefined,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI !== undefined ? [['list'], ['github'], ['json', { outputFile: 'test-results/e2e-report.json' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${String(webPort)}`,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
