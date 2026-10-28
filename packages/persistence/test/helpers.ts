// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import { generateDbPassword } from '@auditor-21719/crypto';
import { sql } from 'kysely';
import { connect, serverAdminDatabase, TenantManager, type DbEngine, type DbServerConfig, type DbTlsMode } from '../src/index.js';

/**
 * Configuración de los motores de prueba, leída de variables de entorno:
 *   TEST_PG_HOST, TEST_PG_PORT, TEST_PG_USER, TEST_PG_PASSWORD, TEST_PG_TLS
 *   TEST_MSSQL_HOST, TEST_MSSQL_PORT, TEST_MSSQL_USER, TEST_MSSQL_PASSWORD, TEST_MSSQL_TLS
 *
 * Si un motor no está configurado sus pruebas se omiten, SALVO que figure en
 * REQUIRE_DB_ENGINES (p. ej. "postgresql,sqlserver"): en CI se exige así para que una
 * prueba omitida nunca se confunda con una prueba aprobada.
 */
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

/** Sufijo aleatorio para que ejecuciones simultáneas no choquen. */
export function runId(): string {
  return randomBytes(3).toString('hex');
}

/**
 * Administrador con utilidades SOLO para pruebas (hallazgo QA B-07): no forman parte de la
 * API de producción ni se exportan desde el paquete.
 */
export class TestTenantManager extends TenantManager {
  /** Credenciales en claro de una organización, para probar el aislamiento. */
  async credentials(slug: string): Promise<{ dbName: string; user: string; password: string }> {
    const row = await this.findRow(slug);
    return { dbName: row.db_name, user: row.db_user, password: this.decryptPassword(row) };
  }

  /** Elimina por completo una organización de prueba (base, usuario y registro). */
  async destroy(slug: string): Promise<void> {
    const row = await this.findRow(slug).catch(() => undefined);
    if (row === undefined) return;
    await this.closeTenant(slug);
    await this.provisioner.dropDatabase(this.server(), row.db_name);
    await this.provisioner.dropLogin(this.server(), row.db_user);
    await this.control().deleteFrom('tenants').where('id', '=', row.id).execute();
  }
}

/**
 * Prepara el servidor de pruebas como se documenta en docs/fase-2/servidor-de-base-de-datos.md
 * y crea una cuenta de aprovisionamiento SIN superusuario (hallazgo QA A-02). Las pruebas
 * de organizaciones se ejecutan con esa cuenta, no con la del superusuario.
 *
 * Requiere que `superServer` sea superusuario (PostgreSQL) o sysadmin (SQL Server). Las
 * órdenes de endurecimiento son idempotentes.
 */
export async function createProvisionerAccount(
  superServer: DbServerConfig,
  id: string,
): Promise<{ server: DbServerConfig; drop: () => Promise<void> }> {
  const user = `auditor_prov_test_${id}`;
  const password = generateDbPassword();
  const admin = connect<unknown>(superServer, serverAdminDatabase(superServer), 1);
  try {
    if (superServer.engine === 'postgresql') {
      await sql`CREATE ROLE ${sql.id(user)} LOGIN CREATEDB CREATEROLE NOSUPERUSER PASSWORD ${sql.lit(password)}`.execute(admin);
      await sql`GRANT pg_signal_backend TO ${sql.id(user)}`.execute(admin);
      await sql`REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC`.execute(admin);
      await sql`REVOKE CONNECT, TEMPORARY ON DATABASE template1 FROM PUBLIC`.execute(admin);
      await sql`GRANT CONNECT ON DATABASE postgres TO ${sql.id(user)}`.execute(admin);
      const template = connect<unknown>(superServer, 'template1', 1);
      try {
        await sql`REVOKE EXECUTE ON FUNCTION lo_creat(integer), lo_create(oid), lo_from_bytea(oid, bytea), lo_import(text), lo_import(text, oid) FROM PUBLIC`.execute(template);
      } finally {
        await template.destroy();
      }
    } else {
      await sql`CREATE LOGIN ${sql.id(user)} WITH PASSWORD = ${sql.lit(password)}, CHECK_POLICY = OFF`.execute(admin);
      for (const role of ['dbcreator', 'securityadmin', 'processadmin']) {
        await sql`ALTER SERVER ROLE ${sql.id(role)} ADD MEMBER ${sql.id(user)}`.execute(admin);
      }
    }
  } finally {
    await admin.destroy();
  }
  return {
    server: { ...superServer, user, password },
    drop: async () => {
      const db = connect<unknown>(superServer, serverAdminDatabase(superServer), 1);
      try {
        if (superServer.engine === 'postgresql') {
          await sql`REVOKE CONNECT ON DATABASE postgres FROM ${sql.id(user)}`.execute(db);
          await sql`DROP ROLE IF EXISTS ${sql.id(user)}`.execute(db);
        } else {
          await sql`IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = ${user}) DROP LOGIN ${sql.id(user)}`.execute(db);
        }
      } finally {
        await db.destroy();
      }
    },
  };
}
