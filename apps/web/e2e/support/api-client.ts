// SPDX-License-Identifier: AGPL-3.0-or-later

import { nextTotp } from './totp.js';

/**
 * Cliente HTTP mínimo (Node) para PREPARAR datos de prueba por la API real, más rápido que
 * por la interfaz: invitar, activar y configurar la MFA de usuarios sintéticos. Las pruebas
 * de cada pantalla usan después el navegador. Guarda la cookie de sesión en memoria.
 */
export class ApiClient {
  private cookie: string | null = null;
  private csrf: string | null = null;

  constructor(private readonly baseUrl: string) {}

  async request(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown; headers: Headers }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookie !== null) headers.Cookie = this.cookie;
    if (method !== 'GET' && this.csrf !== null) headers['X-CSRF-Token'] = this.csrf;
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie !== null) {
      const pair = setCookie.split(';')[0] ?? '';
      this.cookie = pair.endsWith('=') ? null : pair;
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      json = text;
    }
    if (typeof json === 'object' && json !== null && 'csrfToken' in json && typeof json.csrfToken === 'string') this.csrf = json.csrfToken;
    return { status: res.status, json, headers: res.headers };
  }

  async expect(method: string, path: string, status: number, body?: unknown): Promise<Record<string, unknown>> {
    const res = await this.request(method, path, body);
    if (res.status !== status) throw new Error(`${method} ${path}: se esperaba ${String(status)} y llegó ${String(res.status)}: ${JSON.stringify(res.json)}`);
    return (res.json ?? {}) as Record<string, unknown>;
  }

  /** Inicio de sesión completo con TOTP (contraseña + código). */
  async login(email: string, password: string, secret: string): Promise<void> {
    await this.expect('POST', '/api/v1/auth/login', 200, { email, password });
    await this.expect('POST', '/api/v1/auth/mfa/verify', 200, { code: await nextTotp(secret) });
  }

  /** Activa una cuenta con su token y configura la MFA. Devuelve el secreto base32. */
  async activateWithMfa(token: string, password: string): Promise<{ secret: string; recoveryCodes: string[] }> {
    await this.expect('POST', '/api/v1/auth/activate', 200, { token, password });
    const enroll = await this.expect('POST', '/api/v1/auth/mfa/enroll', 200, {});
    const secret = String(enroll.secret);
    const confirm = await this.expect('POST', '/api/v1/auth/mfa/confirm', 200, { code: await nextTotp(secret) });
    return { secret, recoveryCodes: confirm.recoveryCodes as string[] };
  }

  /** Reautenticación (MFA reciente) para acciones de alto riesgo. */
  async reauth(secret: string): Promise<void> {
    await this.expect('POST', '/api/v1/auth/reauth', 204, { code: await nextTotp(secret) });
  }

  async invite(email: string, displayName: string, roles: string[]): Promise<{ userId: string; token: string }> {
    const res = await this.expect('POST', '/api/v1/users/invitations', 201, { email, displayName, roles });
    return { userId: String(res.userId), token: String(res.activationToken) };
  }
}
