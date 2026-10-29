// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';
import { CryptoError, generateDbPassword, generateKey, open, seal, unwrapKey, wrapKey, type SymmetricKey } from '@auditor-21719/crypto';
import { sql, type Kysely } from 'kysely';
import { AuditLogRepository } from './audit-log-repository.js';
import type { DbServerConfig, PlatformDbConfig } from './config.js';
import { connect, serverAdminDatabase } from './connection.js';
import { migrateToLatest } from './migrate.js';
import { assertTenantName, assertTenantSlug, dekContext, newTenantResourceNames, passwordContext } from './naming.js';
import { provisionerFor, type Provisioner } from './provisioner.js';
import { controlMigrations, tenantMigrations, type ControlDatabase, type TenantDatabase, type TenantStatus, type TenantsTable } from './schema.js';

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

/** Resultado de una operación que puede completarse con advertencias. */
export interface OperationResult {
  warnings: string[];
}

/** Resultado de migrar una organización: aplicadas, o el error que la detuvo. */
export interface TenantMigrationResult {
  applied: string[];
  error?: string;
}

/** Opciones avanzadas. `provisioner` permite inyectar fallos en pruebas. */
export interface TenantManagerOptions {
  provisioner?: Provisioner;
}

const nowIso = (): string => new Date().toISOString();

/**
 * Tablas que crean las migraciones de una base de organización y sus columnas exactas.
 * Una tabla con el mismo nombre pero otras columnas se trata como ajena (QA Z-04, Z-05).
 */
const TENANT_TABLE_COLUMNS: Record<string, readonly string[]> = {
  organization: ['created_at', 'id', 'name', 'slug'],
  audit_log: ['action', 'actor', 'chain_id', 'data', 'hash', 'object', 'prev_hash', 'seq', 'ts'],
  kysely_migration: ['name', 'timestamp'],
  kysely_migration_lock: ['id', 'is_locked'],
};
const TENANT_TABLES = new Set(Object.keys(TENANT_TABLE_COLUMNS));

/**
 * El motor informó que el objeto YA existía: resultado seguro, el CREATE no lo creó
 * (hallazgo QA X-01). PostgreSQL: 42P04 (base) y 42710 (rol). SQL Server: 1801 (base)
 * y 15025 (login).
 */
function isAlreadyExists(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; number?: unknown };
  return e.code === '42P04' || e.code === '42710' || e.number === 1801 || e.number === 15025;
}
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Administra el ciclo de vida de las organizaciones (modalidad multiempresa, D-04).
 *
 * Usa dos tipos de credenciales:
 * - la **cuenta de aprovisionamiento** (sin superusuario) para crear bases, migrar,
 *   suspender y exportar;
 * - el **usuario propio de cada organización**, con permisos mínimos, para operar con sus
 *   datos (`openTenant`).
 */
export class TenantManager {
  protected readonly provisioner: Provisioner;
  private serverDb: Kysely<unknown> | undefined;
  private controlDb: Kysely<ControlDatabase> | undefined;
  private readonly openHandles = new Map<string, TenantHandle>();

  constructor(
    protected readonly config: PlatformDbConfig,
    private readonly masterKeys: readonly SymmetricKey[],
    options: TenantManagerOptions = {},
  ) {
    if (masterKeys.length === 0) throw new Error('Se requiere al menos una clave maestra.');
    this.provisioner = options.provisioner ?? provisionerFor(config.admin.engine);
  }

  protected get admin(): DbServerConfig {
    return this.config.admin;
  }

  protected server(): Kysely<unknown> {
    this.serverDb ??= connect<unknown>(this.admin, serverAdminDatabase(this.admin), 2);
    return this.serverDb;
  }

  protected control(): Kysely<ControlDatabase> {
    this.controlDb ??= connect<ControlDatabase>(this.admin, this.config.controlDatabase, 3);
    return this.controlDb;
  }

  /**
   * Crea la base de control si no existe, aplica sus migraciones y la protege.
   * Es idempotente. Devuelve migraciones aplicadas y avisos de endurecimiento del servidor.
   */
  async initControl(): Promise<{ applied: string[]; warnings: string[] }> {
    const name = this.config.controlDatabase;
    if (!(await this.provisioner.databaseExists(this.server(), name))) {
      await this.provisioner.createDatabase(this.server(), name);
    }
    await this.provisioner.protectControlDatabase(this.server(), this.control() as Kysely<unknown>, name);
    const { applied } = await migrateToLatest(this.control() as Kysely<unknown>, controlMigrations(this.admin.engine));
    const warnings = await this.provisioner.hardeningWarnings(this.server());
    const rows = await this.control().selectFrom('tenants').select(['slug', 'status', 'db_name']).execute();
    for (const row of rows.filter((r) => r.status === 'provisioning')) {
      warnings.push(`El alta de "${row.slug}" quedó incompleta. Ejecute: auditor-admin tenant cleanup-provisioning --slug ${row.slug}`);
    }
    // Bases con el patrón de la plataforma que no figuran en la base de control (p. ej. un
    // corte de conexión justo después de crearlas): se informan para eliminarlas (QA N-01).
    const known = new Set(rows.map((r) => r.db_name));
    for (const db of await this.provisioner.listPlatformDatabases(this.server())) {
      if (!known.has(db)) {
        warnings.push(`La base "${db}" tiene el formato de la plataforma pero no está registrada en esta base de control. Si no pertenece a otra instalación, elimínela: DROP DATABASE "${db}";`);
      }
    }
    return { applied, warnings };
  }

  /**
   * Da de alta una organización: base propia, usuario propio, DEK propia y primera
   * entrada de bitácora. Si algo falla, deshace exactamente lo que esta operación creó.
   * Si no puede saberse si un recurso se creó (error después de enviar el CREATE), el
   * registro queda en `provisioning` para limpiarlo con `cleanupProvisioning` (QA N-01).
   *
   * @param actor quién ejecuta la operación (queda en la bitácora de la organización).
   */
  async createTenant(slug: string, name: string, actor: string): Promise<TenantInfo & OperationResult> {
    assertTenantSlug(slug);
    const cleanName = assertTenantName(name);
    const existing = await this.control().selectFrom('tenants').select('id').where('slug', '=', slug).executeTakeFirst();
    if (existing !== undefined) throw new Error(`Ya existe una organización con identificador "${slug}".`);

    const id = randomUUID();
    const { dbName, login } = newTenantResourceNames();
    // Los nombres son aleatorios; aun así se comprueba que no existan.
    if (await this.provisioner.databaseExists(this.server(), dbName)) throw new Error(`Ya existe la base ${dbName}; no se modifica.`);
    if (await this.provisioner.loginExists(this.server(), login)) throw new Error(`Ya existe el usuario ${login}; no se modifica.`);

    const password = generateDbPassword();
    const dek = generateKey();
    const masterKey = this.masterKeys[0] as SymmetricKey;
    const createdAt = nowIso();

    // 1. Registro en estado "provisioning": nadie puede abrir la organización aún. Si el
    //    proceso muere a mitad del alta, este registro permite limpiarla después (M-06).
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

    // Se marca cada recurso SOLO después de crearlo con éxito: la reversión nunca toca
    // algo que esta operación no creó (hallazgo QA M-01).
    let dbCreated = false;
    let loginCreated = false;
    const ambiguous: string[] = [];
    const warnings: string[] = [];
    try {
      // Cada CREATE es una sola sentencia y su bandera se marca apenas termina; las
      // restricciones posteriores son pasos aparte (QA N-01).
      try {
        await this.provisioner.createDatabase(this.server(), dbName);
      } catch (error) {
        if (!isAlreadyExists(error) && (await this.provisioner.databaseExists(this.server(), dbName).catch(() => true))) ambiguous.push(`base ${dbName}`);
        throw error;
      }
      dbCreated = true;
      await this.provisioner.restrictDatabase(this.server(), dbName);
      try {
        await this.provisioner.createLogin(this.server(), login, password, dbName);
      } catch (error) {
        if (!isAlreadyExists(error) && (await this.provisioner.loginExists(this.server(), login).catch(() => true))) ambiguous.push(`usuario ${login}`);
        throw error;
      }
      loginCreated = true;
      await this.provisioner.restrictLogin(this.server(), login);
      await this.provisioner.grantConnect(this.server(), dbName, login);

      const adminTenantDb = connect<TenantDatabase>(this.admin, dbName, 1);
      try {
        await this.provisioner.prepareTenantDatabase(adminTenantDb as Kysely<unknown>, login);
        await migrateToLatest(adminTenantDb as Kysely<unknown>, tenantMigrations(this.admin.engine));
        await this.provisioner.grantAppPrivileges(adminTenantDb as Kysely<unknown>, login);
        warnings.push(...(await this.provisioner.tenantDatabaseWarnings(adminTenantDb as Kysely<unknown>, login)));
        await adminTenantDb.insertInto('organization').values({ id, slug, name: cleanName, created_at: createdAt }).execute();
      } finally {
        await adminTenantDb.destroy();
      }

      // Comprobación con el usuario propio y primera entrada de bitácora.
      const handle = await this.openWithCredentials({ id, slug, name: cleanName, status: 'provisioning', dbName, createdAt }, login, password);
      try {
        await handle.audit.append({ actor, action: 'tenant.created', object: `organization/${slug}`, data: { name: cleanName, engine: this.admin.engine } });
      } finally {
        await handle.db.destroy();
      }

      await this.control().updateTable('tenants').set({ status: 'active', updated_at: nowIso() }).where('id', '=', id).execute();
      return { id, slug, name: cleanName, status: 'active', dbName, createdAt, warnings };
    } catch (error) {
      const cleanup = await this.rollback({ id, dbName, login, dbCreated, loginCreated, ambiguous });
      if (cleanup.length > 0) {
        throw new Error(`${message(error)} — Además, la reversión no pudo completarse: ${cleanup.join('; ')}. Ejecute: auditor-admin tenant cleanup-provisioning --slug ${slug}`, { cause: error });
      }
      throw error;
    }
  }

  /** Deshace un alta fallida. Devuelve los pasos que no pudo completar (vacío si todo ok). */
  private async rollback(r: { id: string; dbName: string; login: string; dbCreated: boolean; loginCreated: boolean; ambiguous: string[] }): Promise<string[]> {
    // Un recurso que existe pero cuyo CREATE falló no se borra aquí: no hay certeza de que
    // sea de esta operación. Se conserva el registro para decidirlo con cleanupProvisioning.
    const failures = r.ambiguous.map((x) => `no se pudo determinar si ${x} fue creado por esta operación`);
    if (r.dbCreated) {
      await this.provisioner.dropDatabase(this.server(), r.dbName).catch((e: unknown) => failures.push(`eliminar base ${r.dbName}: ${message(e)}`));
    }
    if (r.loginCreated) {
      await this.provisioner.dropLogin(this.server(), r.login).catch((e: unknown) => failures.push(`eliminar usuario ${r.login}: ${message(e)}`));
    }
    // El registro de control se conserva si quedó algo sin limpiar, para poder reintentar.
    if (failures.length === 0) {
      await this.control().deleteFrom('tenants').where('id', '=', r.id).execute().catch((e: unknown) => failures.push(`eliminar registro de control: ${message(e)}`));
    }
    return failures;
  }

  /**
   * Limpia un alta que quedó incompleta (proceso interrumpido). Solo actúa sobre
   * organizaciones en estado `provisioning`; sus nombres de base y usuario son aleatorios y
   * se registraron antes de crearlos, por lo que pertenecen a la plataforma.
   */
  async cleanupProvisioning(slug: string): Promise<void> {
    assertTenantSlug(slug);
    const row = await this.control().selectFrom('tenants').selectAll().where('slug', '=', slug).executeTakeFirst();
    if (row === undefined) throw new Error(`No existe la organización "${slug}".`);
    if (row.status !== 'provisioning') throw new Error(`La organización "${slug}" no está en alta incompleta (estado: ${row.status}); no se modifica.`);
    if (await this.provisioner.databaseExists(this.server(), row.db_name)) {
      await this.assertDatabaseBelongsTo(row);
      await this.provisioner.dropDatabase(this.server(), row.db_name);
    }
    await this.provisioner.dropLogin(this.server(), row.db_user);
    await this.control().deleteFrom('tenants').where('id', '=', row.id).execute();
  }

  /**
   * Antes de eliminar una base, comprueba que sea de esta organización: no declara otra
   * organización y no contiene NINGÚN objeto ajeno a la plataforma (tablas en cualquier
   * esquema, vistas, secuencias, funciones, tipos, objetos grandes). Si no, se rechaza: la
   * base puede ser ajena (hallazgos QA X-01 y Z-01).
   */
  private async assertDatabaseBelongsTo(row: TenantsTable): Promise<void> {
    const db = connect<TenantDatabase>(this.admin, row.db_name, 1);
    try {
      const foreign = await this.provisioner.foreignObjects(db as Kysely<unknown>, [...TENANT_TABLES]);
      if (foreign.length > 0) {
        const shown = foreign.slice(0, 10).join(', ') + (foreign.length > 10 ? ` y ${String(foreign.length - 10)} más` : '');
        throw new Error(`La base ${row.db_name} contiene objetos ajenos a la plataforma (${shown}); no se elimina. Revísela manualmente.`);
      }
      const metadata = await db.introspection.getTables({ withInternalKyselyTables: true });
      for (const t of metadata) {
        const expected = TENANT_TABLE_COLUMNS[t.name];
        const actual = t.columns.map((c) => c.name).sort();
        if (expected !== undefined && actual.join(',') !== expected.join(',')) {
          throw new Error(`La tabla ${t.name} de la base ${row.db_name} no tiene las columnas de la plataforma (${actual.join(', ')}); no se elimina. Revísela manualmente.`);
        }
      }
      // Las migraciones registradas deben ser migraciones conocidas de la plataforma.
      if (metadata.some((t) => t.name === 'kysely_migration')) {
        const known = new Set(Object.keys(tenantMigrations(this.admin.engine)));
        const r = await sql<{ name: string }>`SELECT name FROM ${sql.table('kysely_migration')}`.execute(db);
        const unknown = r.rows.map((x) => x.name).filter((n) => !known.has(n));
        if (unknown.length > 0) {
          throw new Error(`La base ${row.db_name} registra migraciones desconocidas (${unknown.slice(0, 5).join(', ')}); no se elimina. Revísela manualmente.`);
        }
      }
      const tables = metadata.map((t) => t.name);
      let declaresThis = false;
      if (tables.includes('organization')) {
        const orgs = await db.selectFrom('organization').select('id').execute();
        if (orgs.some((o) => o.id !== row.id)) {
          throw new Error(`La base ${row.db_name} pertenece a otra organización; no se elimina. Revísela manualmente.`);
        }
        declaresThis = orgs.length > 0;
      }
      // Si la base no declara ser de esta organización, solo puede ser un alta interrumpida
      // ANTES de escribir la bitácora: entonces `audit_log` está vacía. Con filas, se trata
      // como ajena aunque la tabla tenga el nombre de la plataforma (hallazgo QA Z-04).
      if (!declaresThis && tables.includes('audit_log')) {
        const r = await sql<{ n: number | string }>`SELECT COUNT(*) AS n FROM ${sql.table('audit_log')}`.execute(db);
        if (Number(r.rows[0]?.n ?? 0) > 0) {
          throw new Error(`La base ${row.db_name} tiene datos en audit_log pero no declara pertenecer a esta organización; no se elimina. Revísela manualmente.`);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('no se elimina')) throw error;
      throw new Error(`No se pudo comprobar a quién pertenece la base ${row.db_name}; no se elimina: ${message(error)}`, { cause: error });
    } finally {
      await db.destroy();
    }
  }

  /** Lista las organizaciones registradas. */
  async listTenants(): Promise<TenantInfo[]> {
    const rows = await this.control().selectFrom('tenants').selectAll().orderBy('slug').execute();
    return rows.map(toInfo);
  }

  /**
   * Suspende o reactiva una organización. La suspensión la aplica el MOTOR (el usuario de
   * la organización no puede iniciar sesión y sus sesiones se cierran), no solo la
   * aplicación (hallazgo QA M-04). El cambio queda en la bitácora de la organización; si la
   * bitácora no puede escribirse (p. ej. está dañada), la suspensión se aplica igual y se
   * informa una advertencia: una medida de seguridad no puede quedar bloqueada (B-03).
   */
  async setStatus(slug: string, status: 'active' | 'suspended', actor: string): Promise<OperationResult> {
    assertTenantSlug(slug);
    const row = await this.findRow(slug);
    if (row.status === 'provisioning') throw new Error('La organización aún se está creando.');
    if (row.status === status) return { warnings: [] };
    const warnings: string[] = [];
    const action = status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated';

    if (status === 'suspended') {
      await this.appendAsAdmin(row, { actor, action, object: `organization/${slug}`, data: {} }).catch((e: unknown) => warnings.push(`No se registró en la bitácora: ${message(e)}`));
      await this.closeTenant(slug);
      await this.provisioner.setLoginEnabled(this.server(), row.db_user, false);
      const w = await this.provisioner.terminateSessions(this.server(), row.db_user);
      if (w !== null) warnings.push(w);
      // Se comprueba el resultado real: sesiones que sigan abiertas pueden seguir escribiendo (QA N-03).
      const open = await this.waitForNoSessions(row.db_user);
      if (open !== 0) {
        warnings.push(open < 0 ? 'No se pudo comprobar si quedan sesiones abiertas.' : `Siguen abiertas ${String(open)} sesión(es) del usuario de la organización: pueden seguir operando hasta que se cierren.`);
      }
      await this.control().updateTable('tenants').set({ status, updated_at: nowIso() }).where('id', '=', row.id).execute();
    } else {
      // Reactivar no es una medida de seguridad urgente: si la bitácora no puede registrarlo,
      // no se reactiva (la excepción de B-03 solo aplica a suspender, QA N-03).
      await this.appendAsAdmin(row, { actor, action, object: `organization/${slug}`, data: {} });
      await this.provisioner.setLoginEnabled(this.server(), row.db_user, true);
      await this.control().updateTable('tenants').set({ status, updated_at: nowIso() }).where('id', '=', row.id).execute();
    }
    return { warnings };
  }

  /**
   * Cambia la contraseña de base de datos de una organización y elimina configuraciones de
   * sesión que su usuario se haya fijado. Recupera el acceso si el usuario cambió su propia
   * contraseña (hallazgo QA M-02).
   */
  async rotatePassword(slug: string, actor: string): Promise<void> {
    const row = await this.findRow(slug);
    if (row.status === 'provisioning') throw new Error('La organización aún se está creando.');
    const password = generateDbPassword();
    const dek = unwrapKey(this.masterKeys, row.dek_wrapped, dekContext(row.id));
    await this.closeTenant(slug);
    await this.provisioner.resetPassword(this.server(), row.db_user, password, row.db_name);
    await this.control()
      .updateTable('tenants')
      .set({ db_password_sealed: seal(dek, Buffer.from(password, 'utf8'), passwordContext(row.id)), updated_at: nowIso() })
      .where('id', '=', row.id)
      .execute();
    await this.appendAsAdmin(row, { actor, action: 'tenant.password_rotated', object: `organization/${slug}`, data: {} });
  }

  /**
   * Comprueba cada organización activa: que abre con sus credenciales, que su usuario no
   * se fijó parámetros de sesión y que no puede crear objetos grandes. Lista vacía = ok.
   */
  async checkTenants(): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    const rows = await this.control().selectFrom('tenants').selectAll().where('status', '=', 'active').orderBy('slug').execute();
    for (const row of rows) {
      const problems: string[] = [];
      // Primero el descifrado, en dos pasos, porque el remedio es distinto (QA Y-02 y Z-02):
      // - si no se puede abrir la DEK, la clave maestra no corresponde (o la DEK guardada fue
      //   alterada) y rotar NO lo resuelve;
      // - si la DEK abre pero la contraseña guardada no, el registro fue alterado y rotar SÍ
      //   lo resuelve (genera una contraseña nueva y la vuelve a cifrar).
      let dek: SymmetricKey;
      try {
        dek = unwrapKey(this.masterKeys, row.dek_wrapped, dekContext(row.id));
      } catch (error) {
        if (!(error instanceof CryptoError)) throw error;
        result[row.slug] = [
          `No se pudo abrir la clave de cifrado de la organización: la clave maestra (MASTER_KEY_FILE) no corresponde a esta instalación o el registro de control fue alterado. "rotate-password" no lo resuelve; revise la clave maestra y su respaldo. (${error.message})`,
        ];
        continue;
      }
      try {
        open([dek], row.db_password_sealed, passwordContext(row.id));
      } catch (error) {
        if (!(error instanceof CryptoError)) throw error;
        result[row.slug] = [
          `La contraseña cifrada guardada en la base de control no se puede descifrar (registro alterado o dañado). Ejecute: auditor-admin tenant rotate-password --slug ${row.slug} (${error.message})`,
        ];
        continue;
      }
      try {
        const handle = await this.openRow(row);
        await handle.db.destroy();
      } catch (error) {
        problems.push(`${message(error)} — si la contraseña fue cambiada, ejecute: auditor-admin tenant rotate-password --slug ${row.slug}`);
      }
      try {
        // Parámetros de sesión fijados por el propio usuario (p. ej. solo lectura): QA N-02.
        const settings = await this.provisioner.loginSettings(this.server(), row.db_user);
        if (settings.length > 0) {
          problems.push(`El usuario tiene parámetros de sesión propios (${settings.join(', ')}). Ejecute: auditor-admin tenant rotate-password --slug ${row.slug}`);
        }
        const db = connect<unknown>(this.admin, row.db_name, 1);
        try {
          problems.push(...(await this.provisioner.tenantDatabaseWarnings(db, row.db_user)));
        } finally {
          await db.destroy();
        }
      } catch (error) {
        problems.push(`No se pudo revisar la configuración: ${message(error)}`);
      }
      result[row.slug] = problems;
    }
    return result;
  }

  /**
   * Abre la base de una organización activa con SUS credenciales.
   * Verifica que la base abierta sea realmente la de esa organización.
   */
  async openTenant(slug: string): Promise<TenantHandle> {
    assertTenantSlug(slug);
    const cached = this.openHandles.get(slug);
    if (cached !== undefined) return cached;
    const row = await this.findRow(slug);
    if (row.status !== 'active') throw new Error(`La organización "${slug}" no está activa (estado: ${row.status}).`);
    const handle = await this.openRow(row);
    this.openHandles.set(slug, handle);
    return handle;
  }

  /**
   * Exportación forense de la bitácora, con la cuenta de aprovisionamiento y en solo
   * lectura. Funciona también con organizaciones suspendidas (hallazgo QA M-05) y no
   * depende de las credenciales de la organización, que su usuario podría haber cambiado.
   */
  async exportAuditLog(slug: string): Promise<Record<string, unknown>[]> {
    const row = await this.findRow(slug);
    if (row.status === 'provisioning') throw new Error('La organización aún se está creando.');
    const db = connect<TenantDatabase>(this.admin, row.db_name, 1);
    try {
      return await new AuditLogRepository(db, this.admin.engine, row.slug).exportRaw();
    } finally {
      await db.destroy();
    }
  }

  /**
   * Aplica migraciones pendientes a todas las organizaciones. Un fallo en una no detiene a
   * las demás: se informa por organización (hallazgo QA M-07).
   */
  async migrateAllTenants(actor: string): Promise<Record<string, TenantMigrationResult>> {
    const result: Record<string, TenantMigrationResult> = {};
    const rows = await this.control().selectFrom('tenants').selectAll().where('status', '!=', 'provisioning').orderBy('slug').execute();
    for (const row of rows) {
      const adminTenantDb = connect<unknown>(this.admin, row.db_name, 1);
      try {
        const { applied } = await migrateToLatest(adminTenantDb, tenantMigrations(this.admin.engine));
        await this.provisioner.grantAppPrivileges(adminTenantDb, row.db_user);
        result[row.slug] = { applied };
        if (applied.length > 0) {
          await this.appendAsAdmin(row, { actor, action: 'schema.migrated', object: `organization/${row.slug}`, data: { migrations: applied } });
        }
      } catch (error) {
        result[row.slug] = { applied: [], error: message(error) };
      } finally {
        await adminTenantDb.destroy();
      }
    }
    return result;
  }

  /** Cierra la conexión abierta de una organización en este proceso. */
  async closeTenant(slug: string): Promise<void> {
    const handle = this.openHandles.get(slug);
    if (handle !== undefined) {
      this.openHandles.delete(slug);
      await handle.db.destroy();
    }
  }

  /** Cierra todas las conexiones. */
  async close(): Promise<void> {
    for (const slug of [...this.openHandles.keys()]) await this.closeTenant(slug);
    await this.controlDb?.destroy();
    await this.serverDb?.destroy();
    this.controlDb = undefined;
    this.serverDb = undefined;
  }

  /**
   * Cerrar una sesión es asíncrono en el motor: se espera hasta 5 s a que desaparezcan.
   * Devuelve las que siguen abiertas, o -1 si no se pudo comprobar.
   */
  private async waitForNoSessions(login: string): Promise<number> {
    let open = -1;
    for (let attempt = 0; attempt < 25; attempt++) {
      open = await this.provisioner.countSessions(this.server(), login).catch(() => -1);
      if (open <= 0) return open;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return open;
  }

  protected async findRow(slug: string): Promise<TenantsTable> {
    assertTenantSlug(slug);
    const row = await this.control().selectFrom('tenants').selectAll().where('slug', '=', slug).executeTakeFirst();
    if (row === undefined) throw new Error(`No existe la organización "${slug}".`);
    return row;
  }

  protected decryptPassword(row: TenantsTable): string {
    const dek = unwrapKey(this.masterKeys, row.dek_wrapped, dekContext(row.id));
    return open([dek], row.db_password_sealed, passwordContext(row.id)).toString('utf8');
  }

  /**
   * Escribe en la bitácora con la cuenta de aprovisionamiento: necesario cuando la
   * organización está suspendida (su usuario no puede iniciar sesión).
   */
  private async appendAsAdmin(row: TenantsTable, input: Parameters<AuditLogRepository['append']>[0]): Promise<void> {
    const db = connect<TenantDatabase>(this.admin, row.db_name, 1);
    try {
      await new AuditLogRepository(db, this.admin.engine, row.slug).append(input);
    } finally {
      await db.destroy();
    }
  }

  private async openRow(row: TenantsTable): Promise<TenantHandle> {
    return this.openWithCredentials(toInfo(row), row.db_user, this.decryptPassword(row));
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

function toInfo(r: TenantsTable): TenantInfo {
  return { id: r.id, slug: r.slug, name: r.name, status: r.status, dbName: r.db_name, createdAt: r.created_at };
}
