// SPDX-License-Identifier: AGPL-3.0-or-later
// Pruebas de identidad que no requieren base de datos.

import { randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { encodeKeyForFile, generateKey } from '@auditor-21719/crypto';
import type { ApiSecrets } from '@auditor-21719/persistence';
import { describe, expect, it } from 'vitest';
import { API_SECRET_FILES, writeApiSecrets } from '../src/admin/api-secrets.js';
import { AboutController } from '../src/about/about.controller.js';
import { HealthController } from '../src/health/health.controller.js';
import { AuthController } from '../src/identity/auth.controller.js';
import { readCookie, RateLimiter, ROUTE_POLICY, type RoutePolicy } from '../src/identity/http.js';
import { loadIdentityConfig } from '../src/identity/identity-config.js';
import { userAgentFamily } from '../src/identity/identity.service.js';
import { UsersController } from '../src/identity/users.controller.js';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/app-config.js';

const CONTROLLERS = [HealthController, AboutController, AuthController, UsersController];

describe('denegar por defecto', () => {
  it('toda ruta declara su política de acceso (@Public o @Authenticated)', () => {
    const missing: string[] = [];
    let routes = 0;
    for (const controller of CONTROLLERS) {
      const proto = controller.prototype as unknown as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        routes += 1;
        const policy = (Reflect.getMetadata(ROUTE_POLICY, handler) ?? Reflect.getMetadata(ROUTE_POLICY, controller)) as RoutePolicy | undefined;
        if (policy === undefined) missing.push(`${controller.name}.${name}`);
      }
    }
    expect(routes).toBeGreaterThanOrEqual(15);
    expect(missing).toEqual([]);
  });

  it('las rutas de gestión de usuarios exigen permiso; las de alto riesgo, MFA reciente', () => {
    const proto = UsersController.prototype as unknown as Record<string, object>;
    const policy = (name: string): RoutePolicy => Reflect.getMetadata(ROUTE_POLICY, proto[name] as object) as RoutePolicy;
    expect(policy('list')).toMatchObject({ kind: 'session', permission: 'users.read' });
    for (const name of ['invite', 'setRoles', 'deactivate', 'resetMfa', 'unlock']) {
      expect(policy(name)).toMatchObject({ kind: 'session', permission: 'users.manage', recentMfa: true });
    }
  });
});

describe('API sin identidad configurada', () => {
  it('solo expone salud y versión; las rutas de identidad no existen', async () => {
    const app = await createApp(loadConfig({}));
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200);
      const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found', message: 'Recurso no encontrado.' });
      // Cabeceras de seguridad de §10.4.
      const h = (await fetch(`${base}/health`)).headers;
      expect(h.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(h.get('content-security-policy')).not.toContain('unsafe-inline');
      expect(h.get('cache-control')).toBe('no-store');
    } finally {
      await app.close();
    }
  });
});

describe('utilidades', () => {
  it('límite de tasa por clave con ventana deslizante', () => {
    let t = 0;
    const limiter = new RateLimiter(3, 1000, () => t);
    expect([limiter.allow('ip'), limiter.allow('ip'), limiter.allow('ip'), limiter.allow('ip')]).toEqual([true, true, true, false]);
    expect(limiter.allow('otra')).toBe(true);
    t = 1001;
    expect(limiter.allow('ip')).toBe(true);
  });

  it('lee cookies sin dependencias y tolera valores mal codificados', () => {
    const req = (cookie: string): Parameters<typeof readCookie>[0] => ({ headers: { cookie } }) as Parameters<typeof readCookie>[0];
    expect(readCookie(req('a=1; auditor_session=tok%2Den'), 'auditor_session')).toBe('tok-en');
    expect(readCookie(req('auditor_session=%E0%A4%A'), 'auditor_session')).toBeUndefined();
    expect(readCookie(req('x=1'), 'auditor_session')).toBeUndefined();
  });

  it('familia de navegador sin huella digital', () => {
    expect(userAgentFamily('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('Firefox');
    expect(userAgentFamily('Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('Edge');
    expect(userAgentFamily(null)).toBeNull();
  });

  it('configuración de identidad: opcional, sin clave maestra, y falla cerrada si es inválida (D-87)', () => {
    expect(loadIdentityConfig({})).toBeUndefined();
    const dir = mkdtempSync(join(tmpdir(), 'idcfg-'));
    const dek = generateKey();
    const organization = { id: randomUUID(), slug: 'muni-sintetica', name: 'Municipalidad Sintética', dbName: 'auditor_t_0123456789ab', dbUser: 'auditor_u_0123456789ab', dekId: dek.id };
    writeFileSync(join(dir, 'organization.json'), JSON.stringify(organization), { mode: 0o600 });
    writeFileSync(join(dir, 'pwd'), 'secreto-sintetico\n', { mode: 0o600 });
    writeFileSync(join(dir, 'dek'), encodeKeyForFile(dek), { mode: 0o600 });
    const base = { DB_ENGINE: 'postgresql', DB_HOST: 'db', ORGANIZATION_FILE: join(dir, 'organization.json'), ORGANIZATION_DB_PASSWORD_FILE: join(dir, 'pwd'), ORGANIZATION_DEK_FILE: join(dir, 'dek') };
    const cfg = loadIdentityConfig(base);
    expect(cfg).toMatchObject({ cookieSecure: true, accessLogRetentionDays: 90, sensitiveRateLimit: 20, trustProxy: false, attackAlertThreshold: 20, dbPassword: 'secreto-sintetico' });
    expect(cfg?.server).toEqual({ engine: 'postgresql', host: 'db', port: 5432, tls: 'verify' });
    expect(cfg?.organization).toEqual(organization);
    expect(cfg?.dek.id).toBe(dek.id);
    // Variables de 2B que ya no existen no habilitan nada: sin los archivos nuevos, falla.
    expect(() => loadIdentityConfig({ DB_ENGINE: 'postgresql', DB_HOST: 'db', DB_API_USER: 'auditor_api', MASTER_KEY_FILE: '/x' })).toThrow(/inválida/);
    expect(() => loadIdentityConfig({ ...base, ORGANIZATION_SLUG: 'otra-org' })).toThrow(/no coincide/);
    expect(() => loadIdentityConfig({ ...base, COOKIE_SECURE: 'quizas' })).toThrow(/inválida/);
    expect(() => loadIdentityConfig({ ...base, ORGANIZATION_DB_PASSWORD_FILE: join(dir, 'no') })).toThrow(/No se pudo leer/);
    // Una DEK de otra organización se detecta al arrancar.
    writeFileSync(join(dir, 'otra-dek'), encodeKeyForFile(generateKey()), { mode: 0o600 });
    expect(() => loadIdentityConfig({ ...base, ORGANIZATION_DEK_FILE: join(dir, 'otra-dek') })).toThrow(/no corresponde/);
    // Archivos de secretos legibles por otros: rechazados salvo que se desactive la comprobación (Compose).
    chmodSync(join(dir, 'pwd'), 0o644);
    expect(() => loadIdentityConfig(base)).toThrow(/Permisos inseguros/);
    expect(loadIdentityConfig({ ...base, SECRETS_CHECK_PERMISSIONS: 'false' })?.dbPassword).toBe('secreto-sintetico');
    writeFileSync(join(dir, 'vacio'), '', { mode: 0o600 });
    expect(() => loadIdentityConfig({ ...base, ORGANIZATION_DB_PASSWORD_FILE: join(dir, 'vacio') })).toThrow(/vacío/);
    writeFileSync(join(dir, 'org-mala.json'), JSON.stringify({ ...organization, extra: 1 }), { mode: 0o600 });
    expect(() => loadIdentityConfig({ ...base, ORGANIZATION_FILE: join(dir, 'org-mala.json') })).toThrow(/formato/);
  });
});

describe('api-secrets write: archivos 0600 y escritura atómica', () => {
  const secrets = (): ApiSecrets => {
    const dek = generateKey();
    return { organization: { id: randomUUID(), slug: 'muni-sintetica', name: 'Municipalidad Sintética', dbName: 'auditor_t_0123456789ab', dbUser: 'auditor_u_0123456789ab', dekId: dek.id }, dbPassword: 'secreto-sintetico-1', dek };
  };

  it('escribe los tres archivos con permisos 0600 y la API los lee', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apisec-'));
    const s = secrets();
    writeApiSecrets(dir, s);
    const written = [API_SECRET_FILES.organization, API_SECRET_FILES.dbPassword, API_SECRET_FILES.dek].map((f) => join(dir, f));
    for (const f of written) expect((statSync(f).mode & 0o777).toString(8)).toBe('600');
    const cfg = loadIdentityConfig({ DB_ENGINE: 'sqlserver', DB_HOST: 'db', ORGANIZATION_FILE: written[0], ORGANIZATION_DB_PASSWORD_FILE: written[1], ORGANIZATION_DEK_FILE: written[2] });
    expect(cfg?.organization).toEqual(s.organization);
    expect(cfg?.server.port).toBe(1433);
    // No quedan temporales.
    expect(readdirSync(dir).sort()).toEqual([...Object.values(API_SECRET_FILES)].sort());
  });

  it('reescribir reemplaza un enlace simbólico sin escribir en su destino', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apisec-'));
    const outside = join(mkdtempSync(join(tmpdir(), 'apisec-fuera-')), 'victima');
    writeFileSync(outside, 'original');
    symlinkSync(outside, join(dir, API_SECRET_FILES.dbPassword));
    writeApiSecrets(dir, secrets());
    expect(readFileSync(outside, 'utf8')).toBe('original');
    expect(lstatSync(join(dir, API_SECRET_FILES.dbPassword)).isSymbolicLink()).toBe(false);
  });

  it('rechaza un destino que no es directorio, un enlace o un directorio modificable por el grupo u otros', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apisec-'));
    expect(() => {
      writeApiSecrets(join(dir, 'no-existe'), secrets());
    }).toThrow(/No existe/);
    symlinkSync(dir, join(dir, 'enlace'));
    expect(() => {
      writeApiSecrets(join(dir, 'enlace'), secrets());
    }).toThrow(/no un enlace/);
    // QA 2C1-08: también se rechaza la escritura solo del grupo (0o770) o solo de otros (0o702).
    for (const mode of [0o777, 0o770, 0o702]) {
      const open = join(dir, `abierto-${mode.toString(8)}`);
      mkdirSync(open);
      chmodSync(open, mode);
      expect(() => {
        writeApiSecrets(open, secrets());
      }, mode.toString(8)).toThrow(/otros usuarios o por su grupo/);
    }
    // 0o750 (el grupo solo lee) sí se acepta.
    const readable = join(dir, 'grupo-lee');
    mkdirSync(readable);
    chmodSync(readable, 0o750);
    writeApiSecrets(readable, secrets());
  });
});
