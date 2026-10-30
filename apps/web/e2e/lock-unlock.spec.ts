// SPDX-License-Identifier: AGPL-3.0-or-later

import { createActiveUser, expect, expectAccessible, loginUi, test } from './support/fixtures.js';
import { syntheticPassword } from './support/state.js';
import { nextTotp, wrongTotp } from './support/totp.js';

/**
 * Flujo 3 de 2C §2.5: bloqueo y desbloqueo. Cinco códigos MFA errados bloquean la MFA de la
 * cuenta (D-89); el administrador ve el aviso de R-38; al desbloquear, la persona debe
 * cambiar su contraseña en su próximo ingreso (D-93).
 */
test('bloqueo de MFA, aviso R-38, desbloqueo y cambio obligatorio de contraseña', async ({ openPage, state }) => {
  const user = await createActiveUser(state, ['reader'], 'bloqueada');

  // El administrador entra primero: esperar un código TOTP nuevo puede tomar hasta 30 s.
  const admin = await openPage();
  await loginUi(admin, state.admin);
  await expect(admin.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();

  // Quien conoce la contraseña intenta adivinar el código hasta bloquear.
  const attacker = await openPage();
  await attacker.goto('/iniciar-sesion');
  await attacker.getByLabel('Correo').fill(user.email);
  await attacker.getByLabel('Contraseña').fill(user.password);
  await attacker.getByRole('button', { name: 'Ingresar' }).click();
  for (let i = 0; i < 5; i += 1) {
    await attacker.getByLabel('Código de verificación').fill(wrongTotp(user.secret));
    await attacker.getByRole('button', { name: 'Verificar' }).click();
    await expect(attacker.getByRole('alert')).toContainText('Código incorrecto');
  }
  await expectAccessible(attacker, 'Verificación en dos pasos (error)');

  // El administrador ve el bloqueo y el aviso destacado de R-38 (la espera del primer bloqueo
  // es corta, D-82: por eso el administrador ya entró antes del ataque).
  await admin.goto('/usuarios');
  const panel = admin.getByRole('region', { name: 'Atención: posible contraseña comprometida' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Alguien que conoce la contraseña');
  await expect(panel).toContainText(user.email);
  const row = admin.getByRole('row', { name: new RegExp(user.email) });
  await expect(row.getByText(/^MFA bloqueada hasta/)).toBeVisible();
  await expect(row.getByText('Atención: contraseña posiblemente comprometida')).toBeVisible();
  await expectAccessible(admin, 'Usuarios (aviso R-38)');

  // Desbloquear: el diálogo recomienda reiniciar la MFA con enlace.
  await row.getByRole('button', { name: `Desbloquear a ${user.name}` }).click();
  const dialog = admin.getByRole('alertdialog', { name: 'Desbloquear cuenta' });
  await expect(dialog.getByText('Recomendación: reinicie la verificación en dos pasos en vez de solo desbloquear.')).toBeVisible();
  await expectAccessible(admin, 'Desbloquear (recomendación R-38)');
  await dialog.getByRole('button', { name: 'Desbloquear', exact: true }).click();
  await expect(admin.getByText(`Se desbloqueó la cuenta de ${user.name}. En su próximo ingreso deberá cambiar su contraseña.`)).toBeVisible();
  await expect(row.getByText('Debe cambiar su contraseña')).toBeVisible();
  // El panel puede seguir mostrando a otras personas de pruebas anteriores, pero ya no a esta.
  await expect(admin.getByText(user.email)).toHaveCount(1);
  await expect(row.getByText('Atención: contraseña posiblemente comprometida')).toHaveCount(0);

  // La persona entra: tras el código, solo puede cambiar la contraseña (distinta de la actual).
  const owner = await openPage();
  await loginUi(owner, user);
  await expect(owner.getByRole('heading', { level: 1, name: 'Cambie su contraseña para continuar' })).toBeVisible();
  await expect(owner.getByText('Por seguridad, la administración le pide cambiar su contraseña.')).toBeVisible();
  await expectAccessible(owner, 'Cambio obligatorio de contraseña');
  // Cualquier otra pantalla lleva de vuelta al cambio obligatorio.
  await owner.goto('/mi-cuenta');
  await expect(owner.getByRole('heading', { level: 1, name: 'Cambie su contraseña para continuar' })).toBeVisible();
  await owner.getByLabel('Contraseña actual').fill(user.password);
  await owner.getByLabel('Contraseña nueva (obligatorio)', { exact: true }).fill(user.password);
  await owner.getByLabel('Repita la contraseña nueva').fill(user.password);
  await owner.getByRole('button', { name: 'Cambiar contraseña y continuar' }).click();
  await expect(owner.getByText('La nueva contraseña debe ser distinta de la actual.').first()).toBeVisible();
  const fresh = syntheticPassword();
  await owner.getByLabel('Contraseña actual').fill(user.password);
  await owner.getByLabel('Contraseña nueva (obligatorio)', { exact: true }).fill(fresh);
  await owner.getByLabel('Repita la contraseña nueva').fill(fresh);
  await owner.getByRole('button', { name: 'Cambiar contraseña y continuar' }).click();
  await expect(owner.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();

  // La contraseña anterior ya no sirve; la nueva sí.
  await owner.getByRole('button', { name: 'Cerrar sesión' }).first().click();
  await owner.getByLabel('Correo').fill(user.email);
  await owner.getByLabel('Contraseña').fill(user.password);
  await owner.getByRole('button', { name: 'Ingresar' }).click();
  await expect(owner.getByRole('alert')).toContainText('Correo o contraseña incorrectos.');
  await owner.getByLabel('Contraseña').fill(fresh);
  await owner.getByRole('button', { name: 'Ingresar' }).click();
  await owner.getByLabel('Código de verificación').fill(await nextTotp(user.secret));
  await owner.getByRole('button', { name: 'Verificar' }).click();
  await expect(owner.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();
});
