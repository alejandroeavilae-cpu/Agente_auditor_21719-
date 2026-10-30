// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from './support/fixtures.js';

/**
 * Control de las propias pruebas: la SPA se sirve con la CSP del Caddyfile y la guarda de
 * CSP de las pruebas detecta de verdad un estilo en línea (si no, que las demás pruebas no
 * informen infracciones no demostraría nada).
 */
test('la SPA se sirve con la CSP del Caddyfile y la guarda detecta estilos en línea', async ({ page, state }) => {
  const caddy = readFileSync(join(state.repoRoot, 'deploy/docker/Caddyfile'), 'utf8');
  const expected = /Content-Security-Policy "([^"]+)"/.exec(caddy)?.[1];
  expect(expected).toContain("style-src 'self'");
  const res = await page.goto('/iniciar-sesion');
  expect(res?.headers()['content-security-policy']).toBe(expected);

  // Un <style> inyectado se bloquea y la guarda lo registra.
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = 'body { background: red; }';
    document.head.append(s);
  });
  await expect.poll(() => page.evaluate(() => (window.__cspViolations ?? []).map((v) => v.text))).toEqual([expect.stringContaining('style-src')]);
  // Se limpia para que esta prueba de control no falle por la infracción provocada a propósito.
  await page.evaluate(() => {
    window.__cspViolations = [];
  });
  // El marcador que evita la inyección de React Aria existe en la página servida.
  expect(await page.evaluate(() => document.getElementById('react-aria-pressable-style')?.tagName)).toBe('TEMPLATE');
  expect(await page.evaluate(() => document.querySelectorAll('style').length)).toBe(1);
});
