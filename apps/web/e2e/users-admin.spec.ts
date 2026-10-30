// SPDX-License-Identifier: AGPL-3.0-or-later

import { ageMfaVerification } from './support/db.js';
import { createActiveUser, expect, expectAccessible, loginUi, setCheckbox, test } from './support/fixtures.js';
import { uid } from './support/state.js';
import { nextTotp } from './support/totp.js';

/**
 * Flujo 2 de 2C §2.5: invitación → cambio de roles (incluida una combinación prohibida,
 * D-79) → desactivación, con reautenticación MFA cuando la API la exige.
 */
test('invitar, cambiar roles (con combinación prohibida) y desactivar, con reautenticación', async ({ page, state }) => {
  await loginUi(page, state.admin);
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Usuarios' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Usuarios' })).toBeVisible();
  await expectAccessible(page, 'Usuarios');

  // Invitar: el enlace se muestra una sola vez, con botón de copiar.
  const email = `invitada-${uid()}@muni-e2e.example`;
  const name = `Persona Invitada ${uid().slice(-4)}`;
  await page.getByRole('button', { name: 'Invitar usuario' }).click();
  const invite = page.getByRole('dialog', { name: 'Invitar usuario' });
  await expect(invite).toBeVisible();
  await invite.getByRole('button', { name: 'Invitar' }).click();
  await expect(invite.getByText('Escriba un correo válido, por ejemplo nombre@institucion.cl.')).toBeVisible();
  await expect(invite.getByText('Elija al menos un rol.')).toBeVisible();
  await expectAccessible(page, 'Invitar usuario (con errores)');
  await invite.getByLabel('Correo').fill(email);
  await invite.getByLabel('Nombre').fill(name);
  await setCheckbox(invite, /^Lector/, true);
  await invite.getByRole('button', { name: 'Invitar' }).click();
  const created = page.getByRole('dialog', { name: 'Invitación creada' });
  await expect(created).toBeVisible();
  const link = await created.getByLabel('Enlace de activación').inputValue();
  expect(link).toMatch(new RegExp(`^${state.webUrl.replace(/[.]/g, '\\.')}/activar#[A-Za-z0-9_-]{43}$`));
  await created.getByRole('button', { name: 'Copiar enlace' }).click();
  await expect(created.getByText('Enlace copiado al portapapeles.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await expectAccessible(page, 'Invitación creada (enlace único)');
  // Escape no cierra el diálogo mientras se muestra el enlace (evita perderlo por accidente).
  await page.keyboard.press('Escape');
  await expect(created).toBeVisible();
  await created.getByRole('button', { name: 'Listo, ya copié el enlace' }).click();
  await expect(created).toBeHidden();
  const row = page.getByRole('row', { name: new RegExp(email) });
  await expect(row.getByText(/^Invitado/)).toBeVisible();

  // Editar roles: combinación prohibida → mensaje de la API; luego una válida.
  await row.getByRole('button', { name: `Editar roles de ${name}` }).click();
  const roles = page.getByRole('dialog', { name: `Editar roles de ${name}` });
  await setCheckbox(roles, /^Administrador de organización/, true);
  await setCheckbox(roles, /^Auditor /, true);
  await expect(roles.getByText('Esta combinación no está permitida.')).toBeVisible();
  await expectAccessible(page, 'Editar roles (combinación prohibida)');
  await roles.getByRole('button', { name: 'Guardar roles' }).click();
  await expect(roles.getByRole('alert').filter({ hasText: 'Separación de funciones: "Administrador de organización" no puede combinarse con "Auditor".' })).toBeVisible();
  await setCheckbox(roles, /^Administrador de organización/, false);
  await setCheckbox(roles, /^Lector/, false);
  await roles.getByRole('button', { name: 'Guardar roles' }).click();
  await expect(page.getByText(`Se actualizaron los roles de ${name}.`)).toBeVisible();
  await expect(row.getByRole('cell', { name: 'Auditor', exact: true })).toBeVisible();

  // Desactivar con MFA "vieja": la API exige reautenticación, la interfaz pide el código y reintenta.
  await ageMfaVerification(state.admin.email, 10);
  await row.getByRole('button', { name: `Desactivar a ${name}` }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Desactivar cuenta' });
  await expectAccessible(page, 'Confirmar desactivación');
  await confirm.getByRole('button', { name: 'Desactivar' }).click();
  const reauth = page.getByRole('dialog', { name: 'Confirme su código de verificación' });
  await expect(reauth).toBeVisible();
  await expectAccessible(page, 'Reautenticación MFA');
  await reauth.getByLabel('Código de verificación').fill('000000');
  await reauth.getByRole('button', { name: 'Confirmar' }).click();
  await expect(reauth.getByRole('alert')).toContainText('Código incorrecto');
  await reauth.getByLabel('Código de verificación').fill(await nextTotp(state.admin.secret));
  await reauth.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText(`Se desactivó la cuenta de ${name}. Sus sesiones se cerraron.`)).toBeVisible();
  await expect(row.getByText('Desactivado', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: `Desactivar a ${name}` })).toHaveCount(0);
});

test('cancelar la reautenticación no ejecuta la acción', async ({ page, state }) => {
  const target = await createActiveUser(state, ['reader'], 'cancelar');
  await loginUi(page, state.admin);
  await page.goto('/usuarios');
  await ageMfaVerification(state.admin.email, 10);
  const row = page.getByRole('row', { name: new RegExp(target.email) });
  await row.getByRole('button', { name: `Desactivar a ${target.name}` }).click();
  await page.getByRole('alertdialog', { name: 'Desactivar cuenta' }).getByRole('button', { name: 'Desactivar' }).click();
  const reauth = page.getByRole('dialog', { name: 'Confirme su código de verificación' });
  await reauth.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Desactivar cuenta' }).getByRole('alert')).toContainText('No se confirmó el código');
  await page.getByRole('alertdialog', { name: 'Desactivar cuenta' }).getByRole('button', { name: 'Cancelar' }).click();
  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(target.email) }).getByText('Activo', { exact: true })).toBeVisible();
});
