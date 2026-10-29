// SPDX-License-Identifier: AGPL-3.0-or-later
// Utilidades SOLO de prueba para la integración de identidad con motores reales.

import { randomBytes } from 'node:crypto';
import { generateDbPassword } from '@auditor-21719/crypto';
import { connect, serverAdminDatabase, type DbEngine, type DbServerConfig, type DbTlsMode } from '@auditor-21719/persistence';
import { sql } from 'kysely';

/** Motores configurados por TEST_PG_* / TEST_MSSQL_* (ver docs/fase-1/ejecucion-local.md). */
export function engineConfigs(): { engine: DbEngine; server: DbServerConfig }[] {
  const required = (process.env.REQUIRE_DB_ENGINES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const result: { engine: DbEngine; server: DbServerConfig }[] = [];
  const read = (prefix: string, engine: DbEngine, defaultPort: number): void => {
    const host = process.env[`${prefix}_HOST`];
    if (host === undefined || host === '') {
      if (required.includes(engine)) throw new Error(`REQUIRE_DB_ENGINES exige ${engine}, pero ${prefix}_HOST no está definido.`);
      return;
    }
    result.push({
      engine,
      server: {
        engine,
        host,
        port: Number(process.env[`${prefix}_PORT`] ?? defaultPort),
        user: process.env[`${prefix}_USER`] ?? '',
        password: process.env[`${prefix}_PASSWORD`] ?? '',
        tls: (process.env[`${prefix}_TLS`] ?? 'disable') as DbTlsMode,
      },
    });
  };
  read('TEST_PG', 'postgresql', 5432);
  read('TEST_MSSQL', 'sqlserver', 1433);
  return result;
}

export const runId = (): string => randomBytes(3).toString('hex');

/**
 * Crea, con el superusuario de pruebas, una cuenta de aprovisionamiento SIN superusuario
 * y una cuenta de la API (solo login; los permisos los concede `initControl`), como indica
 * docs/fase-2/servidor-de-base-de-datos.md.
 */
export async function createAccounts(
  superServer: DbServerConfig,
  id: string,
): Promise<{ provisioner: DbServerConfig; api: DbServerConfig; drop: () => Promise<void> }> {
  const prov = `auditor_prov_api_${id}`;
  const api = `auditor_api_${id}`;
  const provPassword = generateDbPassword();
  const apiPassword = generateDbPassword();
  const admin = connect<unknown>(superServer, serverAdminDatabase(superServer), 1);
  try {
    if (superServer.engine === 'postgresql') {
      await sql`CREATE ROLE ${sql.id(prov)} LOGIN CREATEDB CREATEROLE NOSUPERUSER PASSWORD ${sql.lit(provPassword)}`.execute(admin);
      await sql`GRANT pg_signal_backend TO ${sql.id(prov)}`.execute(admin);
      await sql`REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC`.execute(admin);
      await sql`REVOKE CONNECT, TEMPORARY ON DATABASE template1 FROM PUBLIC`.execute(admin);
      await sql`GRANT CONNECT ON DATABASE postgres TO ${sql.id(prov)}`.execute(admin);
      await sql`CREATE ROLE ${sql.id(api)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD ${sql.lit(apiPassword)}`.execute(admin);
    } else {
      await sql`CREATE LOGIN ${sql.id(prov)} WITH PASSWORD = ${sql.lit(provPassword)}, CHECK_POLICY = OFF`.execute(admin);
      for (const role of ['dbcreator', 'securityadmin', 'processadmin']) {
        await sql`ALTER SERVER ROLE ${sql.id(role)} ADD MEMBER ${sql.id(prov)}`.execute(admin);
      }
      await sql`CREATE LOGIN ${sql.id(api)} WITH PASSWORD = ${sql.lit(apiPassword)}, CHECK_POLICY = OFF`.execute(admin);
      await sql`DENY VIEW ANY DATABASE TO ${sql.id(api)}`.execute(admin);
    }
  } finally {
    await admin.destroy();
  }
  return {
    provisioner: { ...superServer, user: prov, password: provPassword },
    api: { ...superServer, user: api, password: apiPassword },
    drop: async () => {
      const db = connect<unknown>(superServer, serverAdminDatabase(superServer), 1);
      try {
        for (const login of [api, prov]) {
          if (superServer.engine === 'postgresql') {
            await sql`REVOKE ALL ON DATABASE postgres FROM ${sql.id(login)}`.execute(db).catch(() => undefined);
            await sql`DROP ROLE IF EXISTS ${sql.id(login)}`.execute(db);
          } else {
            await sql`DECLARE @k nvarchar(max) = N''; SELECT @k = @k + N'KILL ' + CAST(session_id AS nvarchar(10)) + N';' FROM sys.dm_exec_sessions WHERE login_name = ${login} AND session_id <> @@SPID; EXEC(@k);`.execute(db);
            await sql`IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = ${login}) DROP LOGIN ${sql.id(login)}`.execute(db);
          }
        }
      } finally {
        await db.destroy();
      }
    },
  };
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Decodifica base32 (RFC 4648) para calcular códigos TOTP en las pruebas. */
export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, '')) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Cliente HTTP mínimo con su propia cookie de sesión y token anti-CSRF. */
export class Client {
  cookie: string | undefined;
  csrf: string | undefined;

  constructor(
    private readonly base: string,
    private readonly cookieName: string,
  ) {}

  async request(method: string, path: string, body?: unknown, options: { csrf?: boolean } = {}): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.cookie !== undefined) headers.cookie = `${this.cookieName}=${encodeURIComponent(this.cookie)}`;
    if ((options.csrf ?? true) && this.csrf !== undefined && method !== 'GET') headers['x-csrf-token'] = this.csrf;
    const res = await fetch(`${this.base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${this.cookieName}=`));
    if (setCookie !== undefined) {
      const value = decodeURIComponent(setCookie.slice(this.cookieName.length + 1).split(';')[0] ?? '');
      this.cookie = value === '' ? undefined : value;
    }
    const text = await res.text();
    const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
    if (typeof parsed.csrfToken === 'string') this.csrf = parsed.csrfToken;
    return { status: res.status, body: parsed, headers: res.headers };
  }
}
