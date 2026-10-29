// SPDX-License-Identifier: AGPL-3.0-or-later

import { sql, type Kysely } from 'kysely';
import type { DbEngine } from './config.js';
import { IDENTITY_TABLES } from './schema.js';

/**
 * Operaciones de aprovisionamiento que difieren entre motores.
 *
 * Modelo de privilegios (decisión D-04, aislamiento por base de datos):
 * - Una cuenta de **aprovisionamiento SIN superusuario** (PostgreSQL: CREATEDB, CREATEROLE y
 *   pg_signal_backend; SQL Server: dbcreator, securityadmin y processadmin) es dueña de las
 *   bases y ejecuta migraciones (hallazgo QA A-02).
 * - Cada organización tiene un usuario propio que SOLO puede conectarse a su base, y dentro
 *   de ella solo puede LEER e INSERTAR en la bitácora.
 *
 * Cada operación hace UNA cosa, para que la reversión de un alta fallida pueda deshacer
 * exactamente lo que se creó y nada más (hallazgos QA A-01 y M-01).
 */
export interface Provisioner {
  /** Crea la base vacía. UNA sola sentencia: si termina bien, la base es de esta operación. */
  createDatabase(serverDb: Kysely<unknown>, dbName: string): Promise<void>;
  /** Quita el acceso público a la base (paso separado del CREATE, hallazgo QA N-01). */
  restrictDatabase(serverDb: Kysely<unknown>, dbName: string): Promise<void>;
  /** Crea el usuario de la organización. UNA sola sentencia. */
  createLogin(serverDb: Kysely<unknown>, login: string, password: string, dbName: string): Promise<void>;
  /** Restricciones del usuario a nivel de servidor (paso separado del CREATE). */
  restrictLogin(serverDb: Kysely<unknown>, login: string): Promise<void>;
  /** Bases cuyo nombre sigue el patrón de la plataforma (para detectar huérfanas). */
  listPlatformDatabases(serverDb: Kysely<unknown>): Promise<string[]>;
  /**
   * Objetos de la base que NO son de la plataforma (vacío si solo hay objetos propios).
   * Revisa todo el catálogo, no solo tablas de `public` (hallazgo QA Z-01).
   */
  foreignObjects(adminTenantDb: Kysely<unknown>, allowedTables: readonly string[]): Promise<string[]>;
  /** Configuraciones de sesión que el usuario tiene fijadas en el motor (vacío si ninguna). */
  loginSettings(serverDb: Kysely<unknown>, login: string): Promise<string[]>;
  /** Cantidad de sesiones abiertas del usuario. */
  countSessions(serverDb: Kysely<unknown>, login: string): Promise<number>;
  /** Permite al usuario conectarse a su base (solo a esa). */
  grantConnect(serverDb: Kysely<unknown>, dbName: string, login: string): Promise<void>;
  /** Pasos previos a las migraciones, en la base de la organización. */
  prepareTenantDatabase(adminTenantDb: Kysely<unknown>, login: string): Promise<void>;
  /** Privilegios mínimos del usuario de aplicación, tras las migraciones. */
  grantAppPrivileges(adminTenantDb: Kysely<unknown>, login: string): Promise<void>;
  /**
   * Permite a la cuenta de la API leer el registro de organizaciones (solo SELECT sobre
   * `tenants`), para abrir la base de cada organización con sus credenciales (D-80).
   */
  grantControlRead(serverDb: Kysely<unknown>, controlDb: Kysely<unknown>, controlDbName: string, login: string): Promise<void>;
  dropDatabase(serverDb: Kysely<unknown>, dbName: string): Promise<void>;
  dropLogin(serverDb: Kysely<unknown>, login: string): Promise<void>;
  /** Habilita o deshabilita el inicio de sesión del usuario (suspensión aplicada por el motor). */
  setLoginEnabled(serverDb: Kysely<unknown>, login: string, enabled: boolean): Promise<void>;
  /** Cierra las sesiones abiertas del usuario. Mejor esfuerzo: devuelve un aviso si no pudo. */
  terminateSessions(serverDb: Kysely<unknown>, login: string): Promise<string | null>;
  /** Cambia la contraseña y borra configuraciones de sesión que el usuario haya fijado (también por base). */
  resetPassword(serverDb: Kysely<unknown>, login: string, password: string, dbName: string): Promise<void>;
  /** Impide que usuarios de organizaciones entren a la base de control. */
  protectControlDatabase(serverDb: Kysely<unknown>, controlDb: Kysely<unknown>, controlDbName: string): Promise<void>;
  /** Avisos de endurecimiento del servidor que la cuenta de aprovisionamiento no puede corregir. */
  hardeningWarnings(serverDb: Kysely<unknown>): Promise<string[]>;
  /** Avisos sobre la base recién creada de una organización (heredados de la plantilla). */
  tenantDatabaseWarnings(adminTenantDb: Kysely<unknown>, login: string): Promise<string[]>;
  databaseExists(serverDb: Kysely<unknown>, dbName: string): Promise<boolean>;
  loginExists(serverDb: Kysely<unknown>, login: string): Promise<boolean>;
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
  async createDatabase(serverDb, dbName) {
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(serverDb);
  },
  async restrictDatabase(serverDb, dbName) {
    // Por defecto PostgreSQL permite a cualquier usuario conectarse a cualquier base: se revoca.
    await sql`REVOKE ALL ON DATABASE ${sql.id(dbName)} FROM PUBLIC`.execute(serverDb);
  },
  async createLogin(serverDb, login, password) {
    await sql`CREATE ROLE ${sql.id(login)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD ${sql.raw(passwordLiteral(password))}`.execute(serverDb);
  },
  restrictLogin() {
    return Promise.resolve();
  },
  async listPlatformDatabases(serverDb) {
    const r = await sql<{ n: string }>`SELECT datname AS n FROM pg_database WHERE datname ~ '^auditor_t_[0-9a-f]{12}$' ORDER BY 1`.execute(serverDb);
    return r.rows.map((x) => x.n);
  },
  async foreignObjects(db, allowedTables) {
    const allowed = sql`ARRAY[${sql.join(allowedTables.map((t) => sql`${t}`))}]::text[]`;
    const r = await sql<{ o: string }>`
      SELECT n.nspname || '.' || c.relname || ' (relkind ' || c.relkind::text || ')' AS o
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND n.nspname NOT LIKE 'pg_temp%' AND n.nspname NOT LIKE 'pg_toast_temp%'
         AND NOT (n.nspname = 'public' AND (
               (c.relkind IN ('r', 'p') AND c.relname = ANY(${allowed}))
            OR (c.relkind = 'i' AND EXISTS (
                  SELECT 1 FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid
                   WHERE i.indexrelid = c.oid AND t.relnamespace = n.oid AND t.relname = ANY(${allowed})))))
      UNION ALL
      SELECT 'esquema ' || nspname FROM pg_namespace
       WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema', 'pg_toast')
         AND nspname NOT LIKE 'pg_temp%' AND nspname NOT LIKE 'pg_toast_temp%'
      UNION ALL
      SELECT 'función ' || n.nspname || '.' || p.proname
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      UNION ALL
      SELECT 'tipo ' || n.nspname || '.' || t.typname
        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
         AND n.nspname NOT LIKE 'pg_temp%' AND n.nspname NOT LIKE 'pg_toast_temp%'
         AND t.typrelid = 0 AND t.typelem = 0
      UNION ALL
      SELECT 'objeto grande ' || oid::text FROM pg_largeobject_metadata`.execute(db);
    return r.rows.map((x) => x.o);
  },
  async loginSettings(serverDb, login) {
    const r = await sql<{ s: string }>`SELECT unnest(s.setconfig) AS s FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = ${login}`.execute(serverDb);
    return r.rows.map((x) => x.s);
  },
  async countSessions(serverDb, login) {
    const r = await sql<{ n: string | number }>`SELECT count(*) AS n FROM pg_stat_activity WHERE usename = ${login}`.execute(serverDb);
    return Number(r.rows[0]?.n ?? 0);
  },
  async grantConnect(serverDb, dbName, login) {
    await sql`GRANT CONNECT ON DATABASE ${sql.id(dbName)} TO ${sql.id(login)}`.execute(serverDb);
  },
  async prepareTenantDatabase(adminTenantDb, login) {
    await sql`REVOKE ALL ON SCHEMA public FROM PUBLIC`.execute(adminTenantDb);
    await sql`GRANT USAGE ON SCHEMA public TO ${sql.id(login)}`.execute(adminTenantDb);
  },
  async grantAppPrivileges(adminTenantDb, login) {
    await sql`GRANT SELECT, INSERT ON audit_log TO ${sql.id(login)}`.execute(adminTenantDb);
    await sql`GRANT SELECT ON organization TO ${sql.id(login)}`.execute(adminTenantDb);
    // Identidad (2B): el usuario de la organización administra sus propios usuarios y
    // sesiones. La bitácora sigue siendo solo SELECT e INSERT.
    for (const table of IDENTITY_TABLES) {
      await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ${sql.id(table)} TO ${sql.id(login)}`.execute(adminTenantDb);
    }
  },
  async grantControlRead(serverDb, controlDb, controlDbName, login) {
    await sql`GRANT CONNECT ON DATABASE ${sql.id(controlDbName)} TO ${sql.id(login)}`.execute(serverDb);
    await sql`GRANT USAGE ON SCHEMA public TO ${sql.id(login)}`.execute(controlDb);
    await sql`GRANT SELECT ON tenants TO ${sql.id(login)}`.execute(controlDb);
  },
  async dropDatabase(serverDb, dbName) {
    await sql`DROP DATABASE IF EXISTS ${sql.id(dbName)} WITH (FORCE)`.execute(serverDb);
  },
  async dropLogin(serverDb, login) {
    await sql`DROP ROLE IF EXISTS ${sql.id(login)}`.execute(serverDb);
  },
  async setLoginEnabled(serverDb, login, enabled) {
    await sql`ALTER ROLE ${sql.id(login)} ${sql.raw(enabled ? 'LOGIN' : 'NOLOGIN')}`.execute(serverDb);
  },
  async terminateSessions(serverDb, login) {
    try {
      await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = ${login}`.execute(serverDb);
      return null;
    } catch {
      return `No se pudieron cerrar las sesiones abiertas de ${login} (¿falta pg_signal_backend?). Las nuevas conexiones sí quedan bloqueadas.`;
    }
  },
  async resetPassword(serverDb, login, password, dbName) {
    await sql`ALTER ROLE ${sql.id(login)} PASSWORD ${sql.raw(passwordLiteral(password))}`.execute(serverDb);
    // El usuario de una organización puede fijar parámetros de sesión propios (p. ej.
    // search_path o default_transaction_read_only), globales o solo para su base: se
    // eliminan ambos (hallazgos QA M-02 y N-02).
    await sql`ALTER ROLE ${sql.id(login)} RESET ALL`.execute(serverDb);
    // Parámetros fijados para CUALQUIER base, no solo la propia (hallazgo QA X-02).
    const dbs = await sql<{ d: string }>`SELECT d.datname AS d FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole JOIN pg_database d ON d.oid = s.setdatabase WHERE r.rolname = ${login}`.execute(serverDb);
    for (const name of new Set([dbName, ...dbs.rows.map((x) => x.d)])) {
      await sql`ALTER ROLE ${sql.id(login)} IN DATABASE ${sql.id(name)} RESET ALL`.execute(serverDb);
    }
  },
  async protectControlDatabase(serverDb, _controlDb, controlDbName) {
    await sql`REVOKE ALL ON DATABASE ${sql.id(controlDbName)} FROM PUBLIC`.execute(serverDb);
  },
  async hardeningWarnings(serverDb) {
    const r = await sql<{ datname: string }>`SELECT datname FROM pg_database WHERE datallowconn AND has_database_privilege('public', datname, 'CONNECT') AND datname !~ '^auditor_t_[0-9a-f]{12}$' ORDER BY datname`.execute(serverDb);
    // Las bases con el patrón de la plataforma se revisan aparte (registradas o huérfanas).
    return r.rows.map(
      (row) => `Cualquier usuario puede conectarse a la base "${row.datname}". Ejecute como superusuario: REVOKE CONNECT, TEMPORARY ON DATABASE "${row.datname}" FROM PUBLIC; (ver docs/fase-2/servidor-de-base-de-datos.md)`,
    );
  },
  async tenantDatabaseWarnings(adminTenantDb, login) {
    // Los objetos grandes son un canal de escritura fuera de la bitácora (hallazgos QA B-12
    // y N-04). Sus permisos viven en cada base (copiados de template1) y solo un
    // superusuario puede quitarlos. Se revisa en el alta y en cada `tenant check`.
    const r = await sql<{ f: string }>`SELECT f FROM unnest(ARRAY['lo_creat(integer)', 'lo_create(oid)', 'lo_from_bytea(oid,bytea)', 'lo_import(text)', 'lo_import(text,oid)']) AS f WHERE has_function_privilege(${login}, f, 'EXECUTE')`.execute(adminTenantDb);
    if (r.rows.length === 0) return [];
    const db = await sql<{ d: string }>`SELECT current_database() AS d`.execute(adminTenantDb);
    return [
      `El usuario de la organización puede crear objetos grandes (${r.rows.map((x) => x.f).join(', ')}). Ejecute como superusuario, en la base "${db.rows[0]?.d ?? '?'}" y en template1, el REVOKE indicado en docs/fase-2/servidor-de-base-de-datos.md §1.`,
    ];
  },
  async databaseExists(serverDb, dbName) {
    const r = await sql<{ n: number }>`SELECT 1 AS n FROM pg_database WHERE datname = ${dbName}`.execute(serverDb);
    return r.rows.length > 0;
  },
  async loginExists(serverDb, login) {
    const r = await sql<{ n: number }>`SELECT 1 AS n FROM pg_roles WHERE rolname = ${login}`.execute(serverDb);
    return r.rows.length > 0;
  },
};

const sqlserver: Provisioner = {
  async createDatabase(serverDb, dbName) {
    await sql`CREATE DATABASE ${sql.id(dbName)}`.execute(serverDb);
  },
  restrictDatabase() {
    // En SQL Server una base nueva no admite logins sin usuario propio en ella.
    return Promise.resolve();
  },
  async createLogin(serverDb, login, password, dbName) {
    await sql`CREATE LOGIN ${sql.id(login)} WITH PASSWORD = ${sql.raw(passwordLiteral(password))}, DEFAULT_DATABASE = ${sql.id(dbName)}, CHECK_POLICY = ON, CHECK_EXPIRATION = OFF`.execute(serverDb);
  },
  async restrictLogin(serverDb, login) {
    // Sin esto, cualquier login puede listar todas las bases del servidor (hallazgo QA M-03).
    await sql`DENY VIEW ANY DATABASE TO ${sql.id(login)}`.execute(serverDb);
  },
  async listPlatformDatabases(serverDb) {
    const r = await sql<{ n: string }>`SELECT name AS n FROM sys.databases WHERE name LIKE 'auditor[_]t[_]%' ORDER BY name`.execute(serverDb);
    return r.rows.map((x) => x.n).filter((n) => /^auditor_t_[0-9a-f]{12}$/.test(n));
  },
  async foreignObjects(db, allowedTables) {
    const allowed = sql.join(allowedTables.map((t) => sql`${t}`));
    // Las columnas de catálogo tienen intercalaciones distintas según la vista; se fuerzan a
    // la de la base para poder unirlas, y el texto se arma en JavaScript.
    const c = (expr: ReturnType<typeof sql.raw>) => sql`CAST(${expr} AS nvarchar(256)) COLLATE DATABASE_DEFAULT`;
    const r = await sql<{ k: string; s: string; n: string }>`
      SELECT ${c(sql.raw('o.type_desc'))} AS k, ${c(sql.raw('s.name'))} AS s, ${c(sql.raw('o.name'))} AS n
        FROM sys.objects o JOIN sys.schemas s ON s.schema_id = o.schema_id
       WHERE o.is_ms_shipped = 0
         AND NOT (s.name = 'dbo' AND (
               (o.type = 'U' AND o.name IN (${allowed}))
            OR (o.type IN ('PK', 'UQ', 'D', 'F', 'C') AND OBJECT_SCHEMA_NAME(o.parent_object_id) = 'dbo'
                AND OBJECT_NAME(o.parent_object_id) IN (${allowed}))))
      UNION ALL
      SELECT ${c(sql.raw("'TYPE'"))}, ${c(sql.raw('SCHEMA_NAME(schema_id)'))}, ${c(sql.raw('name'))} FROM sys.types WHERE is_user_defined = 1
      UNION ALL
      SELECT ${c(sql.raw("'SCHEMA'"))}, ${c(sql.raw("''"))}, ${c(sql.raw('name'))} FROM sys.schemas WHERE schema_id BETWEEN 5 AND 16383`.execute(db);
    return r.rows.map((x) => `${x.s === '' ? '' : `${x.s}.`}${x.n} (${x.k})`);
  },
  loginSettings() {
    // SQL Server no tiene parámetros de sesión por login equivalentes a los de PostgreSQL;
    // la base de destino se indica explícitamente en cada conexión.
    return Promise.resolve([]);
  },
  async countSessions(serverDb, login) {
    const r = await sql<{ n: number | string }>`SELECT COUNT(*) AS n FROM sys.dm_exec_sessions WHERE login_name = ${login} AND session_id <> @@SPID`.execute(serverDb);
    return Number(r.rows[0]?.n ?? 0);
  },
  async grantConnect() {
    // En SQL Server el acceso a una base se concede creando el usuario dentro de ella
    // (ver prepareTenantDatabase): no hay un permiso de conexión separado.
  },
  async prepareTenantDatabase(adminTenantDb, login) {
    await sql`CREATE USER ${sql.id(login)} FOR LOGIN ${sql.id(login)}`.execute(adminTenantDb);
  },
  async grantAppPrivileges(adminTenantDb, login) {
    await sql`GRANT SELECT, INSERT ON dbo.audit_log TO ${sql.id(login)}`.execute(adminTenantDb);
    await sql`GRANT SELECT ON dbo.organization TO ${sql.id(login)}`.execute(adminTenantDb);
    for (const table of IDENTITY_TABLES) {
      await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ${sql.id('dbo', table)} TO ${sql.id(login)}`.execute(adminTenantDb);
    }
  },
  async grantControlRead(_serverDb, controlDb, _controlDbName, login) {
    await sql`IF DATABASE_PRINCIPAL_ID(${login}) IS NULL EXEC(N'CREATE USER ' + QUOTENAME(${login}) + N' FOR LOGIN ' + QUOTENAME(${login}))`.execute(controlDb);
    await sql`GRANT SELECT ON dbo.tenants TO ${sql.id(login)}`.execute(controlDb);
  },
  async dropDatabase(serverDb, dbName) {
    await sql`IF DB_ID(${dbName}) IS NOT NULL BEGIN ALTER DATABASE ${sql.id(dbName)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${sql.id(dbName)}; END`.execute(serverDb);
  },
  async dropLogin(serverDb, login) {
    await sql`IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = ${login}) DROP LOGIN ${sql.id(login)}`.execute(serverDb);
  },
  async setLoginEnabled(serverDb, login, enabled) {
    await sql`ALTER LOGIN ${sql.id(login)} ${sql.raw(enabled ? 'ENABLE' : 'DISABLE')}`.execute(serverDb);
  },
  async terminateSessions(serverDb, login) {
    try {
      await sql`DECLARE @k nvarchar(max) = N''; SELECT @k = @k + N'KILL ' + CAST(session_id AS nvarchar(10)) + N';' FROM sys.dm_exec_sessions WHERE login_name = ${login} AND session_id <> @@SPID; EXEC(@k);`.execute(serverDb);
      return null;
    } catch {
      return `No se pudieron cerrar las sesiones abiertas de ${login} (¿falta processadmin?). Las nuevas conexiones sí quedan bloqueadas.`;
    }
  },
  async resetPassword(serverDb, login, password) {
    await sql`ALTER LOGIN ${sql.id(login)} WITH PASSWORD = ${sql.raw(passwordLiteral(password))}`.execute(serverDb);
  },
  async protectControlDatabase(_serverDb, controlDb) {
    // Los logins de organizaciones no tienen usuario en la base de control; además se
    // revoca explícitamente el acceso de invitado (hallazgo QA M-03).
    await sql`REVOKE CONNECT FROM guest`.execute(controlDb);
  },
  hardeningWarnings() {
    // Cada login de organización recibe DENY VIEW ANY DATABASE al crearse; el acceso de
    // invitado a master y tempdb es propio del motor y no puede quitarse.
    return Promise.resolve([]);
  },
  tenantDatabaseWarnings() {
    return Promise.resolve([]);
  },
  async databaseExists(serverDb, dbName) {
    const r = await sql<{ n: number }>`SELECT 1 AS n FROM sys.databases WHERE name = ${dbName}`.execute(serverDb);
    return r.rows.length > 0;
  },
  async loginExists(serverDb, login) {
    const r = await sql<{ n: number }>`SELECT 1 AS n FROM sys.server_principals WHERE name = ${login}`.execute(serverDb);
    return r.rows.length > 0;
  },
};

export function provisionerFor(engine: DbEngine): Provisioner {
  return engine === 'postgresql' ? postgres : sqlserver;
}
