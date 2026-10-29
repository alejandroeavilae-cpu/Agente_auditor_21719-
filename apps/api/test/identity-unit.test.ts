// SPDX-License-Identifier: AGPL-3.0-or-later
// Pruebas de identidad que no requieren base de datos.

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
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
    expect(readCookie(req('a=1; auditor_session=org.tok%2Den'), 'auditor_session')).toBe('org.tok-en');
    expect(readCookie(req('auditor_session=%E0%A4%A'), 'auditor_session')).toBeUndefined();
    expect(readCookie(req('x=1'), 'auditor_session')).toBeUndefined();
  });

  it('familia de navegador sin huella digital', () => {
    expect(userAgentFamily('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toBe('Firefox');
    expect(userAgentFamily('Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0')).toBe('Edge');
    expect(userAgentFamily(null)).toBeNull();
  });

  it('configuración de identidad: opcional, y falla cerrada si es inválida', () => {
    expect(loadIdentityConfig({})).toBeUndefined();
    const dir = mkdtempSync(join(tmpdir(), 'idcfg-'));
    const pwd = join(dir, 'pwd');
    writeFileSync(pwd, 'secreto-sintetico\n');
    const base = { DB_ENGINE: 'postgresql', DB_HOST: 'db', DB_API_USER: 'auditor_api', DB_API_PASSWORD_FILE: pwd, MASTER_KEY_FILE: '/run/secrets/master.key' };
    const cfg = loadIdentityConfig(base);
    expect(cfg).toMatchObject({ cookieSecure: true, accessLogRetentionDays: 90, sensitiveRateLimit: 20, trustProxy: false });
    expect(cfg?.db.admin).toMatchObject({ user: 'auditor_api', password: 'secreto-sintetico', port: 5432 });
    expect(() => loadIdentityConfig({ ...base, DEFAULT_ORGANIZATION: 'Mal Slug' })).toThrow();
    expect(() => loadIdentityConfig({ ...base, COOKIE_SECURE: 'quizas' })).toThrow(/inválida/);
    expect(() => loadIdentityConfig({ ...base, DB_API_PASSWORD_FILE: join(dir, 'no') })).toThrow(/No se pudo leer/);
  });
});
