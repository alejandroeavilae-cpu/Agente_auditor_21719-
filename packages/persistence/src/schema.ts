// SPDX-License-Identifier: AGPL-3.0-or-later

import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { DbEngine } from './config.js';

/**
 * Esquemas de la base de control y de la base de cada organización.
 *
 * Decisiones de portabilidad (mismo código en PostgreSQL y SQL Server):
 * - Identificadores como texto (UUID generado en la aplicación), no tipos nativos.
 * - Fechas como texto ISO 8601 UTC con milisegundos ("2026-10-27T13:00:00.000Z"): el
 *   hash de la bitácora se calcula sobre ese texto exacto y no puede depender de cómo
 *   cada motor guarda o redondea fechas.
 * - Texto Unicode: `varchar` en PostgreSQL (UTF-8) y `nvarchar` en SQL Server.
 */

// ---------- Tipos de filas ----------

export type TenantStatus = 'provisioning' | 'active' | 'suspended';

export interface TenantsTable {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  db_name: string;
  db_user: string;
  /** Contraseña de la BD de la organización, cifrada con su DEK (D-12). */
  db_password_sealed: string;
  /** DEK de la organización, envuelta con la clave maestra. */
  dek_wrapped: string;
  created_at: string;
  updated_at: string;
}

export interface ControlDatabase {
  tenants: TenantsTable;
}

export interface OrganizationTable {
  id: string;
  slug: string;
  name: string;
  created_at: string;
}

export interface AuditLogTable {
  /** `bigint`: PostgreSQL lo devuelve como texto, SQL Server como número. */
  seq: number | string;
  chain_id: string;
  ts: string;
  actor: string;
  action: string;
  object: string;
  /** Objeto `data` serializado en JSON canónico. */
  data: string;
  prev_hash: string;
  hash: string;
}

export type UserStatus = 'invited' | 'active' | 'disabled';
export type SessionStage = 'mfa_pending' | 'mfa_enroll' | 'full';

/** Usuario de la organización (entrega 2B). Datos personales de la plataforma (O-01). */
export interface AppUserTable {
  id: string;
  /** Correo normalizado en minúsculas; único dentro de la organización. */
  email: string;
  display_name: string;
  status: UserStatus;
  /** Hash argon2id (formato PHC); nulo hasta activar la cuenta. */
  password_hash: string | null;
  /** Secreto TOTP cifrado con la DEK de la organización; nulo si no tiene MFA. */
  mfa_secret_sealed: string | null;
  /** Secreto TOTP en proceso de registro (aún no confirmado). */
  mfa_pending_secret_sealed: string | null;
  /** Último paso TOTP aceptado (evita reusar un código). */
  mfa_last_step: number | string | null;
  /** Fallos consecutivos de contraseña. */
  failed_attempts: number;
  /** Fallos consecutivos de MFA: contador aparte, no se pone en 0 al acertar la contraseña (QA 2B-01). */
  mfa_failed_attempts: number;
  locked_until: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRoleTable {
  user_id: string;
  role: string;
}

export interface RecoveryCodeTable {
  /** SHA-256 del código normalizado. */
  code_hash: string;
  user_id: string;
  used_at: string | null;
}

export interface UserSessionTable {
  /** SHA-256 del token de sesión: el token en sí nunca se guarda. */
  id_hash: string;
  user_id: string;
  stage: SessionStage;
  csrf_hash: string;
  created_at: string;
  last_seen_at: string;
  /** Vencimiento absoluto (12 h desde la creación, D-79). */
  expires_at: string;
  /** Última verificación MFA (para acciones de alto riesgo, ventana de 5 min). */
  mfa_verified_at: string | null;
}

export interface ActivationTokenTable {
  token_hash: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

/** Registro de accesos con IP (D-78): retención configurable, se purga. */
export interface AccessLogTable {
  id: string;
  ts: string;
  user_id: string | null;
  event: string;
  ip: string | null;
  ua_family: string | null;
}

export interface TenantDatabase {
  organization: OrganizationTable;
  audit_log: AuditLogTable;
  app_user: AppUserTable;
  user_role: UserRoleTable;
  recovery_code: RecoveryCodeTable;
  user_session: UserSessionTable;
  activation_token: ActivationTokenTable;
  access_log: AccessLogTable;
}

/** Tablas de identidad a las que el usuario de aplicación accede con lectura y escritura. */
export const IDENTITY_TABLES = ['app_user', 'user_role', 'recovery_code', 'user_session', 'activation_token', 'access_log'] as const;

// ---------- Tipos de columna portables ----------

function str(engine: DbEngine, length: number): RawBuilder<unknown> {
  return engine === 'postgresql' ? sql.raw(`varchar(${length})`) : sql.raw(`nvarchar(${length})`);
}

function longText(engine: DbEngine): RawBuilder<unknown> {
  return engine === 'postgresql' ? sql.raw('text') : sql.raw('nvarchar(max)');
}

function ascii(length: number): RawBuilder<unknown> {
  return sql.raw(`char(${length})`);
}

// ---------- Migraciones ----------
// Las migraciones son código versionado y nunca se editan una vez publicadas:
// los cambios se agregan como migraciones nuevas.

/** Migraciones de la base de control. */
export function controlMigrations(engine: DbEngine): Record<string, Migration> {
  return {
    '0001_tenants': {
      async up(db: Kysely<unknown>) {
        await db.schema
          .createTable('tenants')
          .addColumn('id', ascii(36), (c) => c.primaryKey())
          .addColumn('slug', str(engine, 30), (c) => c.notNull().unique())
          .addColumn('name', str(engine, 200), (c) => c.notNull())
          .addColumn('status', str(engine, 20), (c) => c.notNull())
          .addColumn('db_name', str(engine, 128), (c) => c.notNull().unique())
          .addColumn('db_user', str(engine, 128), (c) => c.notNull().unique())
          .addColumn('db_password_sealed', str(engine, 500), (c) => c.notNull())
          .addColumn('dek_wrapped', str(engine, 500), (c) => c.notNull())
          .addColumn('created_at', ascii(24), (c) => c.notNull())
          .addColumn('updated_at', ascii(24), (c) => c.notNull())
          .execute();
      },
    },
  };
}

/** Migraciones de la base de cada organización. */
export function tenantMigrations(engine: DbEngine): Record<string, Migration> {
  return {
    '0001_organization_and_audit_log': {
      async up(db: Kysely<unknown>) {
        await db.schema
          .createTable('organization')
          .addColumn('id', ascii(36), (c) => c.primaryKey())
          .addColumn('slug', str(engine, 30), (c) => c.notNull())
          .addColumn('name', str(engine, 200), (c) => c.notNull())
          .addColumn('created_at', ascii(24), (c) => c.notNull())
          .execute();
        await db.schema
          .createTable('audit_log')
          // La clave primaria sobre `seq` impide que dos escrituras concurrentes
          // obtengan el mismo número: una falla y se reintenta.
          .addColumn('seq', 'bigint', (c) => c.primaryKey())
          .addColumn('chain_id', str(engine, 200), (c) => c.notNull())
          .addColumn('ts', ascii(24), (c) => c.notNull())
          .addColumn('actor', str(engine, 500), (c) => c.notNull())
          .addColumn('action', str(engine, 200), (c) => c.notNull())
          .addColumn('object', str(engine, 1000), (c) => c.notNull())
          .addColumn('data', longText(engine), (c) => c.notNull())
          .addColumn('prev_hash', ascii(64), (c) => c.notNull())
          .addColumn('hash', ascii(64), (c) => c.notNull())
          .execute();
      },
    },
    '0002_identity': {
      async up(db: Kysely<unknown>) {
        await db.schema
          .createTable('app_user')
          .addColumn('id', ascii(36), (c) => c.primaryKey())
          .addColumn('email', str(engine, 254), (c) => c.notNull().unique())
          .addColumn('display_name', str(engine, 200), (c) => c.notNull())
          .addColumn('status', str(engine, 20), (c) => c.notNull())
          .addColumn('password_hash', str(engine, 200))
          .addColumn('mfa_secret_sealed', str(engine, 400))
          .addColumn('mfa_pending_secret_sealed', str(engine, 400))
          .addColumn('mfa_last_step', 'bigint')
          .addColumn('failed_attempts', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('mfa_failed_attempts', 'integer', (c) => c.notNull().defaultTo(0))
          .addColumn('locked_until', ascii(24))
          .addColumn('password_changed_at', ascii(24))
          .addColumn('created_at', ascii(24), (c) => c.notNull())
          .addColumn('updated_at', ascii(24), (c) => c.notNull())
          .execute();
        await db.schema
          .createTable('user_role')
          .addColumn('user_id', ascii(36), (c) => c.notNull())
          .addColumn('role', str(engine, 40), (c) => c.notNull())
          .addPrimaryKeyConstraint('user_role_pk', ['user_id', 'role'])
          .execute();
        await db.schema
          .createTable('recovery_code')
          .addColumn('code_hash', ascii(64), (c) => c.primaryKey())
          .addColumn('user_id', ascii(36), (c) => c.notNull())
          .addColumn('used_at', ascii(24))
          .execute();
        await db.schema.createIndex('recovery_code_user').on('recovery_code').column('user_id').execute();
        await db.schema
          .createTable('user_session')
          .addColumn('id_hash', ascii(64), (c) => c.primaryKey())
          .addColumn('user_id', ascii(36), (c) => c.notNull())
          .addColumn('stage', str(engine, 20), (c) => c.notNull())
          .addColumn('csrf_hash', ascii(64), (c) => c.notNull())
          .addColumn('created_at', ascii(24), (c) => c.notNull())
          .addColumn('last_seen_at', ascii(24), (c) => c.notNull())
          .addColumn('expires_at', ascii(24), (c) => c.notNull())
          .addColumn('mfa_verified_at', ascii(24))
          .execute();
        await db.schema.createIndex('user_session_user').on('user_session').column('user_id').execute();
        await db.schema
          .createTable('activation_token')
          .addColumn('token_hash', ascii(64), (c) => c.primaryKey())
          .addColumn('user_id', ascii(36), (c) => c.notNull())
          .addColumn('expires_at', ascii(24), (c) => c.notNull())
          .addColumn('used_at', ascii(24))
          .addColumn('created_at', ascii(24), (c) => c.notNull())
          .execute();
        await db.schema
          .createTable('access_log')
          .addColumn('id', ascii(36), (c) => c.primaryKey())
          .addColumn('ts', ascii(24), (c) => c.notNull())
          .addColumn('user_id', ascii(36))
          .addColumn('event', str(engine, 60), (c) => c.notNull())
          .addColumn('ip', str(engine, 45))
          .addColumn('ua_family', str(engine, 40))
          .execute();
        await db.schema.createIndex('access_log_ts').on('access_log').column('ts').execute();
      },
    },
  };
}
