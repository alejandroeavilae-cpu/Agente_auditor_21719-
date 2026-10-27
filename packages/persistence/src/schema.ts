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

export interface TenantDatabase {
  organization: OrganizationTable;
  audit_log: AuditLogTable;
}

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
  };
}
