// SPDX-License-Identifier: AGPL-3.0-or-later

import { ApiClient } from './support/api-client.js';
import { ageMfaVerification } from './support/db.js';
import { createActiveUser, expect, expectAccessible, loginUi, test } from './support/fixtures.js';
import { nextTotp, wrongTotp } from './support/totp.js';

/** Registro de accesos (D-88): filtros, alertas destacadas, paginación por cursor y reautenticación. */
test('registro de accesos con alertas destacadas, filtros, páginas y reautenticación', async ({ page, state }) => {
  // Genera un bloqueo de MFA (evento auth.account.locked) de una persona sintética.
  const user = await createActiveUser(state, ['reader'], 'registro');
  const attacker = new ApiClient(state.apiUrl);
  await attacker.expect('POST', '/api/v1/auth/login', 200, { email: user.email, password: user.password });
  for (let i = 0; i < 5; i += 1) await attacker.expect('POST', '/api/v1/auth/mfa/verify', 401, { code: wrongTotp(user.secret) });

  await loginUi(page, state.admin);
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Registro de accesos' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Registro de accesos' })).toBeVisible();
  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  await expectAccessible(page, 'Registro de accesos');

  // Filtro: solo alertas de esa persona.
  await page.getByLabel('Tipo de evento').selectOption({ label: 'Alertas (todos)' });
  await page.getByLabel('Persona').selectOption({ label: `${user.name} (${user.email})` });
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  const alertRow = table.getByRole('row').filter({ hasText: 'Cuenta bloqueada por intentos fallidos' });
  await expect(alertRow.first()).toBeVisible();
  await expect(alertRow.first().getByText('Alerta', { exact: true })).toBeVisible();
  await expect(alertRow.first()).toContainText(user.email);
  await expect(alertRow.first()).toContainText('127.0.0.1');
  await expectAccessible(page, 'Registro de accesos (filtrado, alerta)');

  // Rango de fechas inválido: mensaje claro, sin consultar.
  await page.getByLabel('Desde (fecha local)').fill('2030-01-02');
  await page.getByLabel('Hasta (fecha local, inclusive)').fill('2030-01-01');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page.getByText('La fecha "Desde" debe ser anterior o igual a "Hasta".')).toBeVisible();

  // Paginación por cursor: con todos los eventos hay más de una página (50 por página).
  await page.getByRole('button', { name: 'Quitar filtros' }).click();
  // Asegura más de 50 eventos (inicios de sesión fallidos de un correo inexistente).
  const filler = new ApiClient(state.apiUrl);
  for (let i = 0; i < 51; i += 1) await filler.request('POST', '/api/v1/auth/login', { email: 'nadie@muni-e2e.example', password: 'incorrecta-sintetica' });
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await page.reload();
  await expect(table.getByRole('row')).toHaveCount(51);
  await expect(table.getByRole('row').filter({ hasText: 'Sin persona asociada' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Página siguiente' }).click();
  await expect(page.getByText('Página 2:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Página anterior' }).click();
  await expect(page.getByText('Página 1:', { exact: false })).toBeVisible();

  // Con la MFA "vieja", la página pide confirmar el código antes de mostrar datos.
  await ageMfaVerification(state.admin.email, 10);
  await page.reload();
  await expect(page.getByText('Confirme su código para ver el registro.')).toBeVisible();
  await expectAccessible(page, 'Registro de accesos (requiere código)');
  await page.getByRole('button', { name: 'Confirmar código' }).click();
  const reauth = page.getByRole('dialog', { name: 'Confirme su código de verificación' });
  await reauth.getByLabel('Código de verificación').fill(await nextTotp(state.admin.secret));
  await reauth.getByRole('button', { name: 'Confirmar' }).click();
  await expect(table).toBeVisible();
});
