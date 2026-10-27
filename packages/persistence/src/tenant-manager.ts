// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';
import { generateDbPassword, generateKey, open, seal, unwrapKey, wrapKey, type SymmetricKey } from '@auditor-21719/crypto';
import type { Kysely } from 'kysely';
import { AuditLogRepository } from './audit-log-repository.js';
import type { DbServerConfig, PlatformDbConfig } from './config.js';
import { connect, serverAdminDatabase } from './connection.js';
import { migrateToLatest } from './migrate.js';
import { assertTenantSlug, dekContext, passwordContext, tenantDatabaseName, tenantLoginName } from './naming.js';
import { provisionerFor, type Provisioner } from './provisioner.js';
import { controlMigrations, tenantMigrations, type ControlDatabase, type TenantDatabase, type TenantStatus } from './schema.js';

/** Datos públicos de una organización (nunca incluye secretos). */
export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  dbName: string;
  createdAt: string;
}

/** Acceso a la base de una organización con SUS credenciales de aplicación. */
export interface TenantHandle {
  info: TenantInfo;
  db: Kysely<TenantDatabase>;
  audit: AuditLogRepository;
}

const nowIso = (): string => new Date().toISOString();

/**
 * Administra el ciclo de vida de las organizaciones (modalidad multiempresa, D-04).
 *
 * Usa dos tipos de credenciales:
 * - la **cuenta administrativa** del motor (crear bases, migrar), que nunca se usa para
 *   leer datos de una organización en operación normal;
 * - el **usuario propio de cada organización**, con permisos mínimos, para todo acceso
 *   a sus datos (`openTenant`).
 */
export class TenantManager {
  private readonly provisioner: Provisioner;
  private serverDb: Kysely<unknown> | undefined;
  private controlDb: Kysely<ControlDatabase> | undefined;
  private readonly open = new Map<string, TenantHandle>();

  constructor(
    private readonly config: PlatformDbConfig,
    private readonly masterKeys: readonly SymmetricKey[],
  ) {
    if (masterKeys.length === 0) throw new Error('Se requiere al menos una clave maestra.');
    this.provisioner = provisionerFor(config.admin.engine);
  }

  private get admin(): DbServerConfig {
    return this.config.admin;
  }

  private server(): Kysely<unknown> {
    this.serverDb ??= connect<unknown>(this.admin, serverAdminDatabase(this.admin), 2);
    return this.serverDb;
  }

  private control(): Kysely<ControlDatabase> {
    this.controlDb ??= connect<ControlDatabase>(this.admin, this.config.controlDatabase, 3);
    return this.controlDb;
  }

  /**
   * Crea la base de control si no existe, aplica sus migraciones y la protege.
   * Es idempotente: puede ejecutarse en cada actualización.
   */
  async initControl(): Promise<string[]> {
    const name = this.config.controlDatabase;
    if (!(await this.provisioner.databaseExists(this.server(), name))) {
      await this.provisioner.createDatabase(this.server(), name);
    }
    await this.provisioner.protectControlDatabase(this.server(), name);
    const { applied } = await migrateToLatest(this.control() as Kysely<unknown>, controlMigrations(this.admin.engine));
    return applied;
  }

  /**
   * Da de alta una organización: base propia, usuario propio, DEK propia y primera
   * entrada de bitácora. Si algo falla, revierte lo creado (sin dejar bases huérfanas).
   *
   * @param actor quién ejecuta la operación (queda en la bitácora de la organización).
   */
  async createTenant(slug: string, name: string, actor: string): Promise<TenantInfo> {
    assertTenantSlug(slug);
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 200) throw new Error('El nombre debe tener entre 2 y 200 caracteres.');
    const existing = await this.control().selectFrom('tenants').select('id').where('slug', '=', slug).executeTakeFirst();
    if (existing !== undefined) throw new Error(`Ya existe una organización con identificador "${slug}".`);

    const id = randomUUID();
    const dbName = tenantDatabaseName(slug);
    const login = tenantLoginName(slug);
    // Nunca se reutiliza ni se toca una base o usuario que no creó esta operación: si ya
    // existen (restos manuales, otra aplicación), se aborta sin modificar nada.
    if (await this.provisioner.databaseExists(this.server(), dbName)) {
      throw new Error(`Ya existe una base de datos llamada ${dbName} en el servidor; no se modifica.`);
    }
    if (await this.provisioner.loginExists(this.server(), login)) {
      throw new Error(`Ya existe un usuario de base de datos llamado ${login}; no se modifica.`);
    }
    const password = generateDbPassword();
    const dek = generateKey();
    const masterKey = this.masterKeys[0] as SymmetricKey;
    const createdAt = nowIso();

    // 1. Registro en estado "provisioning": nadie puede abrir la organización aún.
    await this.control()
      .insertInto('tenants')
      .values({
        id,
        slug,
        name: cleanName,
        status: 'provisioning',
        db_name: dbName,
        db_user: login,
        db_password_sealed: seal(dek, Buffer.from(password, 'utf8'), passwordContext(id)),
        dek_wrapped: wrapKey(masterKey, dek, dekContext(id)),
        created_at: createdAt,
        updated_at: createdAt,
      })
      .execute();

    let resourcesCreated = false;
    try {
      // 2. Base y usuario propios. Se marca antes de crear: si falla a mitad (p. ej. el
      // usuario se creó pero la base no), la reversión elimina lo que exista.
      resourcesCreated = true;
      await this.provisioner.createDatabaseAndLogin(this.server(), dbName, login, password);

      // 3. Esquema y privilegios mínimos, aplicados con la cuenta administrativa.
      const adminTenantDb = connect<TenantDatabase>(this.admin, dbName, 1);
      try {
        await this.provisioner.prepareTenantDatabase(adminTenantDb as Kysely<unknown>, login);
        await migrateToLatest(adminTenantDb as Kysely<unknown>, tenantMigrations(this.admin.engine));
        await this.provisioner.grantAppPrivileges(adminTenantDb as Kysely<unknown>, login);
        await adminTenantDb.insertInto('organization').values({ id, slug, name: cleanName, created_at: createdAt }).execute();
      } finally {
        await adminTenantDb.destroy();
      }

      // 4. Comprobación con el usuario propio y primera entrada de bitácora.
      const handle = await this.openWithCredentials(
        { id, slug, name: cleanName, status: 'provisioning', dbName, createdAt },
        login,
        password,
      );
      await handle.audit.append({
        actor,
        action: 'tenant.created',
        object: `organization/${slug}`,
        data: { name: cleanName, engine: this.admin.engine },
      });
      await handle.db.destroy();

      // 5. Activación.
      await this.control().updateTable('tenants').set({ status: 'active', updated_at: nowIso() }).where('id', '=', id).execute();
      return { id, slug, name: cleanName, status: 'active', dbName, createdAt };
    } catch (error) {
      // Reversión: no se dejan bases ni usuarios huérfanos ni registros a medio crear.
      if (resourcesCreated) {
        await this.provisioner.dropDatabaseAndLogin(this.server(), dbName, login).catch(() => undefined);
      }
      await this.control().deleteFrom('tenants').where('id', '=', id).execute().catch(() => undefined);
      throw error;
    }
  }

  /** Lista las organizaciones registradas. */
  async listTenants(): Promise<TenantInfo[]> {
    const rows = await this.control().selectFrom('tenants').selectAll().orderBy('slug').execute();
    return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, status: r.status, dbName: r.db_name, createdAt: r.created_at }));
  }

  /**
   * Suspende o reactiva una organización. Una organización suspendida no puede abrirse
   * (sus conexiones abiertas en este proceso se cierran). El cambio queda en su bitácora.
   */
  async setStatus(slug: string, status: 'active' | 'suspended', actor: string): Promise<void> {
    assertTenantSlug(slug);
    const row = await this.control().selectFrom('tenants').selectAll().where('slug', '=', slug).executeTakeFirst();
    if (row === undefined) throw new Error(`No existe la organización "${slug}".`);
    if (row.status === 'provisioning') throw new Error('La organización aún se está creando.');
    if (row.status === status) return;
    // Se registra en la bitácora ANTES de suspender, mientras el acceso sigue habilitado.
    const handle = await this.openRow(row, true);
    await handle.audit.append({ actor, action: status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated', object: `organization/${slug}`, data: {} });
    await this.closeTenant(slug);
    await handle.db.destroy().catch(() => undefined);
    await this.control().updateTable('tenants').set({ status, updated_at: nowIso() }).where('id', '=', row.id).execute();
  }

  /**
   * Abre la base de una organización activa con SUS credenciales.
   * Verifica que la base abierta sea realmente la de esa organización.
   */
  async openTenant(slug: string): Promise<TenantHandle> {
    assertTenantSlug(slug);
    const cached = this.open.get(slug);
    if (cached !== undefined) return cached;
    const row = await this.control().selectFrom('tenants').selectAll().where('slug', '=', slug).executeTakeFirst();
    if (row === undefined) throw new Error(`No existe la organización "${slug}".`);
    if (row.status !== 'active') throw new Error(`La organización "${slug}" no está activa (estado: ${row.status}).`);
    const handle = await this.openRow(row, false);
    this.open.set(slug, handle);
    return handle;
  }

  /**
   * Aplica migraciones pendientes a todas las organizaciones (con la cuenta administrativa)
   * y deja constancia en la bitácora de cada una que recibió cambios.
   */
  async migrateAllTenants(actor: string): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    const rows = await this.control().selectFrom('tenants').selectAll().where('status', '!=', 'provisioning').orderBy('slug').execute();
    for (const row of rows) {
      const adminTenantDb = connect<unknown>(this.admin, row.db_name, 1);
      try {
        const { applied } = await migrateToLatest(adminTenantDb, tenantMigrations(this.admin.engine));
        await this.provisioner.grantAppPrivileges(adminTenantDb, row.db_user);
        result[row.slug] = applied;
      } finally {
        await adminTenantDb.destroy();
      }
      const applied = result[row.slug] ?? [];
      if (applied.length > 0) {
        const handle = await this.openRow(row, true);
        await handle.audit.append({ actor, action: 'schema.migrated', object: `organization/${row.slug}`, data: { migrations: applied } });
        await handle.db.destroy();
      }
    }
    return result;
  }

  /** Cierra la conexión abierta de una organización en este proceso. */
  async closeTenant(slug: string): Promise<void> {
    const handle = this.open.get(slug);
    if (handle !== undefined) {
      this.open.delete(slug);
      await handle.db.destroy();
    }
  }

  /**
   * Elimina por completo una organización (base, usuario y registro).
   *
   * Uso restringido: reversión y pruebas. NO es el procedimiento de baja definitivo, que
   * requiere exportación previa y acta de destrucción (omisión O-09, fase posterior); por
   * eso no se expone en la CLI.
   */
  async destroyTenantForTests(slug: string): Promise<void> {
    await this.closeTenant(slug);
    const row = await this.control().selectFrom('tenants').selectAll().where('slug', '=', slug).executeTakeFirst();
    if (row === undefined) return;
    await this.provisioner.dropDatabaseAndLogin(this.server(), row.db_name, row.db_user);
    await this.control().deleteFrom('tenants').where('id', '=', row.id).execute();
  }

  /** Revela las credenciales de aplicación de una organización. Solo para pruebas de aislamiento. */
  async credentialsForTests(slug: string): Promise<{ user: string; password: string; dbName: string }> {
    const row = await this.control().selectFrom('tenants').selectAll().where('slug', '=', slug).executeTakeFirstOrThrow();
    return { user: row.db_user, password: this.decryptPassword(row), dbName: row.db_name };
  }

  /** Cierra todas las conexiones. */
  async close(): Promise<void> {
    for (const slug of [...this.open.keys()]) await this.closeTenant(slug);
    await this.controlDb?.destroy();
    await this.serverDb?.destroy();
    this.controlDb = undefined;
    this.serverDb = undefined;
  }

  private decryptPassword(row: ControlDatabase['tenants']): string {
    const dek = unwrapKey(this.masterKeys, row.dek_wrapped, dekContext(row.id));
    return open([dek], row.db_password_sealed, passwordContext(row.id)).toString('utf8');
  }

  private async openRow(row: ControlDatabase['tenants'], allowInactive: boolean): Promise<TenantHandle> {
    if (!allowInactive && row.status !== 'active') throw new Error('La organización no está activa.');
    const info: TenantInfo = { id: row.id, slug: row.slug, name: row.name, status: row.status, dbName: row.db_name, createdAt: row.created_at };
    return this.openWithCredentials(info, row.db_user, this.decryptPassword(row));
  }

  private async openWithCredentials(info: TenantInfo, user: string, password: string): Promise<TenantHandle> {
    const db = connect<TenantDatabase>({ ...this.admin, user, password }, info.dbName);
    try {
      // Defensa contra enrutamiento erróneo: la base debe declararse como esta organización.
      const org = await db.selectFrom('organization').select(['id', 'slug']).executeTakeFirst();
      if (org?.id !== info.id || org.slug !== info.slug) {
        throw new Error(`La base ${info.dbName} no corresponde a la organización "${info.slug}".`);
      }
    } catch (error) {
      await db.destroy();
      throw error;
    }
    return { info, db, audit: new AuditLogRepository(db, this.admin.engine, info.slug) };
  }
}
