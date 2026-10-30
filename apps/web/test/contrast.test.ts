// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Contraste de los colores del tema (WCAG 2.x, 1.4.3 y 1.4.11), calculado con la fórmula de
 * luminancia relativa sobre las variables de `src/styles/app.css`. Complementa a axe-core,
 * que solo revisa lo que aparece en pantalla durante las pruebas E2E.
 */
const css = readFileSync(new URL('../src/styles/app.css', import.meta.url), 'utf8');

function variable(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (m?.[1] === undefined) throw new Error(`Falta la variable --${name}`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('contraste del tema (AA)', () => {
  const white = '#ffffff';
  const pairs: [string, string, string, number][] = [
    ['texto sobre fondo', variable('color-text'), variable('color-bg'), 4.5],
    ['texto secundario sobre fondo', variable('color-text-muted'), white, 4.5],
    ['texto secundario sobre superficie', variable('color-text-muted'), variable('color-surface'), 4.5],
    ['enlace y botón secundario', variable('color-primary'), white, 4.5],
    ['texto blanco sobre botón primario', white, variable('color-primary'), 4.5],
    ['texto blanco sobre encabezado', white, variable('color-primary-dark'), 4.5],
    ['error sobre fondo', variable('color-danger'), white, 4.5],
    ['error sobre aviso de error', variable('color-danger'), variable('color-danger-bg'), 4.5],
    ['texto blanco sobre botón de peligro', white, variable('color-danger'), 4.5],
    ['texto sobre aviso de atención', variable('color-text'), variable('color-warning-bg'), 4.5],
    ['texto sobre aviso de éxito', variable('color-text'), variable('color-success-bg'), 4.5],
    ['texto sobre aviso informativo', variable('color-text'), variable('color-info-bg'), 4.5],
    // 1.4.11: bordes de campos y foco (componentes de interfaz) ≥ 3:1.
    ['borde de campos', variable('color-border'), white, 3],
    ['contorno de foco', variable('color-focus'), white, 3],
  ];
  for (const [label, fg, bg, min] of pairs) {
    it(`${label}: ${fg} / ${bg} ≥ ${String(min)}:1`, () => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
    });
  }
});
