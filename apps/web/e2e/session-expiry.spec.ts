// SPDX-License-Identifier: AGPL-3.0-or-later

import { ageLastSeen, sessionCount } from './support/db.js';
import { createActiveUser, expect, expectAccessible, loginUi, test } from './support/fixtures.js';

/**
 * Flujo 4 de 2C §2.5: expiración de la sesión. La API fija 30 min de inactividad (D-79) y no
 * permite configurarlos, así que:
 * - el aviso del cliente se prueba adelantando el reloj del navegador (Playwright `clock`);
 * - la expiración del servidor se prueba envejeciendo `last_seen_at` en la base.
 */
test('aviso antes de expirar, "continuar" renueva y al vencer vuelve al inicio de sesión', async ({ page, state }) => {
  const user = await createActiveUser(state, ['reader'], 'inactiva');
  await page.clock.install();
  await loginUi(page, user);
  await expect(page.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();

  // A los 28,5 min sin actividad aparece el aviso (2 min antes).
  await page.clock.fastForward('28:30');
  const warning = page.getByRole('alertdialog', { name: 'Su sesión está por expirar' });
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Por inactividad, la sesión se cerrará en');
  await expectAccessible(page, 'Aviso de expiración de la sesión');
  // "Continuar" llama /me (renueva la inactividad en el servidor) y cierra el aviso.
  const me = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/me') && r.status() === 200);
  await warning.getByRole('button', { name: 'Continuar con la sesión' }).click();
  await me;
  await expect(warning).toBeHidden();

  // Sin actividad hasta vencer: la SPA cierra la sesión en la API y vuelve al inicio de sesión.
  await page.clock.fastForward('31:00');
  await expect(page.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByText('Su sesión se cerró por inactividad')).toBeVisible();
  // La SPA cerró la sesión en la API (no solo en la pantalla).
  expect(await page.evaluate(async () => (await fetch('/api/v1/auth/me', { credentials: 'same-origin' })).status)).toBe(401);
  await expect.poll(() => sessionCount(user.email)).toBe(0);
});

test('si el servidor ya expiró la sesión, la siguiente acción lleva al inicio de sesión con un mensaje', async ({ page, state }) => {
  const admin = await createActiveUser(state, ['org_admin'], 'administradora');
  await loginUi(page, admin);
  await expect(page.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();
  await ageLastSeen(admin.email, 31);
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Usuarios' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByText('Su sesión expiró. Inicie sesión nuevamente.')).toBeVisible();
  await expectAccessible(page, 'Iniciar sesión (sesión expirada)');
});
