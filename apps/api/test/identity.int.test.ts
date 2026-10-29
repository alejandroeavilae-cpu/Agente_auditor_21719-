// SPDX-License-Identifier: AGPL-3.0-or-later
// Pruebas de integración de identidad (2B) contra motores reales, a través de HTTP.
// Solo datos sintéticos. Cada ejecución crea sus cuentas, base de control y organizaciones.

import { randomBytes } from 'node:crypto';
import { parseJsonlLines, toJsonl, verifyChainItems } from '@auditor-21719/audit-log';
import { generateKey } from '@auditor-21719/crypto';
import { totpAt } from '@auditor-21719/identity';
import { connect, provisionerFor, serverAdminDatabase, TenantManager, type DbServerConfig, type TenantDatabase } from '@auditor-21719/persistence';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/app-config.js';
import type { IdentityConfig } from '../src/identity/identity-config.js';
import { IdentityService } from '../src/identity/identity.service.js';
import { base32Decode, Client, createAccounts, engineConfigs, runId } from './db-helpers.js';

const engines = engineConfigs();

if (engines.length === 0) {
  describe('identidad con bases de datos', () => {
    it.skip('sin motores configurados (defina TEST_PG_HOST o TEST_MSSQL_HOST)', () => undefined);
  });
}

// Contraseñas sintéticas generadas en cada ejecución: no hay secretos literales en el código.
const PASSWORD_ADMIN = `sintetica-${randomBytes(9).toString('hex')}`;
const PASSWORD_AUDITOR = `sintetica-${randomBytes(9).toString('hex')}`;
/** Contraseña común conocida (debe rechazarse) y una incorrecta, ambas sintéticas. */
const COMMON_PASSWORD = ['1qaz', '2wsx', '3edc'].join('');
const WRONG_PASSWORD = `incorrecta-${randomBytes(6).toString('hex')}`;

describe.each(engines)('identidad en $engine', ({ engine, server: superServer }) => {
  const id = runId();
  const controlDatabase = `auditor_ctl_api_${id}`;
  const slugA = `org-${id}-a`;
  const slugB = `org-${id}-b`;
  const master = generateKey();
  // Reloj controlable: solo afecta a la lógica de sesiones (vencimientos, TOTP).
  let offsetMs = 0;
  const now = (): Date => new Date(Date.now() + offsetMs);
  const sec = (): number => Math.floor(now().getTime() / 1000);

  let provisioner: TenantManager;
  let apiManager: TenantManager;
  let service: IdentityService;
  let app: NestExpressApplication;
  let base: string;
  let provisionerServer: DbServerConfig;
  const cookieName = 'auditor_session';
  const client = (): Client => new Client(base, cookieName);
  /** Secretos TOTP de los usuarios creados en la prueba. */
  const secrets = new Map<string, Buffer>();
  let adminId = '';
  /** Código TOTP del siguiente paso no usado (evita el rechazo por reuso). */
  const nextCode = (email: string): string => {
    const secret = secrets.get(email);
    if (secret === undefined) throw new Error(`sin secreto para ${email}`);
    // Avanza el reloj al paso siguiente para que el código sea nuevo.
    offsetMs += 30_000;
    return totpAt(secret, sec());
  };

  /** Pasos de limpieza registrados a medida que se crean recursos. */
  const cleanup: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    const accounts = await createAccounts(superServer, id);
    cleanup.push(accounts.drop);
    provisionerServer = accounts.provisioner;
    provisioner = new TenantManager({ admin: accounts.provisioner, controlDatabase }, [master]);
    cleanup.push(async () => {
      // Bases y usuarios de las organizaciones, y la base de control.
      const serverDb = connect<unknown>(provisionerServer, serverAdminDatabase(provisionerServer), 1);
      const p = provisionerFor(engine);
      try {
        const control = connect<{ tenants: { db_name: string; db_user: string } }>(provisionerServer, controlDatabase, 1);
        const rows = await control.selectFrom('tenants').select(['db_name', 'db_user']).execute().catch(() => []);
        await control.destroy();
        await provisioner.close();
        for (const r of rows) {
          await p.dropDatabase(serverDb, r.db_name).catch(() => undefined);
          await p.dropLogin(serverDb, r.db_user).catch(() => undefined);
        }
        await p.dropDatabase(serverDb, controlDatabase).catch(() => undefined);
      } finally {
        await serverDb.destroy();
      }
    });
    await provisioner.initControl({ apiReader: accounts.api.user });
    await provisioner.createTenant(slugA, 'Organización Sintética A', 'operador:pruebas');
    await provisioner.createTenant(slugB, 'Organización Sintética B', 'operador:pruebas');
    apiManager = new TenantManager({ admin: accounts.api, controlDatabase }, [master]);
    cleanup.push(() => apiManager.close());
    service = new IdentityService(apiManager, { accessLogRetentionDays: 90, now });
    const config: IdentityConfig = {
      db: { admin: accounts.api, controlDatabase },
      masterKeyFile: '/no-usado',
      checkMasterKeyPermissions: true,
      defaultOrganization: undefined,
      cookieSecure: false,
      accessLogRetentionDays: 90,
      trustProxy: false,
      sensitiveRateLimit: 100_000,
    };
    app = await createApp(loadConfig({}), { service, config });
    cleanup.push(() => app.close());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(async () => {
    // Se limpia en orden inverso solo lo que alcanzó a crearse (también si beforeAll falló).
    for (const step of cleanup.reverse()) await step().catch(() => undefined);
  });

  it('el primer administrador (CLI) se activa, queda obligado a configurar MFA y la configura', async () => {
    const handle = await provisioner.openTenant(slugA);
    const invited = await service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'Admin@Ejemplo.cl', displayName: 'Admin Sintético', roles: ['org_admin'] }, null);
    adminId = invited.userId;
    const c = client();
    // Contraseña débil: rechazada sin consumir el token.
    expect((await c.request('POST', '/api/v1/auth/activate', { organization: slugA, token: invited.activationToken, password: COMMON_PASSWORD })).body.error).toBe('weak_password');
    const act = await c.request('POST', '/api/v1/auth/activate', { organization: slugA, token: invited.activationToken, password: PASSWORD_ADMIN });
    expect(act.status).toBe(200);
    expect(act.body.stage).toBe('mfa_enroll');
    // El token es de un solo uso.
    expect((await client().request('POST', '/api/v1/auth/activate', { organization: slugA, token: invited.activationToken, password: PASSWORD_ADMIN })).body.error).toBe('invalid_token');
    // Sin MFA no puede usar nada más.
    expect((await c.request('GET', '/api/v1/users')).body.error).toBe('mfa_enrollment_required');
    const enroll = await c.request('POST', '/api/v1/auth/mfa/enroll', {});
    expect(enroll.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const secret = base32Decode(enroll.body.secret as string);
    secrets.set('admin@ejemplo.cl', secret);
    expect((await c.request('POST', '/api/v1/auth/mfa/confirm', { code: '000000' })).body.error).toBe('invalid_code');
    const confirm = await c.request('POST', '/api/v1/auth/mfa/confirm', { code: nextCode('admin@ejemplo.cl') });
    expect(confirm.status).toBe(200);
    expect(confirm.body.stage).toBe('full');
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    const me = await c.request('GET', '/api/v1/auth/me');
    expect(me.body).toMatchObject({ organization: { slug: slugA }, user: { email: 'admin@ejemplo.cl', mfaEnabled: true }, stage: 'full' });
  });

  it('inicio de sesión en dos pasos; los fallos responden igual sin revelar qué dato falló', async () => {
    const generic = { error: 'invalid_credentials', message: 'Organización, correo o contraseña incorrectos.' };
    expect((await client().request('POST', '/api/v1/auth/login', { organization: slugA, email: 'admin@ejemplo.cl', password: WRONG_PASSWORD })).body).toEqual(generic);
    expect((await client().request('POST', '/api/v1/auth/login', { organization: slugA, email: 'nadie@ejemplo.cl', password: PASSWORD_ADMIN })).body).toEqual(generic);
    expect((await client().request('POST', '/api/v1/auth/login', { organization: 'no-existe', email: 'admin@ejemplo.cl', password: PASSWORD_ADMIN })).body).toEqual(generic);
    // La cuenta existe solo en A: en B no inicia sesión (aislamiento).
    expect((await client().request('POST', '/api/v1/auth/login', { organization: slugB, email: 'admin@ejemplo.cl', password: PASSWORD_ADMIN })).body).toEqual(generic);

    const c = client();
    const login = await c.request('POST', '/api/v1/auth/login', { organization: slugA, email: 'ADMIN@ejemplo.cl', password: PASSWORD_ADMIN });
    expect(login.body.stage).toBe('mfa_pending');
    expect((await c.request('GET', '/api/v1/users')).body.error).toBe('mfa_required');
    const code = nextCode('admin@ejemplo.cl');
    const verified = await c.request('POST', '/api/v1/auth/mfa/verify', { code });
    expect(verified.body.stage).toBe('full');
    expect((await c.request('GET', '/api/v1/users')).status).toBe(200);

    // El mismo código no se acepta dos veces (reuso).
    const other = client();
    await other.request('POST', '/api/v1/auth/login', { organization: slugA, email: 'admin@ejemplo.cl', password: PASSWORD_ADMIN });
    expect((await other.request('POST', '/api/v1/auth/mfa/verify', { code })).body.error).toBe('invalid_code');
  });

  it('CSRF: una petición con efectos sin token se rechaza', async () => {
    const c = await loggedAdmin();
    expect((await c.request('POST', '/api/v1/auth/logout', undefined, { csrf: false })).body.error).toBe('csrf');
    c.csrf = 'A'.repeat(43);
    expect((await c.request('POST', '/api/v1/auth/logout')).body.error).toBe('csrf');
  });

  /** Inicia sesión completa como administrador. */
  async function loggedAdmin(): Promise<Client> {
    const c = client();
    await c.request('POST', '/api/v1/auth/login', { organization: slugA, email: 'admin@ejemplo.cl', password: PASSWORD_ADMIN });
    const r = await c.request('POST', '/api/v1/auth/mfa/verify', { code: nextCode('admin@ejemplo.cl') });
    expect(r.body.stage).toBe('full');
    return c;
  }

  let auditorId = '';
  let auditorToken = '';

  it('acciones de alto riesgo exigen MFA reciente (5 min); combinaciones de roles prohibidas', async () => {
    const c = await loggedAdmin();
    offsetMs += 6 * 60_000;
    const body = { email: 'auditora@ejemplo.cl', displayName: 'Auditora Sintética', roles: ['auditor'] };
    expect((await c.request('POST', '/api/v1/users/invitations', body)).body.error).toBe('reauth_required');
    expect((await c.request('POST', '/api/v1/auth/reauth', { code: nextCode('admin@ejemplo.cl') })).status).toBe(204);
    expect((await c.request('POST', '/api/v1/users/invitations', { ...body, roles: ['org_admin', 'legal_reviewer'] })).body.error).toBe('invalid_roles');
    expect((await c.request('POST', '/api/v1/users/invitations', { ...body, extra: 1 })).body.error).toBe('invalid_request');
    const invited = await c.request('POST', '/api/v1/users/invitations', body);
    expect(invited.status).toBe(201);
    auditorId = invited.body.userId as string;
    auditorToken = invited.body.activationToken as string;
    expect((await c.request('POST', '/api/v1/users/invitations', body)).body.error).toBe('email_exists');
  });

  it('un rol sin MFA obligatoria entra directo; RBAC deniega lo que su rol no permite', async () => {
    const a = client();
    const act = await a.request('POST', '/api/v1/auth/activate', { organization: slugA, token: auditorToken, password: PASSWORD_AUDITOR });
    expect(act.body.stage).toBe('full');
    expect((await a.request('GET', '/api/v1/users')).body.error).toBe('forbidden');
    expect((await a.request('PATCH', `/api/v1/users/${auditorId}/roles`, { roles: ['org_admin'] })).body.error).toBe('forbidden');
    expect((await a.request('GET', '/api/v1/auth/me')).body.roles).toEqual([{ id: 'auditor', label: 'Auditor' }]);
  });

  it('aislamiento: una sesión de A con el identificador de B no sirve en B', async () => {
    const c = await loggedAdmin();
    const [, token] = (c.cookie ?? '').split('.');
    const forged = client();
    forged.cookie = `${slugB}.${token ?? ''}`;
    expect((await forged.request('GET', '/api/v1/auth/me')).status).toBe(401);
    forged.cookie = `../${slugA}.${token ?? ''}`;
    expect((await forged.request('GET', '/api/v1/auth/me')).status).toBe(401);
  });

  it('sesión: vence por inactividad (30 min) y por máximo absoluto (12 h)', async () => {
    const idle = await loggedAdmin();
    offsetMs += 31 * 60_000;
    expect((await idle.request('GET', '/api/v1/auth/me')).body.error).toBe('session_expired');
    const active = await loggedAdmin();
    for (let elapsed = 0; elapsed < 12 * 60; elapsed += 25) {
      offsetMs += 25 * 60_000;
      const r = await active.request('GET', '/api/v1/auth/me');
      if (r.status !== 200) {
        expect(r.body.error).toBe('session_expired');
        expect(elapsed + 25).toBeGreaterThanOrEqual(12 * 60);
        return;
      }
    }
    throw new Error('la sesión no venció a las 12 h');
  });

  it('bloqueo progresivo tras 5 fallos; se libera al pasar la espera', async () => {
    for (let i = 0; i < 5; i++) await client().request('POST', '/api/v1/auth/login', { organization: slugA, email: 'auditora@ejemplo.cl', password: `incorrecta-${String(i)}-xx` });
    expect((await client().request('POST', '/api/v1/auth/login', { organization: slugA, email: 'auditora@ejemplo.cl', password: PASSWORD_AUDITOR })).body.error).toBe('invalid_credentials');
    offsetMs += 31_000;
    expect((await client().request('POST', '/api/v1/auth/login', { organization: slugA, email: 'auditora@ejemplo.cl', password: PASSWORD_AUDITOR })).body.stage).toBe('full');
  });

  it('cambiar la contraseña revoca las demás sesiones', async () => {
    const one = client();
    const two = client();
    for (const c of [one, two]) await c.request('POST', '/api/v1/auth/login', { organization: slugA, email: 'auditora@ejemplo.cl', password: PASSWORD_AUDITOR });
    expect((await one.request('POST', '/api/v1/auth/password', { currentPassword: PASSWORD_AUDITOR, newPassword: 'corta' })).body.error).toBe('weak_password');
    const changed = await one.request('POST', '/api/v1/auth/password', { currentPassword: PASSWORD_AUDITOR, newPassword: `${PASSWORD_AUDITOR}-nueva` });
    expect(changed.status).toBe(200);
    expect((await one.request('GET', '/api/v1/auth/me')).status).toBe(200);
    expect((await two.request('GET', '/api/v1/auth/me')).status).toBe(401);
  });

  it('cambiar roles cierra las sesiones del afectado; no se puede quedar sin administrador', async () => {
    const auditor = client();
    await auditor.request('POST', '/api/v1/auth/login', { organization: slugA, email: 'auditora@ejemplo.cl', password: `${PASSWORD_AUDITOR}-nueva` });
    const admin = await loggedAdmin();
    expect((await admin.request('PATCH', `/api/v1/users/${auditorId}/roles`, { roles: ['auditor', 'remediation_owner'] })).status).toBe(204);
    expect((await auditor.request('GET', '/api/v1/auth/me')).status).toBe(401);
    expect((await admin.request('POST', `/api/v1/users/${adminId}/deactivate`)).body.error).toBe('last_admin');
    expect((await admin.request('PATCH', `/api/v1/users/${adminId}/roles`, { roles: ['reader'] })).body.error).toBe('last_admin');
    expect((await admin.request('POST', `/api/v1/users/${adminId}/mfa/reset`)).body.error).toBe('self_mfa_reset');
    expect((await admin.request('POST', '/api/v1/users/no-es-uuid/deactivate')).body.error).toBe('user_not_found');
  });

  it('desactivar un usuario corta su sesión y le impide entrar', async () => {
    const auditor = client();
    await auditor.request('POST', '/api/v1/auth/login', { organization: slugA, email: 'auditora@ejemplo.cl', password: `${PASSWORD_AUDITOR}-nueva` });
    const admin = await loggedAdmin();
    expect((await admin.request('POST', `/api/v1/users/${auditorId}/deactivate`)).status).toBe(204);
    expect((await auditor.request('GET', '/api/v1/auth/me')).status).toBe(401);
    expect((await client().request('POST', '/api/v1/auth/login', { organization: slugA, email: 'auditora@ejemplo.cl', password: `${PASSWORD_AUDITOR}-nueva` })).body.error).toBe('invalid_credentials');
  });

  it('un código de recuperación sirve una sola vez', async () => {
    // Se generan códigos nuevos re-registrando la MFA de un usuario de prueba en B.
    const handle = await provisioner.openTenant(slugB);
    const invited = await service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'admin-b@ejemplo.cl', displayName: 'Admin B', roles: ['org_admin'] }, null);
    const c = client();
    await c.request('POST', '/api/v1/auth/activate', { organization: slugB, token: invited.activationToken, password: PASSWORD_ADMIN });
    const enroll = await c.request('POST', '/api/v1/auth/mfa/enroll', {});
    secrets.set('admin-b@ejemplo.cl', base32Decode(enroll.body.secret as string));
    const confirm = await c.request('POST', '/api/v1/auth/mfa/confirm', { code: nextCode('admin-b@ejemplo.cl') });
    const [recovery] = confirm.body.recoveryCodes as string[];
    const first = client();
    await first.request('POST', '/api/v1/auth/login', { organization: slugB, email: 'admin-b@ejemplo.cl', password: PASSWORD_ADMIN });
    expect((await first.request('POST', '/api/v1/auth/mfa/verify', { recoveryCode: (recovery ?? '').toUpperCase() })).body.stage).toBe('full');
    const second = client();
    await second.request('POST', '/api/v1/auth/login', { organization: slugB, email: 'admin-b@ejemplo.cl', password: PASSWORD_ADMIN });
    expect((await second.request('POST', '/api/v1/auth/mfa/verify', { recoveryCode: recovery })).body.error).toBe('invalid_code');
  });

  it('una organización suspendida rechaza sus sesiones abiertas en la API', async () => {
    const c = client();
    await c.request('POST', '/api/v1/auth/login', { organization: slugB, email: 'admin-b@ejemplo.cl', password: PASSWORD_ADMIN });
    await c.request('POST', '/api/v1/auth/mfa/verify', { code: nextCode('admin-b@ejemplo.cl') });
    expect((await c.request('GET', '/api/v1/auth/me')).status).toBe(200);
    await provisioner.setStatus(slugB, 'suspended', 'operador:pruebas');
    expect((await c.request('GET', '/api/v1/auth/me')).status).toBe(401);
    await provisioner.setStatus(slugB, 'active', 'operador:pruebas');
  });

  it('bitácora: eventos verificables, con IP solo como HMAC; el registro de accesos guarda la IP', async () => {
    const entries = await provisioner.exportAuditLog(slugA);
    const result = verifyChainItems(parseJsonlLines(toJsonl(entries)), slugA);
    expect(result.issues).toEqual([]);
    const actions = new Set(entries.map((e) => e.action));
    for (const a of ['user.invited', 'user.activated', 'auth.mfa.enabled', 'auth.login.failed', 'auth.login.succeeded', 'auth.reauth.succeeded', 'user.roles.changed', 'user.deactivated', 'auth.password.changed']) {
      expect(actions, a).toContain(a);
    }
    const text = toJsonl(entries);
    expect(text).not.toContain('127.0.0.1');
    expect(text).toContain('ipHmac');
    const handle = await provisioner.openTenant(slugA);
    const access = await handle.db.selectFrom('access_log').select(['ip', 'event']).execute();
    expect(access.some((r) => r.ip === '127.0.0.1' || r.ip === '::ffff:127.0.0.1')).toBe(true);
  });

  it('valores centinela: ninguna contraseña, código ni token aparece en la base', async () => {
    const handle = await provisioner.openTenant(slugA);
    const db = connect<TenantDatabase>(provisionerServer, handle.info.dbName, 1);
    const dump: string[] = [];
    for (const table of ['app_user', 'user_session', 'activation_token', 'recovery_code', 'access_log', 'audit_log'] as const) {
      const rows = await db.selectFrom(table).selectAll().execute();
      dump.push(JSON.stringify(rows));
    }
    await db.destroy();
    const all = dump.join('\n');
    for (const secret of [PASSWORD_ADMIN, PASSWORD_AUDITOR, `${PASSWORD_AUDITOR}-nueva`, auditorToken]) {
      expect(all).not.toContain(secret);
    }
    expect(all).not.toContain(secrets.get('admin@ejemplo.cl')?.toString('hex') ?? 'x');
  });

  it('el usuario de la organización sigue sin poder modificar la bitácora', async () => {
    const handle = await apiManager.openTenant(slugA);
    await expect(sql`UPDATE audit_log SET actor = 'x'`.execute(handle.db)).rejects.toThrow();
    await expect(sql`DELETE FROM audit_log`.execute(handle.db)).rejects.toThrow();
  });
});
