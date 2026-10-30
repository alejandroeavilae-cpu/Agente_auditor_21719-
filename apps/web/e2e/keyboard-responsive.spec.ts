// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, expectAccessible, loginUi, test } from './support/fixtures.js';
import { nextTotp } from './support/totp.js';

/**
 * Teclado (WCAG 2.1.1, 2.4.3, 2.4.7) y adaptación a pantallas angostas (1.4.10, 320 px sin
 * desplazamiento horizontal de la página). Complementan, sin reemplazar, la revisión manual
 * de QA con teclado y lector de pantalla (R-37).
 */
test('inicio de sesión y diálogos solo con teclado, con el foco visible y devuelto al cerrar', async ({ page, state }) => {
  await page.goto('/iniciar-sesion');
  // El primer Tab lleva al enlace para saltar al contenido.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Saltar al contenido principal' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Correo')).toBeFocused();
  await page.keyboard.type(state.admin.email);
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Contraseña')).toBeFocused();
  await page.keyboard.type(state.admin.password);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Verificación en dos pasos' })).toBeVisible();
  // El campo del código recibe el foco al aparecer.
  await expect(page.getByLabel('Código de verificación')).toBeFocused();
  await page.keyboard.type(await nextTotp(state.admin.secret));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();

  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Usuarios' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Usuarios' })).toBeFocused();
  const trigger = page.getByRole('button', { name: 'Invitar usuario' });
  await trigger.focus();
  // El foco visible usa un contorno propio (no el del navegador por defecto).
  expect(await trigger.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Invitar usuario' });
  await expect(dialog).toBeVisible();
  // El foco queda dentro del diálogo; Escape lo cierra y el foco vuelve al botón.
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('a 320 px de ancho las pantallas no requieren desplazamiento horizontal', async ({ page, state }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const noHorizontalScroll = async (screen: string) => {
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll, `desplazamiento horizontal en "${screen}"`).toBeLessThanOrEqual(client);
  };
  await page.goto('/iniciar-sesion');
  await noHorizontalScroll('Iniciar sesión');
  await loginUi(page, state.admin);
  await expect(page.getByRole('heading', { level: 1, name: /Bienvenida o bienvenido/ })).toBeVisible();
  await noHorizontalScroll('Inicio');
  for (const [path, title] of [
    ['/usuarios', 'Usuarios'],
    ['/registro-de-accesos', 'Registro de accesos'],
    ['/bitacora', 'Exportar bitácora'],
    ['/mi-cuenta', 'Mi cuenta'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await noHorizontalScroll(title);
  }
  await page.goto('/usuarios');
  await page.getByRole('button', { name: 'Invitar usuario' }).click();
  await expect(page.getByRole('dialog', { name: 'Invitar usuario' })).toBeVisible();
  await noHorizontalScroll('Invitar usuario');
  await expectAccessible(page, 'Invitar usuario (320 px)');
});
