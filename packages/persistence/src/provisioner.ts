// SPDX-License-Identifier: AGPL-3.0-or-later

import { sql, type Kysely } from 'kysely';
import type { DbEngine } from './config.js';

/**
 * Operaciones de aprovisionamiento que difieren entre motores.
 *
 * Modelo de privilegios (decisión D-04, aislamiento por base de datos):
 * - La cuenta administrativa es dueña de todas las bases y ejecuta las migraciones.
 * - Cada organización tiene un usuario propio de aplicación que SOLO puede conectarse a
 *   su base, y dentro de ella solo puede LEER e INSERTAR en la bitácora: no puede
 *   modificar ni borrar entradas (bitácora solo-anexar reforzada por el motor).
 * - Ese usuario no tiene acceso a la base de control ni a las bases de otras organizaciones.
 */
export interface Provisioner {
  createDatabaseAndLogin(serverDb: Kysely<unknown>, dbName: string, login: string, password: string): Promise<void>;
  /** Pasos previos a las migraciones, ejecutados en la base de la organización. */
  prepareTenantDatabase(adminTenantDb: Kysely<unknown>, login: string): Promise<void>;
  /** Privilegios mínimos del usuario de aplicación, tras las migraciones. */
  grantAppPrivileges(adminTenantDb: Kysely<unknown>, login: string): Promise<void>;
  /** Elimina base y usuario (reversión de un alta fallida y limpieza de pruebas). */
  dropDatabaseAndLogin(serverDb: Kysely<unknown>, dbName: string, login: string): Promise<void>;
  /** Impide que usuarios de organizaciones se conecten a la base de control. */
  protectControlDatabase(serverDb: Kysely<unknown>, controlDb: string): Promise<void>;
  databaseExists(serverDb: Kysely<unknown>, dbName: string): Promise<boolean>;
  loginExists(serverDb: Kysely<unknown>, login: string): Promise<boolean>;
  createDatabase(serverDb: Kysely<unknown>, dbName: string): Promise<void>;
}

/**
 * La contraseña se inserta como literal porque `CREATE ROLE` y `CREATE LOGIN` no admiten
 * parámetros. Solo se aceptan contraseñas generadas por la plataforma con un alfabeto que
 * no requiere escape (ver `generateDbPassword`); cualquier otra cosa se rechaza.
 */
function passwordLiteral(password: string): string {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(password)) {
    throw new Error('Contraseña de base de datos con formato no permitido.');
  }
  return `'${password}'`;
}

const postgres: Provisioner = {
  async createDatabaseAndLogin(serverDb, dbName, login, password) {
    await sql`CREATE ROLE ${sql.id(login)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD ${sql.raw(passwordLiteral(password))}`.execute(serverDb);
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(serverDb);
    // Por defecto PostgreSQL permite a cualquier usuario conectarse a cualquier base: se revoca.
    await sql`REVOKE ALL ON DATABASE ${sql.id(dbName)} FROM PUBLIC`.execute(serverDb);
    await sql`GRANT CONNECT ON DATABASE ${sql.id(dbName)} TO ${sql.id(login)}`.execute(serverDb);
  },
  async prepareTenantDatabase(adminTenantDb, login) {
    await sql`REVOKE ALL ON SCHEMA public FROM PUBLIC`.execute(adminTenantDb);
    await sql`GRANT USAGE ON SCHEMA public TO ${sql.id(login)}`.execute(adminTenantDb);
  },
  async grantAppPrivileges(adminTenantDb, login) {
    await sql`GRANT SELECT, INSERT ON audit_log TO ${sql.id(login)}`.execute(adminTenantDb);
    await sql`GRANT SELECT ON organization TO ${sql.id(login)}`.execute(adminTenantDb);
  },
  async dropDatabaseAndLogin(serverDb, dbName, login) {
    await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(serverDb);
    await sql`DROP ROLE IF EXISTS ${sql.id(login)}`.execute(serverDb);
  },
  async protectControlDatabase(serverDb, controlDb) {
    await sql`REVOKE ALL ON DATABASE ${sql.id(controlDb)} FROM PUBLIC`.execute(serverDb);
  },
  async databaseExists(serverDb, dbName) {
    const r = await sql<{ n: number }>`SELECT 1 AS n FROM pg_database WHERE datname = ${dbName}`.execute(serverDb);
    return r.rows.length > 0;
  },
  async createDatabase(serverDb, dbName) {
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(serverDb);
  },
  async loginExists(serverDb, login) {
    const r = await sql<{ n: number }>`SELECT 1 AS n FROM pg_roles WHERE rolname = ${login}`.execute(serverDb);
    return r.rows.length > 0;
  },
};

const sqlserver: Provisioner = {
  async createDatabaseAndLogin(serverDb, dbName, login, password) {
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(serverDb);
    await sql`CREATE LOGIN ${sql.id(login)} WITH PASSWORD = ${sql.raw(passwordLiteral(password))}, DEFAULT_DATABASE = ${sql.id(dbName)}, CHECK_POLICY = ON, CHECK_EXPIRATION = OFF`.execute(serverDb);
  },
  async prepareTenantDatabase(adminTenantDb, login) {
    // En SQL Server un login solo entra a una base si tiene un usuario en ella:
    // se crea únicamente en la base de su organización.
    await sql`CREATE USER ${sql.id(login)} FOR LOGIN ${sql.id(login)}`.execute(adminTenantDb);
  },
  async grantAppPrivileges(adminTenantDb, login) {
    await sql`GRANT SELECT, INSERT ON dbo.audit_log TO ${sql.id(login)}`.execute(adminTenantDb);
    await sql`GRANT SELECT ON dbo.organization TO ${sql.id(login)}`.execute(adminTenantDb);
  },
  async dropDatabaseAndLogin(serverDb, dbName, login) {
    await sql`IF DB_ID(${dbName}) IS NOT NULL BEGIN ALTER DATABASE ${sql.id(dbName)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${sql.id(dbName)}; END`.execute(serverDb);
    await sql`IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = ${login}) DROP LOGIN ${sql.id(login)}`.execute(serverDb);
  },
  async protectControlDatabase() {
    // Sin acción: los logins de organizaciones no tienen usuario en la base de control,
    // y el acceso de invitado ("guest") está deshabilitado por defecto en bases de usuario.
  },
  async databaseExists(serverDb, dbName) {
    const r = await sql<{ n: number }>`SELECT 1 AS n FROM sys.databases WHERE name = ${dbName}`.execute(serverDb);
    return r.rows.length > 0;
  },
  async createDatabase(serverDb, dbName) {
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(serverDb);
  },
  async loginExists(serverDb, login) {
    const r = await sql<{ n: number }>`SELECT 1 AS n FROM sys.server_principals WHERE name = ${login}`.execute(serverDb);
    return r.rows.length > 0;
  },
};

export function provisionerFor(engine: DbEngine): Provisioner {
  return engine === 'postgresql' ? postgres : sqlserver;
}
