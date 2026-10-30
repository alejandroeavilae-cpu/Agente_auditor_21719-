// SPDX-License-Identifier: AGPL-3.0-or-later

import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Browser, type Locator, type Page } from '@playwright/test';
import { ApiClient } from './api-client.js';
import { loadState, syntheticPassword, uid, type E2EState } from './state.js';
import { nextTotp } from './totp.js';

/**
 * Accesorios comunes de las pruebas E2E:
 * - `cspGuard`: registra toda infracción de la CSP (evento `securitypolicyviolation` y
 *   mensajes "Refused to …" de la consola) y hace fallar la prueba si hubo alguna. Así se
 *   demuestra que la SPA funciona con la CSP de Caddy sin `unsafe-inline`.
 * - `expectAccessible`: axe-core sobre la pantalla actual; falla ante cualquier infracción
 *   de las reglas WCAG 2.0/2.1/2.2 A y AA y de buenas prácticas.
 */

declare global {
  interface Window {
    __cspViolations?: { text: string; duringAxe: boolean; blocked: string }[];
    __axeRunning?: boolean;
  }
}

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

export async function expectAccessible(page: Page, screen: string): Promise<void> {
  // axe-core usa `new Function` para sus mensajes; la CSP lo bloquea (y lo informa) dentro de
  // la página. Se marca el intervalo para no confundirlo con una infracción de la SPA.
  await page.evaluate(() => {
    window.__axeRunning = true;
  });
  let results;
  try {
    results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  } finally {
    await page.evaluate(() => {
      window.__axeRunning = false;
    });
  }
  const summary = results.violations.map((v) => `${v.id} (${v.impact ?? 'sin impacto'}): ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`);
  expect(summary, `axe-core en "${screen}"`).toEqual([]);
}

interface Fixtures {
  state: E2EState;
  cspGuard: undefined;
  /** Abre otra página en un contexto propio (otra persona), con la misma guarda de CSP. */
  openPage: () => Promise<Page>;
}

/**
 * Registra las infracciones de la CSP de una página y devuelve la función que las verifica.
 * Las infracciones se acumulan por documento; antes de cada navegación completa se recogen
 * las del documento que se descarta.
 */
async function installCspGuard(page: Page): Promise<() => Promise<void>> {
  const collected: string[] = [];
  const collect = async () => {
    const list = await page.evaluate(() => window.__cspViolations ?? []).catch(() => []);
    // Solo se tolera el `eval` de axe-core mientras analiza (ver expectAccessible).
    for (const v of list) if (!(v.duringAxe && v.blocked === 'eval')) collected.push(v.text);
  };
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) void collect();
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations?.push({ text: `${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${String(e.lineNumber)} ${e.sample}`, duringAxe: window.__axeRunning === true, blocked: e.blockedURI });
    });
  });
  return async () => {
    if (!page.isClosed()) await collect();
    expect([...new Set(collected)], 'infracciones de la CSP').toEqual([]);
  };
}

/** Página en un contexto nuevo (axe-core exige `browser.newContext()`), con guarda de CSP. */
async function guardedPage(browser: Browser): Promise<{ page: Page; check: () => Promise<void>; close: () => Promise<void> }> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL ?? '',
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    acceptDownloads: true,
  });
  const page = await context.newPage();
  const check = await installCspGuard(page);
  return { page, check, close: () => context.close() };
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  state: async ({}, use) => {
    await use(loadState());
  },
  cspGuard: [
    async ({ page }, use) => {
      const check = await installCspGuard(page);
      await use(undefined);
      await check();
    },
    { auto: true },
  ],
  openPage: async ({ browser }, use) => {
    const opened: { close: () => Promise<void>; check: () => Promise<void> }[] = [];
    await use(async () => {
      const { page, check, close } = await guardedPage(browser);
      opened.push({ check, close });
      return page;
    });
    for (const o of opened) await o.check();
    for (const o of opened) await o.close();
  },
});

export { expect };

/** Usuario sintético activo con MFA, creado por la API con la sesión del administrador. */
export interface TestUser {
  email: string;
  name: string;
  password: string;
  secret: string;
  id: string;
}

export async function adminApi(state: E2EState): Promise<ApiClient> {
  const client = new ApiClient(state.apiUrl);
  await client.login(state.admin.email, state.admin.password, state.admin.secret);
  return client;
}

export async function createActiveUser(state: E2EState, roles: string[], label = 'persona'): Promise<TestUser> {
  const admin = await adminApi(state);
  const email = `${label}-${uid()}@muni-e2e.example`;
  const name = `${label[0]?.toUpperCase() ?? ''}${label.slice(1)} Sintética ${uid().slice(-4)}`;
  const { userId, token } = await admin.invite(email, name, roles);
  const password = syntheticPassword();
  const client = new ApiClient(state.apiUrl);
  const { secret } = await client.activateWithMfa(token, password);
  // Se cierra la sesión de la activación: las pruebas cuentan sesiones abiertas.
  await client.expect('POST', '/api/v1/auth/logout', 204);
  return { email, name, password, secret, id: userId };
}

/** Inicio de sesión completo por la interfaz (correo, contraseña y código). */
export async function loginUi(page: Page, user: { email: string; password: string; secret: string }): Promise<void> {
  await page.goto('/iniciar-sesion');
  await page.getByLabel('Correo').fill(user.email);
  await page.getByLabel('Contraseña', { exact: false }).first().fill(user.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Verificación en dos pasos' })).toBeVisible();
  await page.getByLabel('Código de verificación').fill(await nextTotp(user.secret));
  await page.getByRole('button', { name: 'Verificar' }).click();
  // Espera a salir de la verificación antes de seguir (una navegación completa cortaría la petición).
  await expect(page.getByRole('heading', { level: 1, name: 'Verificación en dos pasos' })).toBeHidden();
}

export function adminUser(state: E2EState): { email: string; password: string; secret: string } {
  return state.admin;
}

/**
 * Marca o desmarca una casilla de React Aria haciendo clic en su etiqueta visible, como una
 * persona: la casilla nativa está oculta visualmente (sigue siendo accesible por teclado y
 * lector de pantalla), y Playwright no hace clic sobre elementos de 1×1 recortados.
 */
export async function setCheckbox(scope: Locator, name: RegExp, on: boolean): Promise<void> {
  const box = scope.getByRole('checkbox', { name });
  if ((await box.isChecked()) !== on) await scope.locator('label', { has: scope.page().getByRole('checkbox', { name }) }).click();
  if (on) await expect(box).toBeChecked();
  else await expect(box).not.toBeChecked();
}
