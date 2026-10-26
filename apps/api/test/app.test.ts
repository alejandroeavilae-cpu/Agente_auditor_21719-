// SPDX-License-Identifier: AGPL-3.0-or-later

import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/app-config.js';

let app: NestExpressApplication | undefined;
let base: string;

beforeAll(async () => {
  const instance = await createApp(loadConfig({ BUILD_COMMIT: 'abc1234', BUILD_VERSION: '0.1.0' }));
  app = instance;
  // Puerto 0: el sistema operativo asigna uno libre para la prueba.
  await instance.listen(0, '127.0.0.1');
  base = await instance.getUrl();
});
afterAll(async () => {
  await app?.close();
});

describe('API Fase 1', () => {
  it('GET /health responde ok sin revelar detalles', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/v1/about expone versión, commit y enlace al código fuente (AGPL §13)', async () => {
    const res = await fetch(`${base}/api/v1/about`);
    const body = (await res.json()) as Record<string, string>;
    expect(body).toMatchObject({ license: 'AGPL-3.0-or-later', commit: 'abc1234' });
    expect(body.sourceForThisVersionUrl).toMatch(/\/tree\/abc1234$/);
  });

  it('aplica cabeceras de seguridad y oculta X-Powered-By', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('rutas inexistentes devuelven 404', async () => {
    const res = await fetch(`${base}/api/v1/no-existe`);
    expect(res.status).toBe(404);
  });
});

describe('configuración', () => {
  it('falla cerrada ante valores inválidos', () => {
    expect(() => loadConfig({ PORT: 'no-numero' })).toThrow(/Configuración inválida/);
    expect(() => loadConfig({ BUILD_COMMIT: 'rama; rm -rf' })).toThrow(/Configuración inválida/);
    expect(() => loadConfig({ SOURCE_URL: 'javascript:alert(1)' })).toThrow(/Configuración inválida/);
    expect(() => loadConfig({ SOURCE_URL: 'http://ejemplo.invalid/repo' })).toThrow(/Configuración inválida/);
    expect(() => loadConfig({ BUILD_VERSION: 'última' })).toThrow(/Configuración inválida/);
  });

  it('escucha solo en 127.0.0.1 por defecto', () => {
    expect(loadConfig({}).HOST).toBe('127.0.0.1');
  });
});
