// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertTenantSlug, loadPlatformDbConfig, tenantDatabaseName, tenantLoginName } from '../src/index.js';

describe('nombres de recursos', () => {
  it('deriva nombres seguros y predecibles', () => {
    expect(tenantDatabaseName('muni-ejemplo')).toBe('auditor_t_muni_ejemplo');
    expect(tenantLoginName('muni-ejemplo')).toBe('auditor_t_muni_ejemplo_app');
  });
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
  });
});
