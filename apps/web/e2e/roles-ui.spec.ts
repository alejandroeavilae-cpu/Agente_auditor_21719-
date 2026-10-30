// SPDX-License-Identifier: AGPL-3.0-or-later

import { createActiveUser, expect, expectAccessible, loginUi, test } from './support/fixtures.js';

/**
 * Permisos entre roles desde la interfaz (2C §2.5): cada rol ve solo lo que le corresponde,
 * y que la interfaz oculte una opción no es el control: la API responde 403 igual.
 */
test('un rol sin permisos de administración no ve el menú ni obtiene datos de la API', async ({ page, state }) => {
  const auditor = await createActiveUser(state, ['auditor'], 'auditora');
  await loginUi(page, auditor);
  await expect(page.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();
  await expect(page.getByText('Auditor', { exact: true }).first()).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(nav.getByRole('link')).toHaveText(['Inicio', 'Mi cuenta']);
  await expectAccessible(page, 'Inicio (Auditor)');

  for (const path of ['/usuarios', '/registro-de-accesos', '/bitacora']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: 'Sin permiso' })).toBeVisible();
  }
  await expectAccessible(page, 'Sin permiso');

  // La API decide: aunque la pantalla se forzara, las rutas responden 403.
  const statuses = await page.evaluate(async () => {
    const paths = ['/api/v1/users', '/api/v1/access-log', '/api/v1/audit-log/export'];
    return Promise.all(paths.map(async (p) => (await fetch(p, { credentials: 'same-origin' })).status));
  });
  expect(statuses).toEqual([403, 403, 403]);
});

test('el administrador ve las opciones de administración', async ({ page, state }) => {
  await loginUi(page, state.admin);
  const nav = page.getByRole('navigation', { name: 'Menú principal' });
  await expect(nav.getByRole('link')).toHaveText(['Inicio', 'Usuarios', 'Registro de accesos', 'Exportar bitácora', 'Mi cuenta']);
  await expect(nav.getByRole('link', { name: 'Inicio' })).toHaveAttribute('aria-current', 'page');
  await expectAccessible(page, 'Inicio (Administrador)');
});
