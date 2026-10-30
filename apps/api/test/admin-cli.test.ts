// SPDX-License-Identifier: AGPL-3.0-or-later
// Códigos de salida de la CLI de administración (hallazgo QA B-05). No requiere base de datos:
// los errores de uso se detectan antes de leer configuración o secretos.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/admin/cli.js';

describe('auditor-admin: códigos de salida', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [['comando-inexistente']],
    [['tenant', 'borrar']],
    [['init', 'extra']],
    [['tenant', 'create', '--slug', 'muni-ejemplo']],
    [['tenant', 'suspend', '--opcion-desconocida', 'x']],
    [['audit', 'export']],
    [['tenant', 'list', 'posicional']],
    [['api-secrets', 'write', '--tenant', 'muni-ejemplo']],
    [['api-secrets', 'write', '--out', '/tmp']],
    [['tenant', 'rotate-password', '--slug', 'x', '--api-secrets-dir', '/tmp']],
  ])('error de uso → 2: %j', async (argv) => {
    expect(await main(argv)).toBe(2);
  });

  it('sin argumentos muestra la ayuda y devuelve 2; --help devuelve 0', async () => {
    expect(await main([])).toBe(2);
    expect(await main(['--help'])).toBe(0);
  });

  it('configuración inválida es un error de operación → 1', async () => {
    const saved = process.env.DB_ENGINE;
    process.env.DB_ENGINE = 'motor-desconocido';
    try {
      expect(await main(['tenant', 'list'])).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.DB_ENGINE;
      else process.env.DB_ENGINE = saved;
    }
  });
});
