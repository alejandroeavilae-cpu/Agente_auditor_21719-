// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertControlDatabaseName, assertTenantName, assertTenantSlug, loadPlatformDbConfig, newTenantResourceNames, tenantResourceNames } from '../src/index.js';

describe('nombres de recursos', () => {
  it('genera nombres opacos, aleatorios y no derivados del identificador', () => {
    expect(tenantResourceNames('0123456789ab')).toEqual({ dbName: 'auditor_t_0123456789ab', login: 'auditor_t_0123456789ab_app' });
    const a = newTenantResourceNames();
    const b = newTenantResourceNames();
    expect(a.dbName).toMatch(/^auditor_t_[0-9a-f]{12}$/);
    expect(a.dbName).not.toBe(b.dbName);
    for (const bad of ['', 'muni-ejemplo', '0123456789AB', '0123456789abc', "x';--"]) {
      expect(() => tenantResourceNames(bad)).toThrow();
    }
  });
  it('valida el nombre visible: recorta espacios y rechaza caracteres de control (B-06)', () => {
    expect(assertTenantName('  Municipalidad Ficticia  ')).toBe('Municipalidad Ficticia');
    for (const bad of ['x', ' a ', 'y'.repeat(201), 'Nombre\u001b[31m', 'Línea\nnueva', 'Nulo\u0000', 'Bidi\u202e']) {
      expect(() => assertTenantName(bad)).toThrow(/caracteres de control/);
    }
  });
  it.each(['postgres', 'template0', 'Template1', 'master', 'MODEL', 'msdb', 'tempdb', 'auditor_t_0123456789ab', 'x;drop'])(
    'rechaza "%s" como base de control (B-08)',
    (name) => {
      expect(() => {
        assertControlDatabaseName(name);
      }).toThrow();
    },
  );
  it.each(['ab', 'A-mayus', 'con espacio', "comilla'", 'x;drop', 'a--b', '-a', 'a-', 'ñandu', 'x'.repeat(31)])('rechaza "%s"', (slug) => {
    expect(() => {
      assertTenantSlug(slug);
    }).toThrow();
  });
});

describe('configuración desde el entorno', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const pwd = join(dir, 'pwd');
  writeFileSync(pwd, 'secreto-sintetico\n');

  it('lee la contraseña desde archivo y aplica valores por defecto', () => {
    const cfg = loadPlatformDbConfig({ DB_ENGINE: 'sqlserver', DB_HOST: 'db', DB_ADMIN_USER: 'sa', DB_ADMIN_PASSWORD_FILE: pwd });
    expect(cfg.admin).toMatchObject({ engine: 'sqlserver', port: 1433, password: 'secreto-sintetico', tls: 'verify' });
    expect(cfg.controlDatabase).toBe('auditor_control');
  });
  it('falla cerrada ante motor desconocido, archivo inexistente o nombre de base inválido', () => {
    expect(() => loadPlatformDbConfig({ DB_ENGINE: 'mysql', DB_HOST: 'x', DB_ADMIN_USER: 'u', DB_ADMIN_PASSWORD_FILE: pwd })).toThrow(/inválida/);
    expect(() => loadPlatformDbConfig({ DB_ENGINE: 'postgresql', DB_HOST: 'x', DB_ADMIN_USER: 'u', DB_ADMIN_PASSWORD_FILE: join(dir, 'no') })).toThrow(/No se pudo leer/);
    expect(() =>
      loadPlatformDbConfig({ DB_ENGINE: 'postgresql', DB_HOST: 'x', DB_ADMIN_USER: 'u', DB_ADMIN_PASSWORD_FILE: pwd, DB_CONTROL_DATABASE: 'x;drop' }),
    ).toThrow(/inválida/);
    expect(() =>
      loadPlatformDbConfig({ DB_ENGINE: 'postgresql', DB_HOST: 'x', DB_ADMIN_USER: 'u', DB_ADMIN_PASSWORD_FILE: pwd, DB_CONTROL_DATABASE: 'postgres' }),
    ).toThrow(/no permitido/);
  });
});
