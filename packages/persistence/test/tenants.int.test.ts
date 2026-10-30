// SPDX-License-Identifier: AGPL-3.0-or-later
// Pruebas de integración contra motores reales (PostgreSQL y SQL Server).
// Solo datos sintéticos. Cada ejecución crea su propia cuenta de aprovisionamiento (sin
// superusuario) y su propia base de control, y elimina todo al final.

import { parseJsonlLines, toJsonl, verifyChainItems } from '@auditor-21719/audit-log';
import { generateKey } from '@auditor-21719/crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, provisionerFor, serverAdminDatabase, type ControlDatabase, type DbServerConfig, type Provisioner, type TenantDatabase } from '../src/index.js';
import { createProvisionerAccount, engineConfigs, runId, TestTenantManager } from './helpers.js';

const engines = engineConfigs();

if (engines.length === 0) {
  describe('integración con bases de datos', () => {
    it.skip('sin motores configurados (defina TEST_PG_HOST o TEST_MSSQL_HOST)', () => undefined);
  });
}

/** Ejecuta una consulta trivial con unas credenciales; devuelve el error o null. */
async function tryConnect(server: DbServerConfig, database: string): Promise<unknown> {
  const db = connect<unknown>(server, database, 1);
  try {
    await sql`SELECT 1 AS n`.execute(db);
    return null;
  } catch (error) {
    return error;
  } finally {
    await db.destroy();
  }
}

describe.each(engines)('organizaciones en $engine', ({ engine, server: superServer }) => {
  const id = runId();
  const controlDatabase = `auditor_ctl_test_${id}`;
  const slugA = `prueba-${id}-a`;
  const slugB = `prueba-${id}-b`;
  const master = generateKey();
  const real = provisionerFor(engine);
  let server: DbServerConfig;
  let dropAccount: () => Promise<void>;
  let manager: TestTenantManager;
  const extra: string[] = [];

  /** Administrador con un aprovisionador alterado para inyectar fallos. */
  const managerWith = (overrides: Partial<Provisioner>): TestTenantManager =>
    new TestTenantManager({ admin: server, controlDatabase }, [master], { provisioner: { ...real, ...overrides } });

  beforeAll(async () => {
    const account = await createProvisionerAccount(superServer, id);
    server = account.server;
    dropAccount = account.drop;
    manager = new TestTenantManager({ admin: server, controlDatabase }, [master]);
    await manager.initControl();
    await manager.createTenant(slugA, 'Municipalidad Ficticia A', 'operador:pruebas');
    await manager.createTenant(slugB, 'Empresa Ficticia B', 'operador:pruebas');
  });

  afterAll(async () => {
    for (const slug of [slugA, slugB, ...extra]) await manager.destroy(slug).catch(() => undefined);
    await manager.close();
    const serverDb = connect<unknown>(server, serverAdminDatabase(server), 1);
    await real.dropDatabase(serverDb, controlDatabase).catch(() => undefined);
    await serverDb.destroy();
    await dropAccount();
  });

  it('la cuenta de aprovisionamiento no es superusuario', async () => {
    const db = connect<unknown>(server, serverAdminDatabase(server), 1);
    const r =
      engine === 'postgresql'
        ? await sql<{ s: boolean }>`SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user`.execute(db)
        : await sql<{ s: number }>`SELECT IS_SRVROLEMEMBER('sysadmin') AS s`.execute(db);
    await db.destroy();
    expect(Boolean(r.rows[0]?.s)).toBe(false);
  });

  it('la base de control es idempotente: una segunda inicialización no aplica nada ni advierte sobre bases de la plataforma', async () => {
    const { applied, warnings } = await manager.initControl();
    expect(applied).toEqual([]);
    // Puede advertir sobre bases ajenas del servidor de pruebas, nunca sobre la de control,
    // las de organizaciones ni las del sistema ya endurecidas.
    expect(warnings.filter((w) => /auditor_t_|auditor_ctl_|"postgres"|"template1"|incompleta/.test(w))).toEqual([]);
  });

  it('cada organización tiene su propia base, con nombre opaco, y queda activa', async () => {
    const list = await manager.listTenants();
    const a = list.find((t) => t.slug === slugA);
    const b = list.find((t) => t.slug === slugB);
    expect(a?.status).toBe('active');
    expect(b?.status).toBe('active');
    expect(a?.dbName).not.toBe(b?.dbName);
    expect(a?.dbName).toMatch(/^auditor_t_[0-9a-f]{12}$/);
    expect(a?.dbName).not.toContain(id);
  });

  it('el alta queda en la bitácora de la organización, con su propia cadena', async () => {
    const entries = await manager.exportAuditLog(slugA);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ chainId: slugA, seq: 0, action: 'tenant.created', actor: 'operador:pruebas' });
  });

  it('PT-12 (base): las credenciales de A no abren la base de B, la de control ni las del sistema', async () => {
    const credsA = await manager.credentials(slugA);
    const credsB = await manager.credentials(slugB);
    const asA = { ...server, user: credsA.user, password: credsA.password };
    const targets = [credsB.dbName, controlDatabase];
    // En SQL Server, master y tempdb admiten invitado por diseño del motor (riesgo residual
    // documentado); en PostgreSQL la preparación del servidor les quita el acceso público.
    if (engine === 'postgresql') targets.push('postgres', 'template1');
    for (const target of targets) {
      expect(await tryConnect(asA, target), target).not.toBeNull();
    }
    expect(await tryConnect(asA, credsA.dbName)).toBeNull();
  });

  it('el usuario de una organización no ve identificadores de otras organizaciones (sí cuántas hay en PostgreSQL: R-32)', async () => {
    const credsA = await manager.credentials(slugA);
    const credsB = await manager.credentials(slugB);
    const a = connect<unknown>({ ...server, user: credsA.user, password: credsA.password }, credsA.dbName, 1);
    const names =
      engine === 'postgresql'
        ? (await sql<{ n: string }>`SELECT datname AS n FROM pg_database UNION ALL SELECT rolname FROM pg_roles`.execute(a)).rows.map((r) => r.n)
        : (await sql<{ n: string }>`SELECT name AS n FROM sys.databases`.execute(a)).rows.map((r) => r.n);
    await a.destroy();
    // Ningún nombre visible revela el identificador de una organización.
    expect(names.filter((n) => n.includes('prueba') || (n.startsWith('auditor_t_') && n.includes(id)))).toEqual([]);
    if (engine === 'sqlserver') {
      expect(names).not.toContain(credsB.dbName);
      expect(names).not.toContain(controlDatabase);
    }
  });

  it('el usuario de aplicación no puede modificar ni borrar la bitácora (solo-anexar en el motor)', async () => {
    const a = await manager.openTenant(slugA);
    await expect(a.db.updateTable('audit_log').set({ actor: 'atacante' }).where('seq', '=', 0).execute()).rejects.toThrow();
    await expect(a.db.deleteFrom('audit_log').where('seq', '=', 0).execute()).rejects.toThrow();
    if (engine === 'postgresql') {
      // Objetos grandes: canal de escritura fuera de la bitácora (hallazgo QA B-12).
      await expect(sql`SELECT lo_creat(-1)`.execute(a.db)).rejects.toThrow();
    }
  });

  it('20 escrituras concurrentes (bloqueo exclusivo) producen una cadena continua y válida', async () => {
    const b = await manager.openTenant(slugB);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => b.audit.append({ actor: 'usuario-sintetico', action: 'prueba.concurrencia', object: `o/${i}` })),
    );
    const result = verifyChainItems(parseJsonlLines(toJsonl(await manager.exportAuditLog(slugB))), slugB);
    expect(result.issues).toEqual([]);
    expect(result.count).toBe(21);
  });

  it('las credenciales se guardan cifradas y no pueden intercambiarse entre organizaciones', async () => {
    const control = connect<ControlDatabase>(server, controlDatabase, 1);
    const credsA = await manager.credentials(slugA);
    const rowA = await control.selectFrom('tenants').selectAll().where('slug', '=', slugA).executeTakeFirstOrThrow();
    const rowB = await control.selectFrom('tenants').selectAll().where('slug', '=', slugB).executeTakeFirstOrThrow();
    expect(rowA.db_password_sealed).not.toContain(credsA.password);
    // Un atacante con escritura en la base de control copia la contraseña cifrada de B en A.
    await control.updateTable('tenants').set({ db_password_sealed: rowB.db_password_sealed }).where('slug', '=', slugA).execute();
    await manager.closeTenant(slugA);
    await expect(manager.openTenant(slugA)).rejects.toThrow(/descifrar/);
    await control.updateTable('tenants').set({ db_password_sealed: rowA.db_password_sealed }).where('slug', '=', slugA).execute();
    await control.destroy();
    await expect(manager.openTenant(slugA)).resolves.toBeDefined();
  });

  it('M-04/M-05: la suspensión la aplica el motor, queda en la bitácora y la exportación sigue disponible', async () => {
    const credsB = await manager.credentials(slugB);
    const asB = { ...server, user: credsB.user, password: credsB.password };
    // Una conexión abierta antes de suspender (otro proceso) también queda cortada.
    const other = connect<TenantDatabase>(asB, credsB.dbName, 1);
    await sql`SELECT 1 AS n`.execute(other);

    expect(await manager.setStatus(slugB, 'suspended', 'operador:pruebas')).toEqual({ warnings: [] });
    await expect(manager.openTenant(slugB)).rejects.toThrow(/no está activa/);
    expect(await tryConnect(asB, credsB.dbName)).not.toBeNull();
    await expect(other.insertInto('audit_log').values({ seq: 999, chain_id: 'x', ts: 'x', actor: 'x', action: 'x', object: 'x', data: '{}', prev_hash: 'x', hash: 'x' }).execute()).rejects.toThrow();
    await other.destroy();

    const exported = await manager.exportAuditLog(slugB);
    expect(exported.at(-1)).toMatchObject({ action: 'tenant.suspended' });

    await manager.setStatus(slugB, 'active', 'operador:pruebas');
    expect(await tryConnect(asB, credsB.dbName)).toBeNull();
    const actions = (await manager.exportAuditLog(slugB)).map((e) => e.action);
    expect(actions.slice(-2)).toEqual(['tenant.suspended', 'tenant.reactivated']);
  });

  it('M-02: si el usuario de la organización cambia su contraseña, se detecta y la rotación recupera el acceso', async () => {
    const credsA = await manager.credentials(slugA);
    const asA = connect<unknown>({ ...server, user: credsA.user, password: credsA.password }, credsA.dbName, 1);
    const stolen = 'Cambiada-por-el-usuario-2026x';
    if (engine === 'postgresql') {
      await sql`ALTER ROLE CURRENT_USER PASSWORD ${sql.lit(stolen)}`.execute(asA);
      await sql`ALTER ROLE CURRENT_USER SET statement_timeout = '1ms'`.execute(asA);
      // También solo para su base (QA N-02): dejaría la bitácora en solo lectura.
      await sql`ALTER ROLE CURRENT_USER IN DATABASE ${sql.id(credsA.dbName)} SET default_transaction_read_only = on`.execute(asA);
      // Y para una base AJENA (QA X-02): rotate-password también debe borrarlo.
      await sql`ALTER ROLE CURRENT_USER IN DATABASE ${sql.id(controlDatabase)} SET statement_timeout = '1ms'`.execute(asA);
    } else {
      await sql`ALTER LOGIN ${sql.id(credsA.user)} WITH PASSWORD = ${sql.lit(stolen)} OLD_PASSWORD = ${sql.lit(credsA.password)}`.execute(asA);
    }
    await asA.destroy();
    await manager.closeTenant(slugA);

    const check = await manager.checkTenants();
    expect(check[slugA]?.join(' ')).toMatch(/rotate-password/);
    if (engine === 'postgresql') expect(check[slugA]?.join(' ')).toMatch(/default_transaction_read_only/);
    expect(check[slugB]).toEqual([]);

    await manager.rotatePassword(slugA, 'operador:pruebas');
    expect((await manager.checkTenants())[slugA]).toEqual([]);
    const a = await manager.openTenant(slugA);
    // Las configuraciones que el usuario se fijó (statement_timeout, solo lectura) fueron eliminadas.
    await expect(a.audit.append({ actor: 'usuario-sintetico', action: 'prueba.post-rotacion', object: 'o/1' })).resolves.toBeDefined();
    const actions = (await manager.exportAuditLog(slugA)).map((e) => e.action);
    expect(actions).toContain('tenant.password_rotated');
  });

  it('PT-04 sobre la base de datos: una modificación hecha con la cuenta administrativa se detecta al verificar la exportación', async () => {
    const credsA = await manager.credentials(slugA);
    const adminA = connect<TenantDatabase>(server, credsA.dbName, 1);
    await adminA.updateTable('audit_log').set({ actor: 'atacante' }).where('seq', '=', 0).execute();
    await adminA.destroy();
    const result = verifyChainItems(parseJsonlLines(toJsonl(await manager.exportAuditLog(slugA))), slugA);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.reason.includes('alterada'))).toBe(true);
  });

  it('B-03: con la bitácora dañada la suspensión igual se aplica y se informa', async () => {
    const credsA = await manager.credentials(slugA);
    const adminA = connect<TenantDatabase>(server, credsA.dbName, 1);
    const last = await adminA.selectFrom('audit_log').select('seq').orderBy('seq', 'desc').executeTakeFirstOrThrow();
    await adminA.updateTable('audit_log').set({ data: 'no-es-json' }).where('seq', '=', last.seq).execute();
    const result = await manager.setStatus(slugA, 'suspended', 'operador:pruebas');
    expect(result.warnings.join(' ')).toMatch(/No se registró en la bitácora/);
    expect((await manager.listTenants()).find((t) => t.slug === slugA)?.status).toBe('suspended');
    expect(await tryConnect({ ...server, user: credsA.user, password: credsA.password }, credsA.dbName)).not.toBeNull();
    // Reactivar sí exige poder registrarlo (QA N-03): se rechaza y sigue suspendida.
    await expect(manager.setStatus(slugA, 'active', 'operador:pruebas')).rejects.toThrow();
    expect((await manager.listTenants()).find((t) => t.slug === slugA)?.status).toBe('suspended');
    expect(await tryConnect({ ...server, user: credsA.user, password: credsA.password }, credsA.dbName)).not.toBeNull();
    await adminA.updateTable('audit_log').set({ data: '{}' }).where('seq', '=', last.seq).execute();
    await adminA.destroy();
    await manager.setStatus(slugA, 'active', 'operador:pruebas');
  });

  it('A-01: si falla un paso del alta, la reversión elimina base, usuario y registro', async () => {
    const slug = `prueba-${id}-f`;
    let created: { dbName: string; login: string } | undefined;
    const spy = managerWith({
      createLogin: async (s, login, password, dbName) => {
        created = { dbName, login };
        await real.createLogin(s, login, password, dbName);
      },
      grantAppPrivileges: () => Promise.reject(new Error('fallo inyectado')),
    });
    await expect(spy.createTenant(slug, 'Falla', 'operador:pruebas')).rejects.toThrow('fallo inyectado');
    await spy.close();
    expect(created).toBeDefined();
    const serverDb = connect<unknown>(server, serverAdminDatabase(server), 1);
    expect(await real.databaseExists(serverDb, created?.dbName ?? '')).toBe(false);
    expect(await real.loginExists(serverDb, created?.login ?? '')).toBe(false);
    await serverDb.destroy();
    expect((await manager.listTenants()).some((t) => t.slug === slug)).toBe(false);
  });

  it('M-01/X-01: si el CREATE informa "ya existe", la base ajena se conserva y el alta se revierte', async () => {
    const slug = `prueba-${id}-g`;
    let foreign = '';
    // Simula una carrera: otro actor crea la base justo entre la comprobación y el CREATE.
    const racing = managerWith({
      createDatabase: async (s, dbName) => {
        foreign = dbName;
        await real.createDatabase(s, dbName);
        await real.createDatabase(s, dbName); // el segundo CREATE falla: "ya existe"
      },
    });
    // "Ya existe" es un resultado seguro: la base no es de esta operación y no se toca.
    await expect(racing.createTenant(slug, 'Carrera', 'operador:pruebas')).rejects.toThrow(/exist/i);
    await racing.close();
    const serverDb = connect<unknown>(server, serverAdminDatabase(server), 1);
    expect(await real.databaseExists(serverDb, foreign)).toBe(true);
    expect((await manager.listTenants()).some((t) => t.slug === slug)).toBe(false);
    await real.dropDatabase(serverDb, foreign);
    await serverDb.destroy();
  });

  it('X-01: cleanupProvisioning no elimina una base con tablas ajenas', async () => {
    const slug = `prueba-${id}-x`;
    let created = '';
    // Corte de conexión simulado: el CREATE se ejecutó pero se informa un error distinto
    // de "ya existe" → autoría incierta → el alta queda en provisioning.
    const cut = managerWith({
      createDatabase: async (s, dbName) => {
        created = dbName;
        await real.createDatabase(s, dbName);
        throw new Error('conexión interrumpida (simulada)');
      },
    });
    await expect(cut.createTenant(slug, 'Corte', 'operador:pruebas')).rejects.toThrow(/cleanup-provisioning/);
    await cut.close();
    expect((await manager.listTenants()).find((t) => t.slug === slug)?.status).toBe('provisioning');

    const target = connect<unknown>(server, created, 1);
    await sql`CREATE TABLE datos_ajenos (n int)`.execute(target);
    await expect(manager.cleanupProvisioning(slug)).rejects.toThrow(/objetos ajenos/);
    const serverDb = connect<unknown>(server, serverAdminDatabase(server), 1);
    expect(await real.databaseExists(serverDb, created)).toBe(true);
    await sql`DROP TABLE datos_ajenos`.execute(target);
    // Z-01: tampoco con objetos ajenos fuera de public ni de otros tipos.
    const variants: [string, string][] =
      engine === 'postgresql'
        ? [
            ['CREATE SCHEMA otro; CREATE TABLE otro.audit_log (n int)', 'DROP SCHEMA otro CASCADE'],
            ['CREATE MATERIALIZED VIEW vm AS SELECT 1 AS n', 'DROP MATERIALIZED VIEW vm'],
            ['CREATE SEQUENCE sec', 'DROP SEQUENCE sec'],
            ["CREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1'", 'DROP FUNCTION f()'],
            ["CREATE TYPE estado AS ENUM ('a')", 'DROP TYPE estado'],
          ]
        : [
            ['CREATE TABLE dbo.vista_base (n int)', 'DROP TABLE dbo.vista_base'],
            ['CREATE SEQUENCE dbo.sec START WITH 1', 'DROP SEQUENCE dbo.sec'],
          ];
    for (const [create, drop] of variants) {
      for (const stmt of create.split('; ')) await sql.raw(stmt).execute(target);
      await expect(manager.cleanupProvisioning(slug), create).rejects.toThrow(/objetos ajenos/);
      await sql.raw(drop).execute(target);
    }
    // Z-04: tabla con nombre de la plataforma pero con datos ajenos.
    await sql.raw('CREATE TABLE audit_log (secreto varchar(50))').execute(target);
    await sql.raw("INSERT INTO audit_log (secreto) VALUES ('dato-sintetico-ajeno')").execute(target);
    await expect(manager.cleanupProvisioning(slug)).rejects.toThrow(/columnas de la plataforma|datos en audit_log/);
    await sql.raw('DROP TABLE audit_log').execute(target);
    // Z-05: tabla de migraciones con nombre de Kysely pero columnas y datos ajenos.
    await sql.raw('CREATE TABLE kysely_migration (secreto varchar(50))').execute(target);
    await sql.raw("INSERT INTO kysely_migration (secreto) VALUES ('dato-sintetico-ajeno')").execute(target);
    await expect(manager.cleanupProvisioning(slug)).rejects.toThrow(/columnas de la plataforma/);
    await sql.raw('DROP TABLE kysely_migration').execute(target);
    // Z-05: columnas correctas pero una migración desconocida.
    await sql.raw('CREATE TABLE kysely_migration (name varchar(255), timestamp varchar(255))').execute(target);
    await sql.raw("INSERT INTO kysely_migration (name, timestamp) VALUES ('datos-ajenos', 'x')").execute(target);
    await expect(manager.cleanupProvisioning(slug)).rejects.toThrow(/migraciones desconocidas/);
    await sql.raw('DROP TABLE kysely_migration').execute(target);
    if (engine === 'postgresql') {
      // Objeto grande: la cuenta de aprovisionamiento no puede crearlo (template1 endurecido),
      // así que lo crea el superusuario de pruebas.
      const asSuper = connect<unknown>(superServer, created, 1);
      await sql`SELECT lo_from_bytea(424242, 'x'::bytea)`.execute(asSuper);
      await expect(manager.cleanupProvisioning(slug)).rejects.toThrow(/objetos ajenos/);
      await sql`SELECT lo_unlink(424242)`.execute(asSuper);
      await asSuper.destroy();
    }
    if (engine === 'sqlserver') {
      await sql.raw('CREATE SCHEMA otro').execute(target);
      await sql.raw('CREATE TABLE otro.audit_log (n int)').execute(target);
      await expect(manager.cleanupProvisioning(slug)).rejects.toThrow(/objetos ajenos/);
      await sql.raw('DROP TABLE otro.audit_log').execute(target);
      await sql.raw('DROP SCHEMA otro').execute(target);
    }
    await target.destroy();
    // Sin tablas ajenas, la limpieza procede.
    await manager.cleanupProvisioning(slug);
    expect(await real.databaseExists(serverDb, created)).toBe(false);
    await serverDb.destroy();
    expect((await manager.listTenants()).some((t) => t.slug === slug)).toBe(false);
  });

  it('Z-02: si se altera la contraseña cifrada guardada, tenant check recomienda rotar y rotar lo resuelve', async () => {
    const control = connect<ControlDatabase>(server, controlDatabase, 1);
    const rowB = await control.selectFrom('tenants').selectAll().where('slug', '=', slugB).executeTakeFirstOrThrow();
    const rowA = await control.selectFrom('tenants').selectAll().where('slug', '=', slugA).executeTakeFirstOrThrow();
    // Sobre de otra organización: formato válido, pero no se descifra con la DEK de B.
    await control.updateTable('tenants').set({ db_password_sealed: rowA.db_password_sealed }).where('slug', '=', slugB).execute();
    await control.destroy();
    await manager.closeTenant(slugB);
    const check = await manager.checkTenants();
    expect(check[slugB]?.join(' ')).toMatch(/rotate-password --slug/);
    expect(check[slugB]?.join(' ')).not.toMatch(/no lo resuelve/);
    await manager.rotatePassword(slugB, 'operador:pruebas');
    expect((await manager.checkTenants())[slugB]).toEqual([]);
    expect(rowB.id).toBeDefined();
  });

  it('Y-02: con una clave maestra que no corresponde, tenant check lo dice y no recomienda rotar', async () => {
    const wrong = new TestTenantManager({ admin: server, controlDatabase }, [generateKey()]);
    try {
      const check = await wrong.checkTenants();
      expect(check[slugA]?.join(' ')).toMatch(/clave maestra/);
      expect(check[slugA]?.join(' ')).toMatch(/no lo resuelve/);
    } finally {
      await wrong.close();
    }
  });

  it('N-01: si falla una restricción posterior al CREATE, la base creada igual se elimina', async () => {
    const slug = `prueba-${id}-n`;
    let created = '';
    const failing = managerWith({
      createDatabase: async (s, dbName) => {
        created = dbName;
        await real.createDatabase(s, dbName);
      },
      restrictDatabase: () => Promise.reject(new Error('fallo inyectado tras CREATE')),
    });
    await expect(failing.createTenant(slug, 'Restricción', 'operador:pruebas')).rejects.toThrow('fallo inyectado tras CREATE');
    await failing.close();
    const serverDb = connect<unknown>(server, serverAdminDatabase(server), 1);
    expect(await real.databaseExists(serverDb, created)).toBe(false);
    await serverDb.destroy();
    expect((await manager.listTenants()).some((t) => t.slug === slug)).toBe(false);
  });

  it('N-01: init informa bases con el formato de la plataforma que no están registradas', async () => {
    const orphan = 'auditor_t_0000000000ff';
    const serverDb = connect<unknown>(server, serverAdminDatabase(server), 1);
    await real.createDatabase(serverDb, orphan);
    try {
      expect((await manager.initControl()).warnings.join(' ')).toContain(orphan);
    } finally {
      await real.dropDatabase(serverDb, orphan);
      await serverDb.destroy();
    }
  });

  it('M-06: un alta que no pudo revertirse queda señalada y se limpia con cleanupProvisioning', async () => {
    const slug = `prueba-${id}-h`;
    extra.push(slug);
    const broken = managerWith({
      grantAppPrivileges: () => Promise.reject(new Error('fallo inyectado')),
      dropDatabase: () => Promise.reject(new Error('caída simulada')),
    });
    await expect(broken.createTenant(slug, 'Interrumpida', 'operador:pruebas')).rejects.toThrow(/cleanup-provisioning/);
    await broken.close();
    expect((await manager.listTenants()).find((t) => t.slug === slug)?.status).toBe('provisioning');
    expect((await manager.initControl()).warnings.join(' ')).toContain(slug);
    await expect(manager.cleanupProvisioning(slugA)).rejects.toThrow(/no está en alta incompleta/);
    await manager.cleanupProvisioning(slug);
    expect((await manager.listTenants()).some((t) => t.slug === slug)).toBe(false);
  });

  it('M-07: migrar todas las organizaciones informa cada una y no se detiene ante un fallo', async () => {
    const credsA = await manager.credentials(slugA);
    const partial = managerWith({
      grantAppPrivileges: (db, login) => (login === credsA.user ? Promise.reject(new Error('fallo inyectado')) : real.grantAppPrivileges(db, login)),
    });
    const result = await partial.migrateAllTenants('operador:pruebas');
    await partial.close();
    expect(result[slugA]).toEqual({ applied: [], error: 'fallo inyectado' });
    expect(result[slugB]).toEqual({ applied: [] });
    // Sin fallos, todo queda al día (idempotente).
    const ok = await manager.migrateAllTenants('operador:pruebas');
    expect(ok[slugA]).toEqual({ applied: [] });
    expect(ok[slugB]).toEqual({ applied: [] });
  });

  it('B-01/B-02: la exportación conserva un seq fuera de rango seguro y una fecha futura bloquea nuevas entradas', async () => {
    const credsB = await manager.credentials(slugB);
    const adminB = connect<TenantDatabase>(server, credsB.dbName, 1);
    const last = await adminB.selectFrom('audit_log').select(['seq', 'ts']).orderBy('seq', 'desc').executeTakeFirstOrThrow();
    const lastSeq = Number(last.seq);

    // B-02: una última entrada fechada en el futuro (alteración) no se propaga a la siguiente.
    await adminB.updateTable('audit_log').set({ ts: '2099-01-01T00:00:00.000Z' }).where('seq', '=', lastSeq).execute();
    const b = await manager.openTenant(slugB);
    await expect(b.audit.append({ actor: 'usuario-sintetico', action: 'prueba.fecha', object: 'o/1' })).rejects.toThrow(/fecha futura/);
    await adminB.updateTable('audit_log').set({ ts: last.ts }).where('seq', '=', lastSeq).execute();

    // B-01: un seq mayor que 2^53 se exporta exacto, como texto.
    await adminB.updateTable('audit_log').set({ seq: '9007199254740993' }).where('seq', '=', lastSeq).execute();
    const exported = await manager.exportAuditLog(slugB);
    expect(exported.at(-1)?.seq).toBe('9007199254740993');
    await adminB.updateTable('audit_log').set({ seq: lastSeq }).where('seq', '=', '9007199254740993').execute();
    await adminB.destroy();
    expect(verifyChainItems(parseJsonlLines(toJsonl(await manager.exportAuditLog(slugB))), slugB).ok).toBe(true);
  });

  it('2C-2: la exportación por lotes entrega exactamente lo mismo que la completa, con cualquier tamaño de lote y con límite superior', async () => {
    const a = await manager.openTenant(slugA);
    for (let i = 0; i < 7; i++) await a.audit.append({ actor: 'usuario-sintetico', action: 'prueba.lote', object: `o/${String(i)}` });
    const full = await a.audit.exportRaw();
    expect(full.length).toBeGreaterThan(7);
    for (const size of [1, 3, full.length, 1000]) {
      const got: Record<string, unknown>[] = [];
      for await (const batch of a.audit.exportRawBatches(size)) {
        expect(batch.length).toBeLessThanOrEqual(size);
        got.push(...batch);
      }
      expect(got, `lote de ${String(size)}`).toEqual(full);
    }
    // Límite superior: lo que se agregue después del inicio de la exportación no se incluye.
    const upTo = await a.audit.lastSeqRaw();
    expect(Number(upTo)).toBe(full.at(-1)?.seq);
    await a.audit.append({ actor: 'usuario-sintetico', action: 'prueba.lote', object: 'o/posterior' });
    const bounded: Record<string, unknown>[] = [];
    for await (const batch of a.audit.exportRawBatches(2, upTo)) bounded.push(...batch);
    // (La cadena de A fue alterada a propósito en PT-04: aquí se compara el contenido, no la integridad.)
    expect(bounded).toEqual(full);
    // Bitácora vacía (null) no entrega nada; un lote inválido se rechaza.
    expect((await a.audit.exportRawBatches(2, null).next()).done).toBe(true);
    await expect(a.audit.exportRawBatches(0).next()).rejects.toThrow(/lote/);
  });

  it('2C-2: la migración 0004 se aplica a una organización existente; los usuarios quedan sin cambio obligatorio y la cuenta de la organización puede usar la columna', async () => {
    const credsB = await manager.credentials(slugB);
    const adminB = connect<unknown>(server, credsB.dbName, 1);
    const ts = new Date().toISOString();
    try {
      // Simula una organización de 2C-1: sin la columna ni el registro de la migración 0004.
      if (engine === 'postgresql') {
        await sql`ALTER TABLE app_user DROP COLUMN must_change_password`.execute(adminB);
      } else {
        // SQL Server: antes de quitar la columna hay que quitar su restricción DEFAULT (nombre generado).
        await sql`DECLARE @c sysname; SELECT @c = d.name FROM sys.default_constraints d JOIN sys.columns c ON d.parent_object_id = c.object_id AND d.parent_column_id = c.column_id WHERE d.parent_object_id = OBJECT_ID('dbo.app_user') AND c.name = 'must_change_password'; IF @c IS NOT NULL EXEC('ALTER TABLE dbo.app_user DROP CONSTRAINT ' + QUOTENAME(@c)); ALTER TABLE dbo.app_user DROP COLUMN must_change_password;`.execute(adminB);
      }
      await sql`DELETE FROM kysely_migration WHERE name = ${'0004_must_change_password'}`.execute(adminB);
      // Usuario sintético existente antes de la migración.
      await sql`INSERT INTO app_user (id, email, display_name, status, failed_attempts, mfa_failed_attempts, created_at, updated_at) VALUES (${'00000000-0000-4000-8000-000000000004'}, ${'previo@ejemplo.cl'}, ${'Usuario Previo'}, ${'active'}, 0, 0, ${ts}, ${ts})`.execute(adminB);
    } finally {
      await adminB.destroy();
    }
    const result = await manager.migrateAllTenants('operador:pruebas');
    expect(result[slugB]).toEqual({ applied: ['0004_must_change_password'] });
    expect(result[slugA]).toEqual({ applied: [] });
    // Con la cuenta de la organización (la que usa la API): lee 0 y puede modificarla.
    const asB = connect<TenantDatabase>({ ...server, user: credsB.user, password: credsB.password }, credsB.dbName, 1);
    try {
      const read = async (): Promise<number> => (await asB.selectFrom('app_user').select('must_change_password').where('email', '=', 'previo@ejemplo.cl').executeTakeFirstOrThrow()).must_change_password;
      expect(await read()).toBe(0);
      await asB.updateTable('app_user').set({ must_change_password: 1 }).where('email', '=', 'previo@ejemplo.cl').execute();
      expect(await read()).toBe(1);
    } finally {
      await asB.destroy();
    }
    const actions = (await manager.exportAuditLog(slugB)).map((e) => e.action);
    expect(actions.at(-1)).toBe('schema.migrated');
  });

  it('rechaza identificadores que podrían inyectar SQL y nombres con caracteres de control', async () => {
    for (const bad of ['a"; DROP DATABASE x; --', 'Mayus', 'ab', 'x'.repeat(31), '-inicio', 'doble--guion']) {
      await expect(manager.createTenant(bad, 'Mala', 'operador:pruebas')).rejects.toThrow(/Identificador de organización inválido/);
    }
    await expect(manager.createTenant(`prueba-${id}-z`, 'Nombre\u001b[31m', 'operador:pruebas')).rejects.toThrow(/caracteres de control/);
    await expect(manager.createTenant(slugA, 'Duplicada', 'operador:pruebas')).rejects.toThrow(/Ya existe una organización/);
  });
});
