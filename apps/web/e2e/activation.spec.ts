// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { adminApi, expect, expectAccessible, loginUi, test } from './support/fixtures.js';
import { syntheticPassword, uid } from './support/state.js';
import { nextTotp } from './support/totp.js';

/**
 * Flujo 1 de 2C §2.5: activación → configurar MFA → inicio de sesión. Recorre además, con
 * axe-core, las pantallas de activación, configuración de MFA, códigos de recuperación,
 * inicio, inicio de sesión y verificación.
 */
test('activación desde el enlace, configuración de MFA con códigos de recuperación e inicio de sesión', async ({ page, state }) => {
  const admin = await adminApi(state);
  const email = `activa-${uid()}@muni-e2e.example`;
  const { token } = await admin.invite(email, 'Persona Activación Sintética', ['reader']);
  const password = syntheticPassword();

  // Enlace inválido: mensaje claro.
  await page.goto('/activar#no-es-un-token');
  await expect(page.getByText('El enlace está incompleto o no es válido.')).toBeVisible();
  await expectAccessible(page, 'Activar cuenta (enlace inválido)');

  // El token va en el fragmento y la pantalla lo borra de la barra de direcciones.
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(`/activar#${token}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Activar cuenta' })).toBeVisible();
  await expect(page).toHaveURL(/\/activar$/);
  expect(await page.evaluate(() => window.location.hash)).toBe('');
  await expectAccessible(page, 'Activar cuenta');

  // Validación local con mensajes en español.
  await page.getByRole('button', { name: 'Activar cuenta' }).click();
  await expect(page.getByText('Escriba la contraseña nueva.').first()).toBeVisible();
  await page.getByLabel('Contraseña', { exact: false }).first().fill('corta');
  await expect(page.getByText('Use al menos 12 caracteres (lleva 5).')).toBeVisible();
  await expectAccessible(page, 'Activar cuenta (con errores e indicador de fortaleza)');

  await page.getByLabel('Contraseña', { exact: false }).first().fill(password);
  await page.getByLabel('Repita la contraseña nueva').fill(password);
  await page.getByRole('button', { name: 'Activar cuenta' }).click();

  // Configurar MFA: QR (SVG propio) y clave en texto.
  await expect(page.getByRole('heading', { level: 1, name: 'Configurar la verificación en dos pasos' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Código QR/ })).toBeVisible();
  const secret = (await page.getByTestId('mfa-secret').innerText()).replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await expectAccessible(page, 'Configurar MFA');
  await page.getByLabel('Código de 6 dígitos de la app').fill('000000');
  await page.getByRole('button', { name: 'Confirmar y activar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'El código no coincide' })).toBeVisible();
  await page.getByLabel('Código de 6 dígitos de la app').fill(await nextTotp(secret));
  await page.getByRole('button', { name: 'Confirmar y activar' }).click();

  // Códigos de recuperación: una sola vez, con descarga .txt y confirmación obligatoria.
  await expect(page.getByRole('heading', { level: 1, name: 'Guarde sus códigos de recuperación' })).toBeVisible();
  const codes = await page.getByRole('list', { name: 'Códigos de recuperación' }).getByRole('listitem').allInnerTexts();
  expect(codes).toHaveLength(10);
  await expectAccessible(page, 'Códigos de recuperación');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar como archivo .txt' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('codigos-recuperacion-auditor-21719.txt');
  const text = readFileSync(await file.path(), 'utf8');
  for (const c of codes) expect(text).toContain(c);
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled();
  await page.getByText('Guardé mis códigos de recuperación en un lugar seguro').click();
  await page.getByRole('button', { name: 'Continuar' }).click();

  // Inicio según el rol (Lector): sin opciones de administración.
  await expect(page.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();
  await expect(page.getByText('llegarán en fases posteriores')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link')).toHaveText(['Inicio', 'Mi cuenta']);
  await expectAccessible(page, 'Inicio (Lector)');

  // Nada sensible en el almacenamiento del navegador; el token no viajó al servidor.
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(requests.filter((u) => u.includes(token))).toEqual([]);

  // Cerrar sesión y volver a entrar con contraseña + código.
  await page.getByRole('button', { name: 'Cerrar sesión' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByText('Cerró su sesión.')).toBeVisible();
  await expectAccessible(page, 'Iniciar sesión');

  // Mensaje único ante credenciales incorrectas.
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill('no-es-la-contraseña-correcta');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Correo o contraseña incorrectos.' })).toBeVisible();
  await expectAccessible(page, 'Iniciar sesión (error)');

  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Verificación en dos pasos' })).toBeVisible();
  await expectAccessible(page, 'Verificación en dos pasos');
  await page.getByLabel('Código de verificación').fill(await nextTotp(secret));
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();

  // Mi cuenta.
  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeFocused();
  await expectAccessible(page, 'Mi cuenta');

  // Un código de recuperación también sirve (una vez).
  await page.getByRole('button', { name: 'Cerrar sesión' }).first().click();
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.getByRole('button', { name: /usar un código de recuperación/ }).click();
  await page.getByLabel('Código de recuperación').fill(codes[0] ?? '');
  await expectAccessible(page, 'Verificación con código de recuperación');
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();
});

test('una sesión recargada recupera el token anti-CSRF desde /me (sin almacenamiento)', async ({ page, state }) => {
  await loginUi(page, state.admin);
  await expect(page.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();
  await page.reload();
  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  // Una ruta inexistente muestra una página clara.
  await page.goto('/no-existe');
  await expect(page.getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeVisible();
  await expectAccessible(page, 'Página no encontrada');
});
