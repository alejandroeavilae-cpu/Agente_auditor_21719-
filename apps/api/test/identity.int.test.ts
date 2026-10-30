// SPDX-License-Identifier: AGPL-3.0-or-later
// Pruebas de integración de identidad (2B, 2C-1 y la API de 2C-2) contra motores reales, a través de HTTP.
// Solo datos sintéticos. Cada ejecución crea sus cuentas, base de control y organizaciones.
//
// Desde 2C-1 cada API atiende UNA organización (D-84, D-75 ajustada) y no tiene la clave
// maestra (D-87): recibe los secretos que escribe `auditor-admin api-secrets write`. Por
// eso hay una API para la organización A y otra para la B.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { parseJsonlLines, toJsonl, verifyChainItems } from '@auditor-21719/audit-log';
import { encodeKeyForFile, generateKey } from '@auditor-21719/crypto';
import { base32Encode, normalizeRecoveryCode, totpAt } from '@auditor-21719/identity';
import { ACCOUNT_ORIGIN, connect, OrganizationDirectory, provisionerFor, serverAdminDatabase, TenantManager, type DbServerConfig, type TenantDatabase } from '@auditor-21719/persistence';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { API_SECRET_FILES, writeApiSecrets } from '../src/admin/api-secrets.js';
import { main as adminCli } from '../src/admin/cli.js';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config/app-config.js';
import { loadIdentityConfig, type IdentityConfig } from '../src/identity/identity-config.js';
import { IdentityService, LOCK_THRESHOLD as LOCK_AT, MIN_FAILURE_MS } from '../src/identity/identity.service.js';
import { base32Decode, Client, createAccounts, engineConfigs, issuedSessionTokens, runId } from './db-helpers.js';

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
const GENERIC_FAILURE = { error: 'invalid_credentials', message: 'Correo o contraseña incorrectos.' };

/** API levantada para una organización, con sus secretos en un directorio temporal. */
interface RunningApi {
  app: NestExpressApplication;
  base: string;
  directory: OrganizationDirectory;
  service: IdentityService;
  config: IdentityConfig;
}

describe.each(engines)('identidad en $engine', ({ engine, server: superServer }) => {
  const id = runId();
  const controlDatabase = `auditor_ctl_api_${id}`;
  const slugA = `org-${id}-a`;
  const slugB = `org-${id}-b`;
  const master = generateKey();
  // Reloj controlable: solo afecta a la lógica de sesiones (vencimientos, TOTP, bloqueos).
  let offsetMs = 0;
  const now = (): Date => new Date(Date.now() + offsetMs);
  const sec = (): number => Math.floor(now().getTime() / 1000);

  let provisioner: TenantManager;
  let provisionerServer: DbServerConfig;
  let apiA: RunningApi;
  let apiB: RunningApi;
  const workDir = mkdtempSync(join(tmpdir(), `auditor-2c1-${id}-`));
  const secretsDirA = join(workDir, 'api-a');
  const secretsDirB = join(workDir, 'api-b');
  const cookieName = 'auditor_session';
  const client = (origin?: string): Client => new Client(apiA.base, cookieName, origin);
  const clientB = (): Client => new Client(apiB.base, cookieName);
  /** Secretos TOTP de los usuarios creados en la prueba. */
  const secrets = new Map<string, Buffer>();
  /** Contraseñas de base y DEK entregadas a las API (no deben aparecer en la base). */
  const apiSecretValues: string[] = [];
  /**
   * Valores sensibles creados en las pruebas (QA 2C1-15): contraseñas locales, tokens de
   * activación y códigos de recuperación. La prueba de valores centinela (la última) revisa
   * que ninguno aparezca en las bases.
   */
  const sentinels: string[] = [];
  /** Contraseña sintética nueva, registrada como valor centinela. */
  const syntheticPassword = (): string => {
    const value = `sintetica-${randomBytes(9).toString('hex')}`;
    sentinels.push(value);
    return value;
  };
  /** Registra los códigos de recuperación entregados (tal cual y normalizados). */
  const keepRecoveryCodes = (codes: unknown): void => {
    for (const code of codes as string[]) sentinels.push(code, normalizeRecoveryCode(code));
  };
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

  /** Variables de la CLI con la cuenta de aprovisionamiento y la clave maestra de la prueba. */
  function cliEnv(): Record<string, string> {
    const passwordFile = join(workDir, 'provisioner_password');
    writeFileSync(passwordFile, `${provisionerServer.password}\n`, { mode: 0o600 });
    const masterFile = join(workDir, 'master.key');
    writeFileSync(masterFile, encodeKeyForFile(master), { mode: 0o600 });
    return {
      DB_ENGINE: engine,
      DB_HOST: provisionerServer.host,
      DB_PORT: String(provisionerServer.port),
      DB_TLS: provisionerServer.tls,
      DB_ADMIN_USER: provisionerServer.user,
      DB_ADMIN_PASSWORD_FILE: passwordFile,
      DB_CONTROL_DATABASE: controlDatabase,
      MASTER_KEY_FILE: masterFile,
      MASTER_KEY_CHECK_PERMISSIONS: 'true',
    };
  }

  /** Ejecuta `auditor-admin` con su entorno, sin ensuciar la salida de la prueba. */
  async function runCli(argv: string[]): Promise<{ code: number; out: string; err: string }> {
    const env = cliEnv();
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    const out: string[] = [];
    const err: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((m: unknown) => void out.push(String(m)));
    const error = vi.spyOn(console, 'error').mockImplementation((m: unknown) => void err.push(String(m)));
    try {
      return { code: await adminCli(argv), out: out.join('\n'), err: err.join('\n') };
    } finally {
      log.mockRestore();
      error.mockRestore();
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) Reflect.deleteProperty(process.env, k);
        else process.env[k] = v;
      }
    }
  }

  /** Configuración de la API leída de los archivos de secretos, como en producción. */
  function apiConfig(slug: string, dir: string, extra: Record<string, string> = {}): IdentityConfig {
    const config = loadIdentityConfig({
      DB_ENGINE: engine,
      DB_HOST: superServer.host,
      DB_PORT: String(superServer.port),
      DB_TLS: superServer.tls,
      ORGANIZATION_FILE: join(dir, API_SECRET_FILES.organization),
      ORGANIZATION_DB_PASSWORD_FILE: join(dir, API_SECRET_FILES.dbPassword),
      ORGANIZATION_DEK_FILE: join(dir, API_SECRET_FILES.dek),
      ORGANIZATION_SLUG: slug,
      COOKIE_SECURE: 'false',
      // Las pruebas simulan orígenes distintos con X-Forwarded-For (un salto de proxy).
      TRUST_PROXY: 'true',
      SENSITIVE_RATE_LIMIT: '100000',
      ...extra,
    });
    if (config === undefined) throw new Error('configuración vacía');
    apiSecretValues.push(config.dbPassword, encodeKeyForFile(config.dek).trim());
    return config;
  }

  async function startApi(config: IdentityConfig): Promise<RunningApi> {
    const directory = new OrganizationDirectory(config.server, config.organization, config.dbPassword, config.dek);
    const service = new IdentityService(directory, { accessLogRetentionDays: 90, attackAlertThreshold: config.attackAlertThreshold, now });
    const app = await createApp(loadConfig({}), { service, config });
    await app.listen(0, '127.0.0.1');
    const running = { app, base: await app.getUrl(), directory, service, config };
    cleanup.push(async () => {
      await app.close();
      await directory.close();
    });
    return running;
  }

  beforeAll(async () => {
    cleanup.push(() => {
      rmSync(workDir, { recursive: true, force: true });
      return Promise.resolve();
    });
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
    await provisioner.initControl();
    await provisioner.createTenant(slugA, 'Organización Sintética A', 'operador:pruebas');
    await provisioner.createTenant(slugB, 'Organización Sintética B', 'operador:pruebas');
    // A: secretos escritos con la CLI real; B: con la función que usa la CLI.
    for (const dir of [secretsDirA, secretsDirB]) mkdirPrivate(dir);
    const written = await runCli(['api-secrets', 'write', '--tenant', slugA, '--out', secretsDirA]);
    expect(written, written.err).toMatchObject({ code: 0 });
    writeApiSecrets(secretsDirB, await provisioner.apiSecrets(slugB, 'operador:pruebas'));
    apiA = await startApi(apiConfig(slugA, secretsDirA));
    apiB = await startApi(apiConfig(slugB, secretsDirB));
  });

  afterAll(async () => {
    // Se limpia en orden inverso solo lo que alcanzó a crearse (también si beforeAll falló).
    for (const step of cleanup.reverse()) await step().catch(() => undefined);
  });

  /** Activa una cuenta invitada y configura su MFA (obligatoria para todos, D-86). */
  async function activateWithMfa(token: string, email: string, password: string, c: Client = client()): Promise<Client> {
    const act = await c.request('POST', '/api/v1/auth/activate', { token, password });
    expect(act.body.stage).toBe('mfa_enroll');
    const enroll = await c.request('POST', '/api/v1/auth/mfa/enroll', {});
    secrets.set(email, base32Decode(enroll.body.secret as string));
    const confirm = await c.request('POST', '/api/v1/auth/mfa/confirm', { code: nextCode(email) });
    expect(confirm.body.stage).toBe('full');
    keepRecoveryCodes(confirm.body.recoveryCodes);
    return c;
  }

  /** Inicio de sesión completo (contraseña + TOTP). */
  async function fullLogin(email: string, password: string, c: Client = client()): Promise<Client> {
    const login = await c.request('POST', '/api/v1/auth/login', { email, password });
    expect(login.body.stage).toBe('mfa_pending');
    const r = await c.request('POST', '/api/v1/auth/mfa/verify', { code: nextCode(email) });
    expect(r.body.stage).toBe('full');
    return c;
  }

  const loggedAdmin = (): Promise<Client> => fullLogin('admin@ejemplo.cl', PASSWORD_ADMIN);

  /** Contadores del par cuenta + origen de un usuario. */
  async function throttleRows(userId: string): Promise<{ origin_hmac: string; kind: string; failed_attempts: number; locked_until: string | null }[]> {
    const handle = await apiA.directory.open();
    return handle.db.selectFrom('login_throttle').select(['origin_hmac', 'kind', 'failed_attempts', 'locked_until']).where('user_id', '=', userId).orderBy('kind').orderBy('origin_hmac').execute();
  }

  it('la API recibe solo los secretos de su organización, con permisos 0600 (D-87)', () => {
    for (const name of Object.values(API_SECRET_FILES)) {
      expect((statSync(join(secretsDirA, name)).mode & 0o777).toString(8), name).toBe('600');
    }
    expect(apiA.config.organization.slug).toBe(slugA);
    expect(apiA.config.dbPassword).not.toBe(apiB.config.dbPassword);
    // La API no tiene clave maestra: su configuración no la incluye.
    expect(JSON.stringify(Object.keys(apiA.config))).not.toMatch(/master/i);
  });

  it('el primer administrador (CLI) se activa, queda obligado a configurar MFA y la configura', async () => {
    const handle = await apiA.directory.open();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'Admin@Ejemplo.cl', displayName: 'Admin Sintético', roles: ['org_admin'] }, null);
    sentinels.push(invited.activationToken);
    adminId = invited.userId;
    const c = client();
    // D-75 ajustada: el campo `organization` ya no existe y se rechaza como cualquier campo no declarado.
    expect((await c.request('POST', '/api/v1/auth/activate', { organization: slugA, token: invited.activationToken, password: PASSWORD_ADMIN })).body.error).toBe('invalid_request');
    // Contraseña débil: rechazada sin consumir el token.
    expect((await c.request('POST', '/api/v1/auth/activate', { token: invited.activationToken, password: COMMON_PASSWORD })).body.error).toBe('weak_password');
    const act = await c.request('POST', '/api/v1/auth/activate', { token: invited.activationToken, password: PASSWORD_ADMIN });
    expect(act.status).toBe(200);
    expect(act.body.stage).toBe('mfa_enroll');
    // La cookie contiene solo el token (sin el prefijo `<slug>.`).
    expect(c.cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // El token es de un solo uso.
    expect((await client().request('POST', '/api/v1/auth/activate', { token: invited.activationToken, password: PASSWORD_ADMIN })).body.error).toBe('invalid_token');
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
    keepRecoveryCodes(confirm.body.recoveryCodes);
    const me = await c.request('GET', '/api/v1/auth/me');
    expect(me.body).toMatchObject({ organization: { slug: slugA }, user: { email: 'admin@ejemplo.cl', mfaEnabled: true }, stage: 'full' });
  });

  it('D-75 ajustada: inicio de sesión con correo y contraseña; los fallos responden igual y tardan al menos 300 ms', async () => {
    expect((await client().request('POST', '/api/v1/auth/login', { email: 'admin@ejemplo.cl', password: WRONG_PASSWORD })).body).toEqual(GENERIC_FAILURE);
    const started = Date.now();
    expect((await client().request('POST', '/api/v1/auth/login', { email: 'nadie@ejemplo.cl', password: PASSWORD_ADMIN })).body).toEqual(GENERIC_FAILURE);
    expect(Date.now() - started).toBeGreaterThanOrEqual(MIN_FAILURE_MS);
    // El campo `organization` se rechaza aunque los datos sean correctos.
    expect((await client().request('POST', '/api/v1/auth/login', { organization: slugA, email: 'admin@ejemplo.cl', password: PASSWORD_ADMIN })).body.error).toBe('invalid_request');
    // La cuenta existe solo en A: la API de B no la conoce (cada instalación, una organización).
    expect((await clientB().request('POST', '/api/v1/auth/login', { email: 'admin@ejemplo.cl', password: PASSWORD_ADMIN })).body).toEqual(GENERIC_FAILURE);

    const c = client();
    const login = await c.request('POST', '/api/v1/auth/login', { email: 'ADMIN@ejemplo.cl', password: PASSWORD_ADMIN });
    expect(login.body.stage).toBe('mfa_pending');
    expect((await c.request('GET', '/api/v1/users')).body.error).toBe('mfa_required');
    const code = nextCode('admin@ejemplo.cl');
    const verified = await c.request('POST', '/api/v1/auth/mfa/verify', { code });
    expect(verified.body.stage).toBe('full');
    expect((await c.request('GET', '/api/v1/users')).status).toBe(200);

    // El mismo código no se acepta dos veces (reuso).
    const other = client();
    await other.request('POST', '/api/v1/auth/login', { email: 'admin@ejemplo.cl', password: PASSWORD_ADMIN });
    expect((await other.request('POST', '/api/v1/auth/mfa/verify', { code })).body.error).toBe('invalid_code');
  });

  it('CSRF: una petición con efectos sin token se rechaza', async () => {
    const c = await loggedAdmin();
    expect((await c.request('POST', '/api/v1/auth/logout', undefined, { csrf: false })).body.error).toBe('csrf');
    c.csrf = 'A'.repeat(43);
    expect((await c.request('POST', '/api/v1/auth/logout')).body.error).toBe('csrf');
  });

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

  it('D-86: un rol sin privilegios también debe configurar la MFA; luego RBAC deniega lo que su rol no permite', async () => {
    const a = client();
    const act = await a.request('POST', '/api/v1/auth/activate', { token: auditorToken, password: PASSWORD_AUDITOR });
    expect(act.body.stage).toBe('mfa_enroll');
    expect((await a.request('GET', '/api/v1/auth/me')).body.stage).toBe('mfa_enroll');
    expect((await a.request('GET', '/api/v1/users')).body.error).toBe('mfa_enrollment_required');
    const enroll = await a.request('POST', '/api/v1/auth/mfa/enroll', {});
    secrets.set('auditora@ejemplo.cl', base32Decode(enroll.body.secret as string));
    expect((await a.request('POST', '/api/v1/auth/mfa/confirm', { code: nextCode('auditora@ejemplo.cl') })).body.stage).toBe('full');
    expect((await a.request('GET', '/api/v1/users')).body.error).toBe('forbidden');
    expect((await a.request('PATCH', `/api/v1/users/${auditorId}/roles`, { roles: ['org_admin'] })).body.error).toBe('forbidden');
    expect((await a.request('GET', '/api/v1/auth/me')).body.roles).toEqual([{ id: 'auditor', label: 'Auditor' }]);
    // Y en el siguiente inicio de sesión debe pasar por la MFA.
    const again = client();
    expect((await again.request('POST', '/api/v1/auth/login', { email: 'auditora@ejemplo.cl', password: PASSWORD_AUDITOR })).body.stage).toBe('mfa_pending');
  });

  it('2C1-06: un usuario sin roles reconocidos también queda obligado a configurar la MFA', async () => {
    const handle = await apiA.directory.open();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'sin-roles@ejemplo.cl', displayName: 'Sin Roles Sintético', roles: ['reader'] }, null);
    sentinels.push(invited.activationToken);
    // Sus roles se reemplazan por uno que la plataforma no reconoce (p. ej. datos alterados).
    await handle.db.deleteFrom('user_role').where('user_id', '=', invited.userId).execute();
    await handle.db.insertInto('user_role').values({ user_id: invited.userId, role: 'rol-desconocido' }).execute();
    const c = client();
    const PASSWORD = syntheticPassword();
    expect((await c.request('POST', '/api/v1/auth/activate', { token: invited.activationToken, password: PASSWORD })).body.stage).toBe('mfa_enroll');
    expect((await c.request('GET', '/api/v1/users')).body.error).toBe('mfa_enrollment_required');
    // Sin ninguna fila de rol, igual.
    await handle.db.deleteFrom('user_role').where('user_id', '=', invited.userId).execute();
    expect((await client().request('POST', '/api/v1/auth/login', { email: 'sin-roles@ejemplo.cl', password: PASSWORD })).body.stage).toBe('mfa_enroll');
  });

  it('una sesión de A no sirve en la API de B, ni con el formato antiguo `<slug>.<token>`', async () => {
    const c = await loggedAdmin();
    const forged = clientB();
    forged.cookie = c.cookie;
    expect((await forged.request('GET', '/api/v1/auth/me')).status).toBe(401);
    const old = client();
    old.cookie = `${slugA}.${c.cookie ?? ''}`;
    expect((await old.request('GET', '/api/v1/auth/me')).status).toBe(401);
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

  it('bloqueo progresivo tras 5 fallos desde un origen; se libera al pasar la espera', async () => {
    for (let i = 0; i < 5; i++) await client().request('POST', '/api/v1/auth/login', { email: 'auditora@ejemplo.cl', password: `incorrecta-${String(i)}-xx` });
    expect((await client().request('POST', '/api/v1/auth/login', { email: 'auditora@ejemplo.cl', password: PASSWORD_AUDITOR })).body.error).toBe('invalid_credentials');
    offsetMs += 31_000;
    expect((await client().request('POST', '/api/v1/auth/login', { email: 'auditora@ejemplo.cl', password: PASSWORD_AUDITOR })).body.stage).toBe('mfa_pending');
  });

  it('cambiar la contraseña revoca las demás sesiones', async () => {
    const one = await fullLogin('auditora@ejemplo.cl', PASSWORD_AUDITOR);
    const two = await fullLogin('auditora@ejemplo.cl', PASSWORD_AUDITOR);
    expect((await one.request('POST', '/api/v1/auth/password', { currentPassword: PASSWORD_AUDITOR, newPassword: 'corta' })).body.error).toBe('weak_password');
    const changed = await one.request('POST', '/api/v1/auth/password', { currentPassword: PASSWORD_AUDITOR, newPassword: `${PASSWORD_AUDITOR}-nueva` });
    expect(changed.status).toBe(200);
    expect((await one.request('GET', '/api/v1/auth/me')).status).toBe(200);
    expect((await two.request('GET', '/api/v1/auth/me')).status).toBe(401);
  });

  it('cambiar roles cierra las sesiones del afectado; no se puede quedar sin administrador', async () => {
    const auditor = await fullLogin('auditora@ejemplo.cl', `${PASSWORD_AUDITOR}-nueva`);
    const admin = await loggedAdmin();
    expect((await admin.request('PATCH', `/api/v1/users/${auditorId}/roles`, { roles: ['auditor', 'remediation_owner'] })).status).toBe(204);
    expect((await auditor.request('GET', '/api/v1/auth/me')).status).toBe(401);
    expect((await admin.request('POST', `/api/v1/users/${adminId}/deactivate`)).body.error).toBe('last_admin');
    expect((await admin.request('PATCH', `/api/v1/users/${adminId}/roles`, { roles: ['reader'] })).body.error).toBe('last_admin');
    expect((await admin.request('POST', `/api/v1/users/${adminId}/mfa/reset`)).body.error).toBe('self_mfa_reset');
    expect((await admin.request('POST', '/api/v1/users/no-es-uuid/deactivate')).body.error).toBe('user_not_found');
  });

  it('desactivar un usuario corta su sesión y le impide entrar', async () => {
    const auditor = await fullLogin('auditora@ejemplo.cl', `${PASSWORD_AUDITOR}-nueva`);
    const admin = await loggedAdmin();
    expect((await admin.request('POST', `/api/v1/users/${auditorId}/deactivate`)).status).toBe(204);
    expect((await auditor.request('GET', '/api/v1/auth/me')).status).toBe(401);
    expect((await client().request('POST', '/api/v1/auth/login', { email: 'auditora@ejemplo.cl', password: `${PASSWORD_AUDITOR}-nueva` })).body).toEqual(GENERIC_FAILURE);
  });

  it('un código de recuperación sirve una sola vez', async () => {
    // Se generan códigos nuevos con un usuario de prueba en B (su propia API).
    const handle = await apiB.directory.open();
    const invited = await apiB.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'admin-b@ejemplo.cl', displayName: 'Admin B', roles: ['org_admin'] }, null);
    sentinels.push(invited.activationToken);
    const c = clientB();
    await c.request('POST', '/api/v1/auth/activate', { token: invited.activationToken, password: PASSWORD_ADMIN });
    const enroll = await c.request('POST', '/api/v1/auth/mfa/enroll', {});
    secrets.set('admin-b@ejemplo.cl', base32Decode(enroll.body.secret as string));
    const confirm = await c.request('POST', '/api/v1/auth/mfa/confirm', { code: nextCode('admin-b@ejemplo.cl') });
    keepRecoveryCodes(confirm.body.recoveryCodes);
    const [recovery] = confirm.body.recoveryCodes as string[];
    const first = clientB();
    await first.request('POST', '/api/v1/auth/login', { email: 'admin-b@ejemplo.cl', password: PASSWORD_ADMIN });
    expect((await first.request('POST', '/api/v1/auth/mfa/verify', { recoveryCode: (recovery ?? '').toUpperCase() })).body.stage).toBe('full');
    const second = clientB();
    await second.request('POST', '/api/v1/auth/login', { email: 'admin-b@ejemplo.cl', password: PASSWORD_ADMIN });
    expect((await second.request('POST', '/api/v1/auth/mfa/verify', { recoveryCode: recovery })).body.error).toBe('invalid_code');
  });

  it('2B-01: el bloqueo resiste intentos en paralelo y no se reinicia al acertar la contraseña', async () => {
    const handle = await apiA.directory.open();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'jefa@ejemplo.cl', displayName: 'Jefa Sintética', roles: ['audit_lead'] }, null);
    sentinels.push(invited.activationToken);
    const PASSWORD = syntheticPassword();
    await activateWithMfa(invited.activationToken, 'jefa@ejemplo.cl', PASSWORD);
    const counter = async (kind: string): Promise<number> => (await throttleRows(invited.userId)).filter((r) => r.kind === kind).reduce((n, r) => n + r.failed_attempts, 0);

    // 30 contraseñas erróneas en paralelo desde el mismo origen: ninguna se pierde antes del
    // bloqueo y el par queda bloqueado; las que llegan con el bloqueo vigente no cuentan.
    await Promise.all(Array.from({ length: 30 }, (_, i) => client().request('POST', '/api/v1/auth/login', { email: 'jefa@ejemplo.cl', password: `${WRONG_PASSWORD}-${String(i)}` })));
    expect(await counter('password')).toBe(LOCK_AT);
    expect((await client().request('POST', '/api/v1/auth/login', { email: 'jefa@ejemplo.cl', password: PASSWORD })).body.error).toBe('invalid_credentials');
    offsetMs += 16 * 60_000; // vence el bloqueo máximo (15 min)
    const ok = client();
    expect((await ok.request('POST', '/api/v1/auth/login', { email: 'jefa@ejemplo.cl', password: PASSWORD })).body.stage).toBe('mfa_pending');
    expect(await counter('password')).toBe(0);
    // /me antes de la MFA no revela datos del usuario (QA 2B-07).
    const pending = await ok.request('GET', '/api/v1/auth/me');
    expect(pending.body.stage).toBe('mfa_pending');
    expect(pending.body.user).toBeUndefined();
    expect(pending.body.roles).toBeUndefined();

    // Ciclos de "contraseña correcta + 4 códigos erróneos": el contador de MFA no se reinicia.
    for (let cycle = 0; cycle < 3; cycle++) {
      const s2 = client();
      await s2.request('POST', '/api/v1/auth/login', { email: 'jefa@ejemplo.cl', password: PASSWORD });
      for (let i = 0; i < 4; i++) await s2.request('POST', '/api/v1/auth/mfa/verify', { code: '000000' });
    }
    expect(await counter('mfa')).toBe(LOCK_AT);
    // Con la MFA de la cuenta bloqueada (D-89), ni el código correcto se acepta.
    const blocked = client();
    expect((await blocked.request('POST', '/api/v1/auth/login', { email: 'jefa@ejemplo.cl', password: PASSWORD })).body.stage).toBe('mfa_pending');
    // Código del paso actual (no usado): `nextCode` avanzaría el reloj justo los 30 s del bloqueo.
    const current = totpAt(secrets.get('jefa@ejemplo.cl') ?? Buffer.alloc(0), sec());
    expect((await blocked.request('POST', '/api/v1/auth/mfa/verify', { code: current })).body.error).toBe('invalid_code');
    offsetMs += 16 * 60_000;
    const after = client();
    await after.request('POST', '/api/v1/auth/login', { email: 'jefa@ejemplo.cl', password: PASSWORD });
    // 20 códigos erróneos en paralelo: a lo sumo uno se evalúa (el que reclama el turno).
    await Promise.all(Array.from({ length: 20 }, () => after.request('POST', '/api/v1/auth/mfa/verify', { code: '000000' })));
    expect((await after.request('POST', '/api/v1/auth/mfa/verify', { code: nextCode('jefa@ejemplo.cl') })).body.error).toBe('invalid_code');
  });

  it('2B-11: los intentos durante un bloqueo no lo alargan; un administrador puede desbloquear', async () => {
    const handle = await apiA.directory.open();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'lectora@ejemplo.cl', displayName: 'Lectora Sintética', roles: ['reader'] }, null);
    sentinels.push(invited.activationToken);
    const PASSWORD = syntheticPassword();
    await client().request('POST', '/api/v1/auth/activate', { token: invited.activationToken, password: PASSWORD });
    // Un "atacante" bloquea el par cuenta + origen con 5 intentos.
    for (let i = 0; i < 5; i++) await client().request('POST', '/api/v1/auth/login', { email: 'lectora@ejemplo.cl', password: `${WRONG_PASSWORD}-${String(i)}` });
    // Solo los contadores (la marca `lock_logged_pw` de QA 2C1-10 es por cuenta, no por origen).
    const counters = async (): Promise<Awaited<ReturnType<typeof throttleRows>>> => (await throttleRows(invited.userId)).filter((r) => r.kind === 'password' || r.kind === 'mfa');
    const locked = await counters();
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({ kind: 'password', failed_attempts: 5 });
    expect(locked[0]?.locked_until).not.toBeNull();
    // La dueña y el atacante insisten durante el bloqueo: no se cuenta ni se alarga.
    for (let i = 0; i < 3; i++) await client().request('POST', '/api/v1/auth/login', { email: 'lectora@ejemplo.cl', password: PASSWORD });
    expect(await counters()).toEqual(locked);
    // El administrador la desbloquea (acción de alto riesgo) y ella entra.
    const admin = await loggedAdmin();
    expect((await admin.request('POST', `/api/v1/users/${invited.userId}/unlock`)).status).toBe(204);
    expect(await counters()).toEqual([]);
    // Sin MFA configurada todavía, su inicio de sesión la lleva a configurarla (D-86).
    expect((await client().request('POST', '/api/v1/auth/login', { email: 'lectora@ejemplo.cl', password: PASSWORD })).body.stage).toBe('mfa_enroll');
    const actions = (await provisioner.exportAuditLog(slugA)).map((e) => e.action);
    expect(actions).toContain('user.unlocked');
  });

  it('R-34: el atacante desde el origen A bloquea solo A; la víctima entra desde B; el paralelo no lo elude', async () => {
    const handle = await apiA.directory.open();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'victima@ejemplo.cl', displayName: 'Víctima Sintética', roles: ['reader'] }, null);
    sentinels.push(invited.activationToken);
    const PASSWORD = syntheticPassword();
    await activateWithMfa(invited.activationToken, 'victima@ejemplo.cl', PASSWORD, client('203.0.113.20'));
    const attacker = (): Client => client('198.51.100.7');
    const victim = (): Client => client('203.0.113.20');
    const attackerRow = async (): Promise<{ failed_attempts: number; locked_until: string | null } | undefined> => {
      const origin = handle.crypto.hmac('login-origin', '198.51.100.7');
      return (await throttleRows(invited.userId)).find((r) => r.origin_hmac === origin && r.kind === 'password');
    };

    for (let i = 0; i < LOCK_AT; i++) await attacker().request('POST', '/api/v1/auth/login', { email: 'victima@ejemplo.cl', password: `${WRONG_PASSWORD}-${String(i)}` });
    const locked = await attackerRow();
    expect(locked?.failed_attempts).toBe(LOCK_AT);
    expect(locked?.locked_until).not.toBeNull();
    // Ráfaga en paralelo desde el origen bloqueado: no cuenta ni alarga la espera.
    await Promise.all(Array.from({ length: 30 }, (_, i) => attacker().request('POST', '/api/v1/auth/login', { email: 'victima@ejemplo.cl', password: `${WRONG_PASSWORD}-p${String(i)}` })));
    expect(await attackerRow()).toEqual(locked);
    // Ni con la contraseña correcta entra desde el origen bloqueado.
    expect((await attacker().request('POST', '/api/v1/auth/login', { email: 'victima@ejemplo.cl', password: PASSWORD })).body).toEqual(GENERIC_FAILURE);
    // La víctima entra desde su propio origen.
    await fullLogin('victima@ejemplo.cl', PASSWORD, victim());

    // Al vencer la espera, de una ráfaga en paralelo se evalúa UN solo intento (D-82).
    offsetMs += 16 * 60_000;
    await Promise.all(Array.from({ length: 20 }, (_, i) => attacker().request('POST', '/api/v1/auth/login', { email: 'victima@ejemplo.cl', password: `${WRONG_PASSWORD}-q${String(i)}` })));
    const relocked = await attackerRow();
    expect(relocked?.failed_attempts).toBe(LOCK_AT + 1);
    expect(new Date(relocked?.locked_until ?? 0).getTime()).toBeGreaterThan(now().getTime());
    expect((await victim().request('POST', '/api/v1/auth/login', { email: 'victima@ejemplo.cl', password: PASSWORD })).body.stage).toBe('mfa_pending');

    // Dos bloqueos del mismo origen en la ventana: la bitácora registra UNO (QA 2C1-10); el
    // registro de accesos, ambos. Los intentos fallidos van solo al registro de accesos.
    const locks = (await provisioner.exportAuditLog(slugA)).filter((e) => e.action === 'auth.account.locked' && e.object === `user/${invited.userId}`);
    expect(locks).toHaveLength(1);
    const accessLocks = await handle.db.selectFrom('access_log').select('ip').where('user_id', '=', invited.userId).where('event', '=', 'auth.account.locked').execute();
    expect(accessLocks).toHaveLength(2);
    // El desbloqueo (CLI) limpia todos los pares de la cuenta.
    expect((await runCli(['user', 'unlock', '--tenant', slugA, '--email', 'victima@ejemplo.cl'])).code).toBe(0);
    expect((await throttleRows(invited.userId)).filter((r) => r.kind === 'password' || r.kind === 'mfa')).toEqual([]);
    expect((await attacker().request('POST', '/api/v1/auth/login', { email: 'victima@ejemplo.cl', password: PASSWORD })).body.stage).toBe('mfa_pending');
  });

  it('R-34: muchos fallos desde orígenes distintos registran UNA alerta de ataque por ventana, sin bloquear la cuenta', async () => {
    const handle = await apiA.directory.open();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'objetivo@ejemplo.cl', displayName: 'Objetivo Sintético', roles: ['reader'] }, null);
    sentinels.push(invited.activationToken);
    const PASSWORD = syntheticPassword();
    await client().request('POST', '/api/v1/auth/activate', { token: invited.activationToken, password: PASSWORD });
    const alerts = async (): Promise<Record<string, unknown>[]> =>
      (await provisioner.exportAuditLog(slugA)).filter((e) => e.action === 'account.attack_suspected' && e.object === `user/${invited.userId}`);
    // 5 orígenes × 4 fallos = 20 (umbral por defecto): ningún origen llega a bloquearse.
    const wave = async (prefix: string, perOrigin: number, origins: number): Promise<void> => {
      for (let o = 0; o < origins; o++) {
        for (let i = 0; i < perOrigin; i++) await client(`${prefix}.${String(o + 1)}`).request('POST', '/api/v1/auth/login', { email: 'objetivo@ejemplo.cl', password: `${WRONG_PASSWORD}-${String(i)}` });
      }
    };
    await wave('198.51.100', 4, 4);
    expect(await alerts()).toHaveLength(0);
    await wave('198.51.101', 4, 1);
    const first = await alerts();
    expect(first).toHaveLength(1);
    expect(first[0]?.data).toMatchObject({ failures: 20, origins: 5, windowMinutes: 60, threshold: 20 });
    // Sin IP en claro en la bitácora.
    expect(JSON.stringify(first)).not.toMatch(/198\.51\.10[01]/);
    // Más fallos en la misma ventana no repiten la alerta.
    await wave('198.51.102', 4, 2);
    expect(await alerts()).toHaveLength(1);
    // La cuenta NO se bloquea: la persona entra desde otro origen.
    expect((await client('203.0.113.30').request('POST', '/api/v1/auth/login', { email: 'objetivo@ejemplo.cl', password: PASSWORD })).body.stage).toBe('mfa_enroll');
    // En la ventana siguiente, un ataque nuevo vuelve a alertar.
    offsetMs += 61 * 60_000;
    await wave('198.51.103', 4, 5);
    expect(await alerts()).toHaveLength(2);
  });

  it('2C1-10: bloquear muchos orígenes deja UN evento de bloqueo por cuenta y ventana en la bitácora; el registro de accesos los anota todos', async () => {
    const handle = await apiA.directory.open();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'muchos-origenes@ejemplo.cl', displayName: 'Cuenta Sintética', roles: ['reader'] }, null);
    sentinels.push(invited.activationToken);
    const PASSWORD = syntheticPassword();
    await client().request('POST', '/api/v1/auth/activate', { token: invited.activationToken, password: PASSWORD });
    const lockFrom = async (origin: string): Promise<void> => {
      for (let i = 0; i < LOCK_AT; i++) await client(origin).request('POST', '/api/v1/auth/login', { email: 'muchos-origenes@ejemplo.cl', password: `${WRONG_PASSWORD}-${String(i)}` });
    };
    const auditLocks = async (): Promise<number> =>
      (await provisioner.exportAuditLog(slugA)).filter((e) => e.action === 'auth.account.locked' && e.object === `user/${invited.userId}`).length;
    const accessLocks = async (): Promise<number> =>
      (await handle.db.selectFrom('access_log').select('id').where('user_id', '=', invited.userId).where('event', '=', 'auth.account.locked').execute()).length;
    for (let o = 1; o <= 6; o++) await lockFrom(`192.0.2.${String(o)}`);
    expect(await accessLocks()).toBe(6);
    expect(await auditLocks()).toBe(1);
    // En la ventana siguiente, un bloqueo nuevo vuelve a registrarse una vez.
    offsetMs += 61 * 60_000;
    await lockFrom('192.0.2.50');
    await lockFrom('192.0.2.51');
    expect(await accessLocks()).toBe(8);
    expect(await auditLocks()).toBe(2);
  });

  it('D-89 (QA 2C1-04, QA-05): 5 códigos MFA errados desde orígenes distintos bloquean la MFA de la cuenta; desbloqueo por API y CLI', async () => {
    const handle = await apiA.directory.open();
    // Administrador con MFA reciente ANTES de provocar el bloqueo: `nextCode` adelanta el reloj
    // 30 s, lo mismo que dura el primer bloqueo, y lo haría vencer.
    const admin = await loggedAdmin();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'mfa-cuenta@ejemplo.cl', displayName: 'MFA por Cuenta', roles: ['reader'] }, null);
    sentinels.push(invited.activationToken);
    const PASSWORD = syntheticPassword();
    const owner = await activateWithMfa(invited.activationToken, 'mfa-cuenta@ejemplo.cl', PASSWORD, client('203.0.113.40'));
    const mfaRows = async (): Promise<Awaited<ReturnType<typeof throttleRows>>> => (await throttleRows(invited.userId)).filter((r) => r.kind === 'mfa');
    /** Código del paso vigente, sin adelantar el reloj (no vence el bloqueo). */
    const currentCode = (): string => totpAt(secrets.get('mfa-cuenta@ejemplo.cl') ?? Buffer.alloc(0), sec());
    /** Sesión `mfa_pending` desde un origen: el atacante conoce la contraseña. */
    const pendingFrom = async (origin: string): Promise<Client> => {
      const c = client(origin);
      expect((await c.request('POST', '/api/v1/auth/login', { email: 'mfa-cuenta@ejemplo.cl', password: PASSWORD })).body.stage).toBe('mfa_pending');
      return c;
    };
    const lockFromOrigins = async (prefix: string): Promise<void> => {
      for (let i = 0; i < LOCK_AT; i++) {
        const c = await pendingFrom(`${prefix}.${String(i + 1)}`);
        expect((await c.request('POST', '/api/v1/auth/mfa/verify', { code: '000000' })).body.error).toBe('invalid_code');
      }
    };
    const mfaLocks = async (): Promise<{ audit: Record<string, unknown>[]; access: number }> => ({
      audit: (await provisioner.exportAuditLog(slugA)).filter((e) => e.action === 'auth.account.locked' && e.object === `user/${invited.userId}`),
      access: (await handle.db.selectFrom('access_log').select('id').where('user_id', '=', invited.userId).where('event', '=', 'auth.account.locked').execute()).length,
    });

    // Paso nuevo (no usado) para la dueña: así el rechazo del código correcto se debe solo al
    // bloqueo y no al reuso del paso, y el mismo código sirve tras desbloquear.
    offsetMs += 30_000;
    // Ronda 1: 5 orígenes distintos, un código errado cada uno (QA-05).
    await lockFromOrigins('198.51.104');
    const rows = await mfaRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin_hmac: ACCOUNT_ORIGIN, failed_attempts: LOCK_AT });
    expect(new Date(rows[0]?.locked_until ?? 0).getTime()).toBeGreaterThan(now().getTime());
    // Ningún origen del atacante quedó con un contador propio de MFA.
    const origins = ['198.51.104.1', '198.51.104.5', '198.51.104.99'].map((ip) => handle.crypto.hmac('login-origin', ip));
    expect((await throttleRows(invited.userId)).some((r) => r.kind === 'mfa' && origins.includes(r.origin_hmac))).toBe(false);
    // Desde un origen nuevo, la contraseña sigue dando `mfa_pending` (bloqueo de contraseña
    // por origen, sin cambios), pero el código CORRECTO se rechaza mientras dure el bloqueo.
    const fresh = await pendingFrom('198.51.104.99');
    expect((await fresh.request('POST', '/api/v1/auth/mfa/verify', { code: currentCode() })).body.error).toBe('invalid_code');
    // Lo mismo desde el origen de la dueña, y en su reautenticación (mismo contador de MFA).
    const ownerPending = await pendingFrom('203.0.113.40');
    expect((await ownerPending.request('POST', '/api/v1/auth/mfa/verify', { code: currentCode() })).body.error).toBe('invalid_code');
    expect((await owner.request('POST', '/api/v1/auth/reauth', { code: currentCode() })).body.error).toBe('invalid_code');
    // Los intentos durante el bloqueo no cuentan ni lo alargan (D-83).
    expect(await mfaRows()).toEqual(rows);
    const blockedEvents = await handle.db.selectFrom('access_log').select('event').where('user_id', '=', invited.userId).where('event', 'in', ['auth.mfa.blocked', 'auth.reauth.blocked']).execute();
    expect(blockedEvents.map((r) => r.event).sort()).toEqual(['auth.mfa.blocked', 'auth.mfa.blocked', 'auth.reauth.blocked']);
    // Bitácora: un bloqueo de MFA con alcance por cuenta (QA 2C1-10: uno por cuenta y ventana).
    const first = await mfaLocks();
    expect(first.audit).toHaveLength(1);
    expect(first.audit[0]?.data).toMatchObject({ counter: 'mfa', scope: 'account' });
    expect(first.access).toBe(1);

    // Desbloqueo por la API: el MISMO código, antes rechazado, ahora entra desde un origen nuevo.
    expect((await admin.request('POST', `/api/v1/users/${invited.userId}/unlock`)).status).toBe(204);
    expect(await mfaRows()).toEqual([]);
    const afterApi = await pendingFrom('198.51.104.100');
    // Desde 2C-2 (R-38): levantar un bloqueo de MFA obliga a cambiar la contraseña, así que
    // el código correcto lleva a la etapa `password_change` (antes, 'full').
    expect((await afterApi.request('POST', '/api/v1/auth/mfa/verify', { code: currentCode() })).body.stage).toBe('password_change');

    // Ronda 2, en la misma ventana de 1 hora: se vuelve a bloquear; desbloqueo por la CLI.
    offsetMs += 30_000;
    await lockFromOrigins('198.51.105');
    expect((await mfaRows())[0]).toMatchObject({ origin_hmac: ACCOUNT_ORIGIN, failed_attempts: LOCK_AT });
    expect((await (await pendingFrom('198.51.105.99')).request('POST', '/api/v1/auth/mfa/verify', { code: currentCode() })).body.error).toBe('invalid_code');
    const second = await mfaLocks();
    expect(second.audit).toHaveLength(1);
    expect(second.access).toBe(2);
    expect((await runCli(['user', 'unlock', '--tenant', slugA, '--email', 'mfa-cuenta@ejemplo.cl'])).code).toBe(0);
    expect(await mfaRows()).toEqual([]);
    expect((await (await pendingFrom('198.51.105.100')).request('POST', '/api/v1/auth/mfa/verify', { code: currentCode() })).body.stage).toBe('password_change');
  });

  it('D-89 + D-82: una ráfaga de códigos desde muchos orígenes no elude el bloqueo de MFA por cuenta ni lleva la espera al tope; reiniciar la MFA lo levanta', async () => {
    const handle = await apiA.directory.open();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'mfa-rafaga@ejemplo.cl', displayName: 'MFA Ráfaga', roles: ['reader'] }, null);
    sentinels.push(invited.activationToken);
    const PASSWORD = syntheticPassword();
    await activateWithMfa(invited.activationToken, 'mfa-rafaga@ejemplo.cl', PASSWORD, client('203.0.113.41'));
    const mfaRows = async (): Promise<Awaited<ReturnType<typeof throttleRows>>> => (await throttleRows(invited.userId)).filter((r) => r.kind === 'mfa');
    const pendingFrom = async (origin: string): Promise<Client> => {
      const c = client(origin);
      expect((await c.request('POST', '/api/v1/auth/login', { email: 'mfa-rafaga@ejemplo.cl', password: PASSWORD })).body.stage).toBe('mfa_pending');
      return c;
    };
    /** Una sesión `mfa_pending` por origen (el inicio de sesión con contraseña no se bloquea). */
    const sessions = async (prefix: string, n: number): Promise<Client[]> => Promise.all(Array.from({ length: n }, (_, i) => pendingFrom(`${prefix}.${String(i + 1)}`)));

    // 30 códigos errados EN PARALELO desde 30 orígenes: ninguno se pierde antes del umbral, se
    // evalúan exactamente 5 y la MFA de la cuenta queda bloqueada.
    const burst = await sessions('198.51.106', 30);
    const results = await Promise.all(burst.map((c) => c.request('POST', '/api/v1/auth/mfa/verify', { code: '000000' })));
    expect(results.every((r) => r.body.error === 'invalid_code')).toBe(true);
    const locked = await mfaRows();
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({ origin_hmac: ACCOUNT_ORIGIN, failed_attempts: LOCK_AT });
    const verified = await handle.db.selectFrom('access_log').select('id').where('user_id', '=', invited.userId).where('event', '=', 'auth.mfa.failed').execute();
    expect(verified).toHaveLength(LOCK_AT);

    // Al vencer la espera (30 s), de una ráfaga de 20 códigos desde 20 orígenes cuenta UNO:
    // el contador pasa a 6 y la espera se duplica (60 s), no salta al tope de 15 min.
    const later = await sessions('198.51.107', 20);
    offsetMs += 31_000;
    await Promise.all(later.map((c) => c.request('POST', '/api/v1/auth/mfa/verify', { code: '000000' })));
    const relocked = await mfaRows();
    expect(relocked[0]?.failed_attempts).toBe(LOCK_AT + 1);
    const remaining = new Date(relocked[0]?.locked_until ?? 0).getTime() - now().getTime();
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(60_000);

    // Restablecer la MFA levanta el bloqueo (D-83). Desde D-92 lo hace con un enlace de un solo
    // uso: la contraseña anterior deja de servir y la persona configura la MFA desde el enlace.
    const admin = await loggedAdmin();
    expect((await admin.request('POST', '/api/v1/auth/reauth', { code: nextCode('admin@ejemplo.cl') })).status).toBe(204);
    const reset = await admin.request('POST', `/api/v1/users/${invited.userId}/mfa/reset`);
    expect(reset.status).toBe(200);
    sentinels.push(reset.body.activationToken as string);
    expect(await mfaRows()).toEqual([]);
    expect((await client('198.51.107.99').request('POST', '/api/v1/auth/login', { email: 'mfa-rafaga@ejemplo.cl', password: PASSWORD })).body).toEqual(GENERIC_FAILURE);
    expect((await client('198.51.107.99').request('POST', '/api/v1/auth/activate', { token: reset.body.activationToken, password: syntheticPassword() })).body.stage).toBe('mfa_enroll');
  });

  // ---------- 2C-2 ----------

  /** Usuario de la prueba R-38 (lo reutiliza la prueba del registro de accesos). */
  let r38UserId = '';

  /** Fila de un usuario en `GET /api/v1/users` (vista del administrador). */
  async function userRow(admin: Client, userId: string): Promise<Record<string, unknown> | undefined> {
    const r = await admin.request('GET', '/api/v1/users');
    expect(r.status).toBe(200);
    return (r.body.users as Record<string, unknown>[]).find((u) => u.id === userId);
  }

  /** Bloquea la MFA de una cuenta con 5 códigos errados desde orígenes distintos (el tercero conoce la contraseña). */
  async function lockMfa(email: string, password: string, prefix: string): Promise<void> {
    for (let i = 0; i < LOCK_AT; i++) {
      const c = client(`${prefix}.${String(i + 1)}`);
      expect((await c.request('POST', '/api/v1/auth/login', { email, password })).body.stage).toBe('mfa_pending');
      expect((await c.request('POST', '/api/v1/auth/mfa/verify', { code: '000000' })).body.error).toBe('invalid_code');
    }
  }

  it('R-38: la lista de usuarios informa los bloqueos y la sospecha de contraseña comprometida; desbloquear un bloqueo de MFA obliga a cambiar la contraseña', async () => {
    const handle = await apiA.directory.open();
    // Administrador con MFA reciente ANTES de los bloqueos (`nextCode` adelanta el reloj 30 s).
    const admin = await loggedAdmin();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'r38@ejemplo.cl', displayName: 'R38 Sintética', roles: ['reader'] }, null);
    sentinels.push(invited.activationToken);
    r38UserId = invited.userId;
    const PASSWORD = syntheticPassword();
    const owner = await activateWithMfa(invited.activationToken, 'r38@ejemplo.cl', PASSWORD, client('203.0.113.60'));
    expect(await userRow(admin, invited.userId)).toMatchObject({
      passwordLock: { lockedOrigins: 0, lockedUntil: null },
      mfaLock: { locked: false, lockedUntil: null, failedAttempts: 0 },
      passwordCompromiseSuspected: false,
      mustChangePassword: false,
    });

    // 1) Un tercero SIN la contraseña bloquea dos orígenes: se informa, sin sospecha de compromiso.
    for (const origin of ['198.51.108.1', '198.51.108.2']) {
      for (let i = 0; i < LOCK_AT; i++) await client(origin).request('POST', '/api/v1/auth/login', { email: 'r38@ejemplo.cl', password: `${WRONG_PASSWORD}-${String(i)}` });
    }
    const pwLocked = await userRow(admin, invited.userId);
    expect(pwLocked).toMatchObject({ passwordLock: { lockedOrigins: 2 }, mfaLock: { locked: false }, passwordCompromiseSuspected: false, mustChangePassword: false });
    expect(Date.parse((pwLocked?.passwordLock as { lockedUntil: string }).lockedUntil)).toBeGreaterThan(now().getTime());
    // Desbloquear un bloqueo solo de contraseña NO obliga a cambiarla.
    expect((await admin.request('POST', `/api/v1/users/${invited.userId}/unlock`)).status).toBe(204);
    expect(await userRow(admin, invited.userId)).toMatchObject({ passwordLock: { lockedOrigins: 0, lockedUntil: null }, mustChangePassword: false });

    // 2) Un tercero CON la contraseña bloquea la MFA de la cuenta (D-89).
    offsetMs += 30_000;
    await lockMfa('r38@ejemplo.cl', PASSWORD, '198.51.109');
    const mfaLocked = await userRow(admin, invited.userId);
    expect(mfaLocked).toMatchObject({ mfaLock: { locked: true, failedAttempts: LOCK_AT }, passwordCompromiseSuspected: true, mustChangePassword: false });
    // Vencida la espera, el bloqueo deja de estar vigente pero la sospecha se mantiene.
    offsetMs += 31_000;
    expect(await userRow(admin, invited.userId)).toMatchObject({ mfaLock: { locked: false, lockedUntil: null, failedAttempts: LOCK_AT }, passwordCompromiseSuspected: true });

    // 3) Desbloqueo por la API: la persona queda obligada a cambiar la contraseña.
    expect((await admin.request('POST', `/api/v1/users/${invited.userId}/unlock`)).status).toBe(204);
    expect(await userRow(admin, invited.userId)).toMatchObject({ mfaLock: { locked: false, failedAttempts: 0 }, passwordCompromiseSuspected: false, mustChangePassword: true });
    // Su sesión completa ya abierta queda limitada al cambio de contraseña.
    const ownerMe = await owner.request('GET', '/api/v1/auth/me');
    expect(ownerMe.body.stage).toBe('password_change');
    expect(ownerMe.body.user).toBeUndefined();
    expect(ownerMe.body.permissions).toBeUndefined();
    expect((await owner.request('GET', '/api/v1/users')).body.error).toBe('password_change_required');

    // El tercero conoce la contraseña pero no el segundo factor: no llega a la etapa de cambio.
    const attacker = client('198.51.109.50');
    expect((await attacker.request('POST', '/api/v1/auth/login', { email: 'r38@ejemplo.cl', password: PASSWORD })).body.stage).toBe('mfa_pending');
    expect((await attacker.request('POST', '/api/v1/auth/mfa/verify', { code: '000000' })).body.error).toBe('invalid_code');
    expect((await attacker.request('POST', '/api/v1/auth/password', { currentPassword: PASSWORD, newPassword: syntheticPassword() })).body.error).toBe('mfa_required');

    // La dueña: contraseña → MFA → SOLO cambio de contraseña, que debe ser distinta.
    const again = client('203.0.113.60');
    expect((await again.request('POST', '/api/v1/auth/login', { email: 'r38@ejemplo.cl', password: PASSWORD })).body.stage).toBe('mfa_pending');
    expect((await again.request('POST', '/api/v1/auth/mfa/verify', { code: nextCode('r38@ejemplo.cl') })).body.stage).toBe('password_change');
    expect((await again.request('GET', '/api/v1/auth/me')).body.stage).toBe('password_change');
    expect((await again.request('GET', '/api/v1/users')).body.error).toBe('password_change_required');
    expect((await again.request('POST', '/api/v1/auth/password', { currentPassword: PASSWORD, newPassword: PASSWORD })).body.error).toBe('password_reused');
    const NEW_PASSWORD = syntheticPassword();
    const changed = await again.request('POST', '/api/v1/auth/password', { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(changed.status).toBe(200);
    expect(changed.body.stage).toBe('full');
    expect((await again.request('GET', '/api/v1/auth/me')).body.stage).toBe('full');
    // Cambiar la contraseña cerró las demás sesiones; la contraseña anterior ya no sirve.
    expect((await owner.request('GET', '/api/v1/auth/me')).status).toBe(401);
    expect((await client('198.51.109.51').request('POST', '/api/v1/auth/login', { email: 'r38@ejemplo.cl', password: PASSWORD })).body).toEqual(GENERIC_FAILURE);
    expect(await userRow(admin, invited.userId)).toMatchObject({ mustChangePassword: false, passwordCompromiseSuspected: false });

    const audit = (await provisioner.exportAuditLog(slugA)).filter((e) => e.object === `user/${invited.userId}`);
    expect(audit.filter((e) => e.action === 'user.unlocked').map((e) => (e.data as Record<string, unknown>).mustChangePassword)).toEqual([false, true]);
    expect(audit.filter((e) => e.action === 'auth.password.changed').map((e) => (e.data as Record<string, unknown>).forced)).toEqual([true]);
  });

  it('D-92: reiniciar la MFA invalida la contraseña y las sesiones y entrega un enlace de un solo uso; con él la persona fija una contraseña nueva y configura la MFA', async () => {
    const handle = await apiA.directory.open();
    const admin = await loggedAdmin();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'd92@ejemplo.cl', displayName: 'D92 Sintética', roles: ['reader'] }, null);
    sentinels.push(invited.activationToken);
    const PASSWORD = syntheticPassword();
    const owner = await activateWithMfa(invited.activationToken, 'd92@ejemplo.cl', PASSWORD, client('203.0.113.61'));
    // Un tercero con la contraseña bloquea la MFA (R-38) y el administrador desbloquea: queda
    // `mustChangePassword`, que la activación posterior debe limpiar.
    offsetMs += 30_000;
    await lockMfa('d92@ejemplo.cl', PASSWORD, '198.51.110');
    expect((await admin.request('POST', `/api/v1/users/${invited.userId}/unlock`)).status).toBe(204);
    expect(await userRow(admin, invited.userId)).toMatchObject({ mustChangePassword: true });
    // La persona tiene además otra sesión abierta (etapa de cambio de contraseña).
    const second = client('203.0.113.62');
    await second.request('POST', '/api/v1/auth/login', { email: 'd92@ejemplo.cl', password: PASSWORD });
    expect((await second.request('POST', '/api/v1/auth/mfa/verify', { code: nextCode('d92@ejemplo.cl') })).body.stage).toBe('password_change');

    // Solo una cuenta activa: una invitación pendiente no se reinicia.
    const pending = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'd92-invitada@ejemplo.cl', displayName: 'D92 Invitada', roles: ['reader'] }, null);
    sentinels.push(pending.activationToken);
    expect((await admin.request('POST', `/api/v1/users/${pending.userId}/mfa/reset`)).body.error).toBe('user_not_active');

    const reset = await admin.request('POST', `/api/v1/users/${invited.userId}/mfa/reset`);
    expect(reset.status).toBe(200);
    expect(Object.keys(reset.body).sort()).toEqual(['activationToken', 'expiresAt']);
    const token = reset.body.activationToken as string;
    sentinels.push(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const ttl = Date.parse(reset.body.expiresAt as string) - now().getTime();
    expect(ttl).toBeGreaterThan(24 * 60 * 60_000 - 60_000);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60_000);
    expect(await userRow(admin, invited.userId)).toMatchObject({ mfaEnabled: false, mfaResetPending: true, passwordCompromiseSuspected: false, mfaLock: { failedAttempts: 0 }, passwordLock: { lockedOrigins: 0 } });

    // Sesiones previas revocadas.
    expect((await owner.request('GET', '/api/v1/auth/me')).status).toBe(401);
    expect((await second.request('GET', '/api/v1/auth/me')).status).toBe(401);
    // La contraseña antigua no da acceso: 401 genérico, sin `mfa_pending` ni cookie, desde cualquier origen.
    for (const origin of ['203.0.113.61', '198.51.110.1']) {
      const c = client(origin);
      const r = await c.request('POST', '/api/v1/auth/login', { email: 'd92@ejemplo.cl', password: PASSWORD });
      expect(r.status).toBe(401);
      expect(r.body).toEqual(GENERIC_FAILURE);
      expect(c.cookie).toBeUndefined();
    }
    // La bitácora registra el reinicio sin el token.
    const resets = (await provisioner.exportAuditLog(slugA)).filter((e) => e.action === 'user.mfa.reset' && e.object === `user/${invited.userId}`);
    expect(resets).toHaveLength(1);
    expect(resets[0]?.data).toMatchObject({ passwordInvalidated: true, activationExpiresAt: reset.body.expiresAt });
    expect(JSON.stringify(resets)).not.toContain(token);

    // Activación con el enlace: no admite la contraseña anterior ni una débil (sin consumir el enlace).
    const c = client('203.0.113.61');
    expect((await c.request('POST', '/api/v1/auth/activate', { token, password: PASSWORD })).body.error).toBe('password_reused');
    expect((await c.request('POST', '/api/v1/auth/activate', { token, password: COMMON_PASSWORD })).body.error).toBe('weak_password');
    const NEW = syntheticPassword();
    expect((await c.request('POST', '/api/v1/auth/activate', { token, password: NEW })).body.stage).toBe('mfa_enroll');
    const previous = secrets.get('d92@ejemplo.cl');
    if (previous !== undefined) sentinels.push(previous.toString('hex'));
    const enroll = await c.request('POST', '/api/v1/auth/mfa/enroll', {});
    secrets.set('d92@ejemplo.cl', base32Decode(enroll.body.secret as string));
    const confirm = await c.request('POST', '/api/v1/auth/mfa/confirm', { code: nextCode('d92@ejemplo.cl') });
    // La activación limpió `must_change_password`: va directo a `full`.
    expect(confirm.body.stage).toBe('full');
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    keepRecoveryCodes(confirm.body.recoveryCodes);
    // Un solo uso.
    expect((await client().request('POST', '/api/v1/auth/activate', { token, password: syntheticPassword() })).body.error).toBe('invalid_token');
    // Con la contraseña nueva entra normalmente.
    await fullLogin('d92@ejemplo.cl', NEW, client('203.0.113.61'));
    expect(await userRow(admin, invited.userId)).toMatchObject({ mfaEnabled: true, mfaResetPending: false, mustChangePassword: false });
    const activated = (await provisioner.exportAuditLog(slugA)).filter((e) => e.action === 'user.activated' && e.object === `user/${invited.userId}`);
    expect(activated.map((e) => (e.data as Record<string, unknown>).via)).toEqual(['invitation', 'mfa_reset']);

    // Un reinicio nuevo reemplaza el enlace anterior, y el enlace vence a las 24 h.
    expect((await admin.request('POST', '/api/v1/auth/reauth', { code: nextCode('admin@ejemplo.cl') })).status).toBe(204);
    const r2 = await admin.request('POST', `/api/v1/users/${invited.userId}/mfa/reset`);
    const r3 = await admin.request('POST', `/api/v1/users/${invited.userId}/mfa/reset`);
    sentinels.push(r2.body.activationToken as string, r3.body.activationToken as string);
    expect((await client().request('POST', '/api/v1/auth/activate', { token: r2.body.activationToken, password: syntheticPassword() })).body.error).toBe('invalid_token');
    offsetMs += 24 * 60 * 60_000 + 60_000;
    expect((await client().request('POST', '/api/v1/auth/activate', { token: r3.body.activationToken, password: syntheticPassword() })).body.error).toBe('invalid_token');
    // Sigue sin poder entrar con la contraseña que tenía antes del segundo reinicio.
    expect((await client().request('POST', '/api/v1/auth/login', { email: 'd92@ejemplo.cl', password: NEW })).body).toEqual(GENERIC_FAILURE);
  });

  it('/me con sesión completa: permisos efectivos y vencimientos de la sesión; sin datos antes de completar la MFA', async () => {
    const admin = await loggedAdmin();
    const me = await admin.request('GET', '/api/v1/auth/me');
    expect(me.body.permissions).toEqual(['access_log.read', 'audit_log.export', 'reports.read', 'users.manage', 'users.read']);
    const session = me.body.session as { expiresAt: string; idleExpiresAt: string; reauthValidUntil: string | null };
    const idleLeft = Date.parse(session.idleExpiresAt) - now().getTime();
    expect(idleLeft).toBeGreaterThan(29 * 60_000);
    expect(idleLeft).toBeLessThanOrEqual(30 * 60_000);
    expect(Date.parse(session.expiresAt)).toBeGreaterThan(Date.parse(session.idleExpiresAt));
    expect(Date.parse(session.reauthValidUntil ?? '')).toBeGreaterThan(now().getTime());
    expect(Date.parse(session.reauthValidUntil ?? '')).toBeLessThanOrEqual(now().getTime() + 5 * 60_000);
    // Un lector solo tiene `reports.read`.
    const handle = await apiA.directory.open();
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'lector-me@ejemplo.cl', displayName: 'Lector Me', roles: ['reader'] }, null);
    sentinels.push(invited.activationToken);
    const reader = await activateWithMfa(invited.activationToken, 'lector-me@ejemplo.cl', syntheticPassword());
    expect((await reader.request('GET', '/api/v1/auth/me')).body.permissions).toEqual(['reports.read']);
    // Antes de la MFA: etapa, token anti-CSRF y vencimiento, sin usuario, roles ni permisos.
    const pending = client();
    await pending.request('POST', '/api/v1/auth/login', { email: 'admin@ejemplo.cl', password: PASSWORD_ADMIN });
    const pre = await pending.request('GET', '/api/v1/auth/me');
    expect(Object.keys(pre.body).sort()).toEqual(['csrfToken', 'organization', 'session', 'stage']);
    expect(Object.keys(pre.body.session as object)).toEqual(['expiresAt']);
  });

  /** Descarga con la cookie del cliente (la respuesta no es JSON). */
  async function download(c: Client, path: string): Promise<Response> {
    return fetch(`${apiA.base}${path}`, { headers: { cookie: `${cookieName}=${encodeURIComponent(c.cookie ?? '')}` } });
  }

  it('registro de accesos: solo el administrador con MFA reciente; filtros, paginación por cursor e IP en claro; la consulta queda en la bitácora sin IP', async () => {
    const handle = await apiA.directory.open();
    // Un rol sin el permiso no ve el registro de accesos ni exporta la bitácora.
    const invited = await apiA.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'lector-logs@ejemplo.cl', displayName: 'Lector Logs', roles: ['reader'] }, null);
    sentinels.push(invited.activationToken);
    const reader = await activateWithMfa(invited.activationToken, 'lector-logs@ejemplo.cl', syntheticPassword());
    expect((await reader.request('GET', '/api/v1/access-log')).body.error).toBe('forbidden');
    expect((await download(reader, '/api/v1/audit-log/export')).status).toBe(403);

    const admin = await loggedAdmin();
    // Alto riesgo: exige MFA de los últimos 5 minutos.
    offsetMs += 6 * 60_000;
    expect((await admin.request('GET', '/api/v1/access-log')).body.error).toBe('reauth_required');
    expect((await admin.request('POST', '/api/v1/auth/reauth', { code: nextCode('admin@ejemplo.cl') })).status).toBe(204);

    // Validación estricta de los parámetros.
    for (const query of ['limit=101', 'limit=0', 'limit=abc', 'otro=1', 'limit=2&limit=3', 'event=Auth.Login', 'event=', 'userId=no-uuid', 'from=ayer', 'from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z']) {
      const r = await admin.request('GET', `/api/v1/access-log?${query}`);
      expect(r.status, query).toBe(400);
      expect(r.body.error, query).toBe('invalid_request');
    }
    for (const cursor of ['@@', Buffer.from('x|y').toString('base64url')]) {
      expect((await admin.request('GET', `/api/v1/access-log?cursor=${encodeURIComponent(cursor)}`)).body.error).toBe('invalid_cursor');
    }

    // Filtro por usuario y evento: bloqueos y fallos de la prueba R-38, con la IP en claro.
    type Item = { id: string; ts: string; event: string; userId: string | null; userEmail: string | null; ip: string | null; uaFamily: string | null };
    const filtered = await admin.request('GET', `/api/v1/access-log?userId=${r38UserId}&event=auth.account.locked,auth.mfa.failed&limit=100`);
    expect(filtered.status).toBe(200);
    const items = filtered.body.events as Item[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((e) => e.userId === r38UserId && e.userEmail === 'r38@ejemplo.cl' && ['auth.account.locked', 'auth.mfa.failed'].includes(e.event))).toBe(true);
    expect(items.some((e) => e.event === 'auth.account.locked' && e.ip === '198.51.108.1')).toBe(true);
    expect(items.some((e) => e.event === 'auth.mfa.failed' && e.ip === '198.51.109.1')).toBe(true);
    expect(items.every((e) => typeof e.uaFamily === 'string')).toBe(true);
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(['event', 'id', 'ip', 'ts', 'uaFamily', 'userEmail', 'userId']);
    // Las alertas de ataque distribuido (R-34) también aparecen.
    const attacks = (await admin.request('GET', '/api/v1/access-log?event=account.attack_suspected')).body.events as Item[];
    expect(attacks.some((e) => e.userEmail === 'objetivo@ejemplo.cl')).toBe(true);

    // Paginación por cursor: recorre todo sin saltos ni repeticiones, de lo reciente a lo antiguo.
    const expected = await handle.db.selectFrom('access_log').select('id').where('user_id', '=', r38UserId).orderBy('ts', 'desc').orderBy('id', 'desc').execute();
    expect(expected.length).toBeGreaterThan(7);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { status: number; body: Record<string, unknown> } = await admin.request('GET', `/api/v1/access-log?userId=${r38UserId}&limit=3${cursor === null ? '' : `&cursor=${cursor}`}`);
      expect(page.status).toBe(200);
      const events = page.body.events as Item[];
      expect(events.length).toBeLessThanOrEqual(3);
      seen.push(...events.map((e) => e.id));
      cursor = page.body.nextCursor as string | null;
      pages += 1;
    } while (cursor !== null && pages < 100);
    expect(seen).toEqual(expected.map((r) => r.id));
    // Rango de fechas: el futuro no tiene eventos.
    const future = await admin.request('GET', `/api/v1/access-log?from=${encodeURIComponent(new Date(now().getTime() + 86_400_000).toISOString())}`);
    expect(future.body).toEqual({ events: [], nextCursor: null });
    // Sin filtros: página por defecto de 50.
    expect(((await admin.request('GET', '/api/v1/access-log')).body.events as Item[]).length).toBe(50);

    // Cada consulta queda en la bitácora (quién miró y con qué filtros), con la IP solo como HMAC;
    // no se anota en el propio registro de accesos.
    const viewed = (await provisioner.exportAuditLog(slugA)).filter((e) => e.action === 'access_log.viewed');
    expect(viewed.length).toBeGreaterThanOrEqual(pages + 4);
    expect(viewed.every((e) => e.actor === `user:${adminId}` && e.object === 'access_log')).toBe(true);
    expect(viewed.some((e) => JSON.stringify(e.data).includes(r38UserId))).toBe(true);
    expect(viewed.every((e) => typeof (e.data as Record<string, unknown>).ipHmac === 'string')).toBe(true);
    expect(JSON.stringify(viewed)).not.toMatch(/127\.0\.0\.1|198\.51\.|203\.0\.113/);
    expect(await handle.db.selectFrom('access_log').select('id').where('event', '=', 'access_log.viewed').execute()).toEqual([]);
  });

  it('exportación de la bitácora: JSON Lines idéntico a la exportación de la CLI y verificable con `auditor-log verify`; cabeceras de descarga; registra audit_log.exported', async () => {
    const admin = await loggedAdmin();
    offsetMs += 6 * 60_000;
    const stale = await download(admin, '/api/v1/audit-log/export');
    expect(stale.status).toBe(403);
    expect(((await stale.json()) as Record<string, unknown>).error).toBe('reauth_required');
    expect((await admin.request('POST', '/api/v1/auth/reauth', { code: nextCode('admin@ejemplo.cl') })).status).toBe(204);
    expect((await download(admin, '/api/v1/audit-log/export?desde=1')).status).toBe(400);

    const res = await download(admin, '/api/v1/audit-log/export');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="bitacora-${slugA}-\\d{8}T\\d{6}Z\\.jsonl"$`));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-audit-chain-id')).toBe(slugA);
    const text = await res.text();
    // Exactamente lo mismo que `auditor-admin audit export` (nada se agregó entre ambas).
    expect(text).toBe(toJsonl(await provisioner.exportAuditLog(slugA)));
    const lines = parseJsonlLines(text);
    expect(lines.length).toBeGreaterThan(100);
    const last = lines.at(-1)?.value as Record<string, unknown>;
    expect(last).toMatchObject({ action: 'audit_log.exported', actor: `user:${adminId}`, object: 'audit_log', data: { format: 'jsonl' } });
    expect(typeof (last.data as Record<string, unknown>).ipHmac).toBe('string');
    expect(text).not.toMatch(/127\.0\.0\.1|198\.51\.|203\.0\.113/);
    expect(verifyChainItems(lines, slugA).issues).toEqual([]);

    // La CLI independiente (el mismo código que usa la institución) la declara íntegra...
    const file = join(workDir, 'bitacora-exportada.jsonl');
    writeFileSync(file, text);
    const cliPath = join(dirname(createRequire(import.meta.url).resolve('@auditor-21719/audit-log')), 'cli.js');
    const ok = spawnSync(process.execPath, [cliPath, 'verify', '--entries', file, '--chain-id', slugA], { encoding: 'utf8' });
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toContain('RESULTADO: bitácora íntegra.');
    // ...y detecta una alteración de una línea intermedia.
    const tampered = text.split('\n');
    tampered[5] = (tampered[5] ?? '').replace(/"actor":"[^"]*"/, '"actor":"alterado"');
    const bad = join(workDir, 'bitacora-alterada.jsonl');
    writeFileSync(bad, tampered.join('\n'));
    const ko = spawnSync(process.execPath, [cliPath, 'verify', '--entries', bad, '--chain-id', slugA], { encoding: 'utf8' });
    expect(ko.status).toBe(1);
    // La exportación también queda en el registro de accesos (con IP, retención de D-78).
    const handle = await apiA.directory.open();
    expect((await handle.db.selectFrom('access_log').select('id').where('event', '=', 'audit_log.exported').execute()).length).toBeGreaterThan(0);
  });

  it('bitácora: eventos verificables, con IP solo como HMAC; el registro de accesos guarda la IP', async () => {
    const entries = await provisioner.exportAuditLog(slugA);
    const result = verifyChainItems(parseJsonlLines(toJsonl(entries)), slugA);
    expect(result.issues).toEqual([]);
    const actions = new Set(entries.map((e) => e.action));
    for (const a of ['access_log.viewed', 'audit_log.exported', 'tenant.api_secrets_written', 'user.invited', 'user.activated', 'auth.mfa.enabled', 'auth.account.locked', 'auth.login.succeeded', 'auth.reauth.succeeded', 'user.roles.changed', 'user.deactivated', 'auth.password.changed', 'account.attack_suspected']) {
      expect(actions, a).toContain(a);
    }
    // Los intentos fallidos van solo al registro de accesos (QA 2B-08).
    expect(actions.has('auth.login.failed')).toBe(false);
    const text = toJsonl(entries);
    expect(text).not.toContain('127.0.0.1');
    expect(text).not.toContain('198.51.100.7');
    expect(text).toContain('ipHmac');
    const handle = await apiA.directory.open();
    const access = await handle.db.selectFrom('access_log').select(['ip', 'event']).execute();
    expect(access.some((r) => r.ip === '127.0.0.1' || r.ip === '::ffff:127.0.0.1')).toBe(true);
    expect(access.some((r) => r.ip === '198.51.100.7')).toBe(true);
    expect(access.some((r) => r.event === 'auth.login.failed')).toBe(true);
    // login_throttle guarda el origen solo como HMAC.
    const throttle = await handle.db.selectFrom('login_throttle').selectAll().execute();
    expect(JSON.stringify(throttle)).not.toMatch(/198\.51\.|203\.0\.113|127\.0\.0\.1/);
  });

  it('cookie de sesión: HttpOnly y SameSite=Strict; con COOKIE_SECURE=true, Secure y prefijo __Host-', async () => {
    const insecure = await fetch(`${apiA.base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@ejemplo.cl', password: PASSWORD_ADMIN }) });
    const plain = insecure.headers.getSetCookie().find((c) => c.startsWith('auditor_session='));
    expect(plain).toBeDefined();
    expect(plain).toMatch(/; HttpOnly/);
    expect(plain).toMatch(/; SameSite=Strict/);
    expect(plain).toMatch(/; Path=\//);
    expect(plain).not.toMatch(/; Secure/);

    // Misma organización y servicio, con la configuración por defecto (COOKIE_SECURE=true).
    const secureApp = await createApp(loadConfig({}), { service: apiA.service, config: { ...apiA.config, cookieSecure: true } });
    try {
      await secureApp.listen(0, '127.0.0.1');
      const res = await fetch(`${await secureApp.getUrl()}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@ejemplo.cl', password: PASSWORD_ADMIN }) });
      expect(res.status).toBe(200);
      const cookies = res.headers.getSetCookie();
      expect(cookies.some((c) => c.startsWith('auditor_session='))).toBe(false);
      const secure = cookies.find((c) => c.startsWith('__Host-auditor_session='));
      expect(secure).toBeDefined();
      const value = decodeURIComponent((secure ?? '').split(';')[0]?.split('=')[1] ?? '');
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
      issuedSessionTokens.add(value);
      for (const attr of [/; HttpOnly/, /; SameSite=Strict/, /; Secure/, /; Path=\//]) expect(secure).toMatch(attr);
      // __Host- exige que no haya Domain.
      expect(secure).not.toMatch(/; Domain=/i);
    } finally {
      await secureApp.close();
    }
  });

  it('2B-03: dos cambios simultáneos no dejan la organización sin administrador', async () => {
    const handle = await apiB.directory.open();
    const second = await apiB.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email: 'admin-b2@ejemplo.cl', displayName: 'Admin B2', roles: ['org_admin'] }, null);
    sentinels.push(second.activationToken);
    const c2 = await activateWithMfa(second.activationToken, 'admin-b2@ejemplo.cl', PASSWORD_ADMIN, clientB());
    const c1 = await fullLogin('admin-b@ejemplo.cl', PASSWORD_ADMIN, clientB());
    const b1 = (await handle.db.selectFrom('app_user').select('id').where('email', '=', 'admin-b@ejemplo.cl').executeTakeFirstOrThrow()).id;
    // B1 desactiva a B2 mientras B2 le quita a B1 el rol de administrador: cada cambio por
    // separado es válido (queda el otro), pero juntos dejarían 0 administradores.
    // Se capturan los errores internos del servidor para diagnosticarlos en CI.
    const logged: string[] = [];
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      logged.push(String(m));
    });
    const [r1, r2] = await Promise.all([c1.request('POST', `/api/v1/users/${second.userId}/deactivate`), c2.request('PATCH', `/api/v1/users/${b1}/roles`, { roles: ['reader'] })]);
    spy.mockRestore();
    expect(logged, `errores internos: ${logged.join(' | ')}`).toEqual([]);
    expect([r1.status, r2.status].filter((x) => x === 204)).toHaveLength(1);
    expect(['last_admin', 'conflict', 'unauthenticated']).toContain([r1, r2].find((r) => r.status !== 204)?.body.error);
    const admins = await handle.db
      .selectFrom('app_user')
      .innerJoin('user_role', 'user_role.user_id', 'app_user.id')
      .select('app_user.id')
      .where('user_role.role', '=', 'org_admin')
      .where('app_user.status', '=', 'active')
      .where('app_user.mfa_secret_sealed', 'is not', null)
      .execute();
    expect(admins).toHaveLength(1);
  });

  it('2B-06: un cuerpo demasiado grande responde 413 sin error interno', async () => {
    const res = await fetch(`${apiA.base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x'.repeat(200_000) }) });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload_too_large', message: 'La solicitud es demasiado grande.' });
  });

  it('el usuario de la organización sigue sin poder modificar la bitácora', async () => {
    const handle = await apiA.directory.open();
    await expect(sql`UPDATE audit_log SET actor = 'x'`.execute(handle.db)).rejects.toThrow();
    await expect(sql`DELETE FROM audit_log`.execute(handle.db)).rejects.toThrow();
  });

  it('D-87 y 2C1-07: rotate-password cierra las conexiones con la contraseña anterior; la API con la nueva funciona y los MFA siguen abriendo', async () => {
    const before = apiA.config.dbPassword;
    // Sesión abierta en la API que todavía usa la contraseña anterior.
    const oldSession = await loggedAdmin();
    expect((await oldSession.request('GET', '/api/v1/auth/me')).status).toBe(200);
    const rotated = await runCli(['tenant', 'rotate-password', '--slug', slugA, '--api-secrets-out', secretsDirA]);
    expect(rotated, rotated.err).toMatchObject({ code: 0 });
    const config = apiConfig(slugA, secretsDirA);
    expect(config.dbPassword).not.toBe(before);
    // Misma DEK: los secretos MFA cifrados antes se siguen abriendo (D-88).
    expect(config.dek.id).toBe(apiA.config.dek.id);
    // QA 2C1-07: la API con la contraseña anterior pierde sus conexiones y no puede abrir
    // otras: falla de forma segura (503), sin seguir operando.
    const stale = await oldSession.request('GET', '/api/v1/auth/me');
    expect(stale.status).toBe(503);
    expect(stale.body.error).toBe('unavailable');
    // "Reinicio" de la API: una instancia nueva con los secretos reescritos.
    const old = apiA;
    apiA = await startApi(config);
    await old.app.close();
    await old.directory.close();
    const c = await loggedAdmin();
    expect((await c.request('GET', '/api/v1/users')).status).toBe(200);
    // La sesión vive en la base: sigue valiendo en la API reiniciada.
    const resumed = client();
    resumed.cookie = oldSession.cookie;
    expect((await resumed.request('GET', '/api/v1/auth/me')).status).toBe(200);
    // Sin --api-secrets-out, la CLI avisa que la API quedará con la contraseña anterior.
    const warned = await runCli(['tenant', 'rotate-password', '--slug', slugB]);
    expect(warned.code).toBe(0);
    expect(warned.err).toMatch(/api-secrets write/);
    writeApiSecrets(secretsDirB, await provisioner.apiSecrets(slugB, 'operador:pruebas'));
    const oldB = apiB;
    apiB = await startApi(apiConfig(slugB, secretsDirB));
    await oldB.app.close();
    await oldB.directory.close();
  });

  it('D-87: al suspender la organización se cierran sus conexiones y la API falla de forma segura', async () => {
    const c = await fullLogin('admin-b@ejemplo.cl', PASSWORD_ADMIN, clientB());
    expect((await c.request('GET', '/api/v1/auth/me')).status).toBe(200);
    const { warnings } = await provisioner.setStatus(slugB, 'suspended', 'operador:pruebas');
    // Sin sesiones abiertas del usuario de la organización tras suspender.
    expect(warnings).toEqual([]);
    const errors: string[] = [];
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      errors.push(String(m));
    });
    try {
      // Diagnóstico (CI de SQL Server): cuánto tarda en fallar. Antes de fijar
      // `propagateCreateError`, el pool de tedious reintentaba la conexión 30 s.
      const t0 = Date.now();
      const me = await c.request('GET', '/api/v1/auth/me');
      const meMs = Date.now() - t0;
      console.info(`[${engine}] /me tras suspender: ${String(me.status)} en ${String(meMs)} ms`);
      expect(meMs, 'la API debe fallar rápido, sin quedar colgada').toBeLessThan(10_000);
      expect(me.status).toBe(503);
      expect(me.body.error).toBe('unavailable');
      expect(Object.keys(me.body).sort()).toEqual(['error', 'message']);
      expect(JSON.stringify(me.body)).not.toMatch(/admin-b|auditor_t_|password|role/i);
      const t1 = Date.now();
      const login = await clientB().request('POST', '/api/v1/auth/login', { email: 'admin-b@ejemplo.cl', password: PASSWORD_ADMIN });
      console.info(`[${engine}] login tras suspender: ${String(login.status)} en ${String(Date.now() - t1)} ms`);
      expect(login.status).toBe(503);
      expect(login.headers.getSetCookie()).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    expect(errors.length).toBeGreaterThan(0);
    // Al reactivar, la API se recupera sola (las sesiones viven en la base).
    await provisioner.setStatus(slugB, 'active', 'operador:pruebas');
    const t2 = Date.now();
    const back = await c.request('GET', '/api/v1/auth/me');
    console.info(`[${engine}] /me tras reactivar: ${String(back.status)} en ${String(Date.now() - t2)} ms`);
    expect(back.status).toBe(200);
    // Plazo propio: suspender espera hasta 5 s a que se cierren las sesiones (waitForNoSessions).
  }, 90_000);

  it('D-92 + D-79: dos administradores que se reinician la MFA mutuamente a la vez no dejan la organización sin administrador con MFA', async () => {
    // En B (la API de A se sigue usando en otras pruebas): dos administradores nuevos y, como
    // preparación sintética, sin el rol de administrador para los demás usuarios de B.
    const handle = await apiB.directory.open();
    const ids: string[] = [];
    const admins: Client[] = [];
    for (const email of ['admin-b3@ejemplo.cl', 'admin-b4@ejemplo.cl']) {
      const invited = await apiB.service.inviteUser(handle, { label: 'operador-plataforma:cli' }, { email, displayName: 'Admin Cruzado', roles: ['org_admin'] }, null);
      sentinels.push(invited.activationToken);
      ids.push(invited.userId);
      admins.push(await activateWithMfa(invited.activationToken, email, syntheticPassword(), clientB()));
    }
    await handle.db.deleteFrom('user_role').where('role', '=', 'org_admin').where('user_id', 'not in', ids).execute();
    const [a3, a4] = admins as [Client, Client];
    const [id3, id4] = ids as [string, string];
    const logged: string[] = [];
    const spy = vi.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
      logged.push(String(m));
    });
    const [r3, r4] = await Promise.all([a3.request('POST', `/api/v1/users/${id4}/mfa/reset`), a4.request('POST', `/api/v1/users/${id3}/mfa/reset`)]);
    spy.mockRestore();
    expect(logged, `errores internos: ${logged.join(' | ')}`).toEqual([]);
    for (const r of [r3, r4]) if (typeof r.body.activationToken === 'string') sentinels.push(r.body.activationToken);
    expect([r3.status, r4.status].filter((x) => x === 200)).toHaveLength(1);
    expect(['last_admin', 'conflict', 'unauthenticated']).toContain([r3, r4].find((r) => r.status !== 200)?.body.error);
    const remaining = await handle.db
      .selectFrom('app_user')
      .innerJoin('user_role', 'user_role.user_id', 'app_user.id')
      .select('app_user.id')
      .where('user_role.role', '=', 'org_admin')
      .where('app_user.status', '=', 'active')
      .where('app_user.mfa_secret_sealed', 'is not', null)
      .execute();
    expect(remaining).toHaveLength(1);
  });

  // QA 2C1-09: al FINAL de la suite, para revisar todos los tokens emitidos en ella.
  it('valores centinela: ninguna contraseña, código, token de sesión ni secreto de la API aparece en las bases', async () => {
    const dump: string[] = [];
    for (const api of [apiA, apiB]) {
      const db = connect<TenantDatabase>(provisionerServer, api.config.organization.dbName, 1);
      try {
        for (const table of ['app_user', 'user_session', 'activation_token', 'recovery_code', 'access_log', 'audit_log', 'login_throttle'] as const) {
          dump.push(JSON.stringify(await db.selectFrom(table).selectAll().execute()));
        }
      } finally {
        await db.destroy();
      }
    }
    const all = dump.join('\n');
    // Observación QA 2B §7: también los tokens de sesión emitidos (valor de la cookie).
    expect(issuedSessionTokens.size).toBeGreaterThan(10);
    // QA 2C1-15: también las contraseñas, tokens de activación y códigos de recuperación de
    // los usuarios de las pruebas D-89, 2C1-06, R-38 y demás (registrados en `sentinels`).
    expect(sentinels.length).toBeGreaterThan(100);
    for (const secret of [PASSWORD_ADMIN, PASSWORD_AUDITOR, `${PASSWORD_AUDITOR}-nueva`, auditorToken, ...issuedSessionTokens, ...apiSecretValues, ...sentinels]) {
      expect(all, 'valor sensible encontrado en la base').not.toContain(secret);
    }
    // Secretos TOTP de TODOS los usuarios de la prueba, en hexadecimal y en base32.
    expect(secrets.size).toBeGreaterThan(5);
    for (const secret of secrets.values()) {
      expect(all).not.toContain(secret.toString('hex'));
      expect(all).not.toContain(base32Encode(secret));
    }
  });
});

/** Directorio de secretos propio (700), como `deploy/compose/secrets/api`. */
function mkdirPrivate(dir: string): void {
  mkdirSync(dir, { mode: 0o700 });
}
