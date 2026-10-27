// SPDX-License-Identifier: AGPL-3.0-or-later
// Pruebas de integración contra motores reales (PostgreSQL y SQL Server).
// Solo datos sintéticos. Cada ejecución crea su propia base de control y la elimina al final.

import { parseJsonlLines, toJsonl, verifyChainItems } from '@auditor-21719/audit-log';
import { generateKey } from '@auditor-21719/crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, serverAdminDatabase, TenantManager, type ControlDatabase, type TenantDatabase } from '../src/index.js';
import { provisionerFor } from '../src/provisioner.js';
import { engineConfigs, runId } from './helpers.js';

const engines = engineConfigs();

if (engines.length === 0) {
  describe('integración con bases de datos', () => {
    it.skip('sin motores configurados (defina TEST_PG_HOST o TEST_MSSQL_HOST)', () => undefined);
  });
}

describe.each(engines)('organizaciones en $engine', ({ engine, server }) => {
  const id = runId();
  const controlDatabase = `auditor_ctl_test_${id}`;
  const slugA = `prueba-${id}-a`;
  const slugB = `prueba-${id}-b`;
  const master = generateKey();
  let manager: TenantManager;

  beforeAll(async () => {
    manager = new TenantManager({ admin: server, controlDatabase }, [master]);
    await manager.initControl();
    await manager.createTenant(slugA, 'Municipalidad Ficticia A', 'operador:pruebas');
    await manager.createTenant(slugB, 'Empresa Ficticia B', 'operador:pruebas');
  });

  afterAll(async () => {
    await manager.destroyTenantForTests(slugA).catch(() => undefined);
    await manager.destroyTenantForTests(slugB).catch(() => undefined);
    await manager.close();
    const serverDb = connect<unknown>(server, serverAdminDatabase(server), 1);
    await provisionerFor(engine).dropDatabaseAndLogin(serverDb, controlDatabase, '__ninguno__').catch(() => undefined);
    await serverDb.destroy();
  });

  it('la base de control es idempotente: una segunda inicialización no aplica nada', async () => {
    expect(await manager.initControl()).toEqual([]);
  });

  it('cada organización tiene su propia base y queda activa', async () => {
    const list = await manager.listTenants();
    const a = list.find((t) => t.slug === slugA);
    const b = list.find((t) => t.slug === slugB);
    expect(a?.status).toBe('active');
    expect(b?.status).toBe('active');
    expect(a?.dbName).not.toBe(b?.dbName);
  });

  it('el alta queda en la bitácora de la organización, con su propia cadena', async () => {
    const a = await manager.openTenant(slugA);
    const entries = await a.audit.exportRaw();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ chainId: slugA, seq: 0, action: 'tenant.created', actor: 'operador:pruebas' });
  });

  it('PT-12 (base): las credenciales de A no abren la base de B ni la base de control', async () => {
    const credsA = await manager.credentialsForTests(slugA);
    const credsB = await manager.credentialsForTests(slugB);
    const asA = { ...server, user: credsA.user, password: credsA.password };
    for (const target of [credsB.dbName, controlDatabase]) {
      const db = connect<unknown>(asA, target, 1);
      await expect(sql`SELECT 1 AS n`.execute(db)).rejects.toThrow();
      await db.destroy();
    }
  });

  it('el usuario de aplicación no puede modificar ni borrar la bitácora (solo-anexar en el motor)', async () => {
    const a = await manager.openTenant(slugA);
    await expect(a.db.updateTable('audit_log').set({ actor: 'atacante' }).where('seq', '=', 0).execute()).rejects.toThrow();
    await expect(a.db.deleteFrom('audit_log').where('seq', '=', 0).execute()).rejects.toThrow();
  });

  it('20 escrituras concurrentes (bloqueo exclusivo) producen una cadena continua y válida', async () => {
    const b = await manager.openTenant(slugB);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => b.audit.append({ actor: 'usuario-sintetico', action: 'prueba.concurrencia', object: `o/${i}` })),
    );
    const text = toJsonl(await b.audit.exportRaw());
    const result = verifyChainItems(parseJsonlLines(text), slugB);
    expect(result.issues).toEqual([]);
    expect(result.count).toBe(21);
  });

  it('PT-04 sobre la base de datos: una modificación hecha con la cuenta administrativa se detecta al verificar la exportación', async () => {
    const credsA = await manager.credentialsForTests(slugA);
    const adminA = connect<TenantDatabase>(server, credsA.dbName, 1);
    await adminA.updateTable('audit_log').set({ actor: 'atacante' }).where('seq', '=', 0).execute();
    await adminA.destroy();
    const a = await manager.openTenant(slugA);
    const result = verifyChainItems(parseJsonlLines(toJsonl(await a.audit.exportRaw())), slugA);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.reason.includes('alterada'))).toBe(true);
  });

  it('las credenciales se guardan cifradas y no pueden intercambiarse entre organizaciones', async () => {
    const control = connect<ControlDatabase>(server, controlDatabase, 1);
    const credsA = await manager.credentialsForTests(slugA);
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

  it('una organización suspendida no puede abrirse y la suspensión queda en su bitácora', async () => {
    await manager.setStatus(slugB, 'suspended', 'operador:pruebas');
    await expect(manager.openTenant(slugB)).rejects.toThrow(/no está activa/);
    await manager.setStatus(slugB, 'active', 'operador:pruebas');
    const b = await manager.openTenant(slugB);
    const actions = (await b.audit.exportRaw()).map((e) => e.action);
    expect(actions.slice(-2)).toEqual(['tenant.suspended', 'tenant.reactivated']);
  });

  it('no se puede repetir un identificador ni pisar una base existente que no creó la plataforma', async () => {
    await expect(manager.createTenant(slugA, 'Duplicada', 'operador:pruebas')).rejects.toThrow(/Ya existe una organización/);
    const slugC = `prueba-${id}-c`;
    const serverDb = connect<unknown>(server, serverAdminDatabase(server), 1);
    const provisioner = provisionerFor(engine);
    await provisioner.createDatabase(serverDb, `auditor_t_prueba_${id}_c`);
    await expect(manager.createTenant(slugC, 'Choque', 'operador:pruebas')).rejects.toThrow(/Ya existe una base/);
    // La base preexistente sigue ahí: la plataforma no la tocó.
    expect(await provisioner.databaseExists(serverDb, `auditor_t_prueba_${id}_c`)).toBe(true);
    expect((await manager.listTenants()).some((t) => t.slug === slugC)).toBe(false);
    await provisioner.dropDatabaseAndLogin(serverDb, `auditor_t_prueba_${id}_c`, '__ninguno__');
    await serverDb.destroy();
  });

  it('rechaza identificadores que podrían inyectar SQL en nombres de bases', async () => {
    for (const bad of ['a"; DROP DATABASE x; --', 'Mayus', 'ab', 'x'.repeat(31), '-inicio', 'doble--guion']) {
      await expect(manager.createTenant(bad, 'Mala', 'operador:pruebas')).rejects.toThrow(/Identificador de organización inválido/);
    }
  });

  it('migrar todas las organizaciones es idempotente', async () => {
    const result = await manager.migrateAllTenants('operador:pruebas');
    expect(result[slugA]).toEqual([]);
    expect(result[slugB]).toEqual([]);
  });
});
