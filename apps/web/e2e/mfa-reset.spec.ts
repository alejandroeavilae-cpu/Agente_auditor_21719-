// SPDX-License-Identifier: AGPL-3.0-or-later

import { createActiveUser, expect, expectAccessible, loginUi, test } from './support/fixtures.js';
import { syntheticPassword } from './support/state.js';
import { nextTotp } from './support/totp.js';

/**
 * Reinicio de MFA con enlace de un solo uso (D-92): invalida la contraseña y las sesiones,
 * muestra el enlace una vez y la persona fija una contraseña nueva (distinta de la anterior)
 * y configura su MFA desde el enlace.
 */
test('reinicio de MFA con enlace: la contraseña anterior deja de servir y la persona se reactiva', async ({ openPage, state }) => {
  const user = await createActiveUser(state, ['remediation_owner'], 'reinicio');

  // La persona tiene una sesión abierta que debe cerrarse con el reinicio.
  const owner = await openPage();
  await loginUi(owner, user);
  await expect(owner.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();

  const admin = await openPage();
  await loginUi(admin, state.admin);
  await admin.goto('/usuarios');
  const row = admin.getByRole('row', { name: new RegExp(user.email) });
  await row.getByRole('button', { name: `Reiniciar MFA de ${user.name}` }).click();
  const confirm = admin.getByRole('alertdialog', { name: 'Reiniciar la verificación en dos pasos' });
  await expect(confirm).toContainText('Su contraseña actual deja de servir');
  await expectAccessible(admin, 'Confirmar reinicio de MFA');
  await confirm.getByRole('button', { name: 'Reiniciar y generar enlace' }).click();
  const done = admin.getByRole('dialog', { name: 'Verificación en dos pasos reiniciada' });
  await expect(done).toBeVisible();
  const link = await done.getByLabel('Enlace de activación').inputValue();
  expect(link).toMatch(/\/activar#[A-Za-z0-9_-]{43}$/);
  await expectAccessible(admin, 'Reinicio de MFA (enlace único)');
  await done.getByRole('button', { name: 'Listo, ya copié el enlace' }).click();
  await expect(row.getByText('Reinicio de MFA pendiente')).toBeVisible();

  // La sesión abierta de la persona se cerró: la siguiente acción la lleva al inicio de sesión.
  await owner.getByRole('link', { name: 'Mi cuenta' }).click();
  await owner.getByLabel('Contraseña actual').fill(user.password);
  const tmp = syntheticPassword();
  await owner.getByLabel('Contraseña nueva (obligatorio)', { exact: true }).fill(tmp);
  await owner.getByLabel('Repita la contraseña nueva').fill(tmp);
  await owner.getByRole('button', { name: 'Cambiar contraseña', exact: true }).click();
  await expect(owner.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();
  await expect(owner.getByText('Debe iniciar sesión para continuar.')).toBeVisible();

  // La contraseña anterior ya no sirve (mensaje genérico).
  await owner.getByLabel('Correo').fill(user.email);
  await owner.getByLabel('Contraseña').fill(user.password);
  await owner.getByRole('button', { name: 'Ingresar' }).click();
  await expect(owner.getByRole('alert')).toContainText('Correo o contraseña incorrectos.');

  // Con el enlace: no acepta la contraseña anterior; sí una nueva, y luego configura la MFA.
  await owner.goto(link.replace(state.webUrl, ''));
  await expect(owner).toHaveURL(/\/activar$/);
  await owner.getByLabel('Contraseña', { exact: false }).first().fill(user.password);
  await owner.getByLabel('Repita la contraseña nueva').fill(user.password);
  await owner.getByRole('button', { name: 'Activar cuenta' }).click();
  await expect(owner.getByText('La nueva contraseña debe ser distinta de la anterior.').first()).toBeVisible();
  const fresh = syntheticPassword();
  await owner.getByLabel('Contraseña', { exact: false }).first().fill(fresh);
  await owner.getByLabel('Repita la contraseña nueva').fill(fresh);
  await owner.getByRole('button', { name: 'Activar cuenta' }).click();
  await expect(owner.getByRole('heading', { level: 1, name: 'Configurar la verificación en dos pasos' })).toBeVisible();
  const secret = (await owner.getByTestId('mfa-secret').innerText()).replace(/\s/g, '');
  expect(secret).not.toBe(user.secret);
  await owner.getByLabel('Código de 6 dígitos de la app').fill(await nextTotp(secret));
  await owner.getByRole('button', { name: 'Confirmar y activar' }).click();
  await owner.getByText('Guardé mis códigos de recuperación en un lugar seguro').click();
  await owner.getByRole('button', { name: 'Continuar' }).click();
  await expect(owner.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();

  // El enlace es de un solo uso.
  await owner.getByRole('button', { name: 'Cerrar sesión' }).first().click();
  await owner.goto(link.replace(state.webUrl, ''));
  await owner.getByLabel('Contraseña', { exact: false }).first().fill(syntheticPassword());
  const again = await owner.getByLabel('Contraseña', { exact: false }).first().inputValue();
  await owner.getByLabel('Repita la contraseña nueva').fill(again);
  await owner.getByRole('button', { name: 'Activar cuenta' }).click();
  await expect(owner.getByRole('alert')).toContainText('El enlace de activación no es válido o expiró.');
  await expectAccessible(owner, 'Activar cuenta (enlace usado)');
});
