#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CLI de administración de la plataforma (`auditor-admin`).
 *
 * Se ejecuta en el servidor (o dentro del contenedor de la API) por quien administra la
 * instalación. En la entrega 2A no existen usuarios ni autenticación: por eso estas
 * operaciones NO se exponen por HTTP, solo por línea de comandos en el propio servidor.
 *
 * Variables de entorno: DB_ENGINE, DB_HOST, DB_PORT, DB_ADMIN_USER, DB_ADMIN_PASSWORD_FILE,
 * DB_CONTROL_DATABASE, DB_TLS, MASTER_KEY_FILE y MASTER_KEY_CHECK_PERMISSIONS.
 *
 * Códigos de salida: 0 éxito · 1 error de operación · 2 error de uso.
 */

import { toJsonl } from '@auditor-21719/audit-log';
import { loadMasterKey } from '@auditor-21719/crypto';
import { loadPlatformDbConfig, TenantManager } from '@auditor-21719/persistence';
import { closeSync, constants, openSync, realpathSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const USAGE = `Uso: auditor-admin <comando>

  init                                     Crea/migra la base de control y migra todas las organizaciones
  tenant create --slug <id> --name <nombre> Da de alta una organización con base y usuario propios
  tenant list                              Lista las organizaciones
  tenant suspend --slug <id>               Suspende una organización (queda en su bitácora)
  tenant reactivate --slug <id>            Reactiva una organización suspendida
  audit export --tenant <id> [--out <archivo>]
                                           Exporta la bitácora en JSONL (a la salida estándar si no hay --out)

Verifique una exportación con la CLI independiente:
  auditor-log verify --entries <archivo> --chain-id <id> [--anchors ... --public-key ...]`;

/** Identidad registrada en las bitácoras para acciones de esta CLI (sin usuarios hasta 2B). */
const ACTOR = 'operador-plataforma:cli';

class UsageError extends Error {}

function manager(): TenantManager {
  const config = loadPlatformDbConfig();
  const keyFile = process.env.MASTER_KEY_FILE;
  if (keyFile === undefined || keyFile === '') throw new UsageError('Falta MASTER_KEY_FILE.');
  const checkPermissions = process.env.MASTER_KEY_CHECK_PERMISSIONS !== 'false';
  return new TenantManager(config, [loadMasterKey(keyFile, { checkPermissions })]);
}

function slugArg(args: string[], name: 'slug' | 'tenant'): string {
  const { values } = parseArgs({ args, options: { [name]: { type: 'string' } }, strict: true });
  const value = values[name];
  if (typeof value !== 'string' || value === '') throw new UsageError(`Falta --${name}.`);
  return value;
}

/**
 * Escribe un archivo nuevo. O_EXCL hace fallar la apertura si el archivo ya existe
 * (también si es un enlace simbólico, aunque apunte a un archivo inexistente): nunca se
 * sobrescribe ni se escribe a través de un enlace.
 */
function writeNewFile(path: string, content: string): void {
  let fd: number;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o640);
  } catch {
    throw new UsageError(`No se puede crear el archivo (¿ya existe?); no se sobrescribe: ${path}`);
  }
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

async function run(argv: string[]): Promise<number> {
  const [group, command, ...rest] = argv;
  if (group === undefined || group === '--help' || group === 'help') {
    console.log(USAGE);
    return group === undefined ? 2 : 0;
  }

  const m = manager();
  try {
    if (group === 'init' && command === undefined) {
      const applied = await m.initControl();
      console.log(`Base de control: ${applied.length === 0 ? 'al día' : `migraciones aplicadas: ${applied.join(', ')}`}`);
      const tenants = await m.migrateAllTenants(ACTOR);
      for (const [slug, list] of Object.entries(tenants)) {
        console.log(`Organización ${slug}: ${list.length === 0 ? 'al día' : `migraciones aplicadas: ${list.join(', ')}`}`);
      }
      return 0;
    }
    if (group === 'tenant' && command === 'create') {
      const { values } = parseArgs({ args: rest, options: { slug: { type: 'string' }, name: { type: 'string' } }, strict: true });
      if (!values.slug || !values.name) throw new UsageError('Faltan --slug o --name.');
      const t = await m.createTenant(values.slug, values.name, ACTOR);
      console.log(`Organización creada: ${t.slug} (${t.name}) · base ${t.dbName} · estado ${t.status}`);
      return 0;
    }
    if (group === 'tenant' && command === 'list') {
      const list = await m.listTenants();
      if (list.length === 0) console.log('No hay organizaciones registradas.');
      for (const t of list) console.log(`${t.slug.padEnd(30)} ${t.status.padEnd(12)} ${t.dbName.padEnd(45)} ${t.name}`);
      return 0;
    }
    if (group === 'tenant' && (command === 'suspend' || command === 'reactivate')) {
      const slug = slugArg(rest, 'slug');
      await m.setStatus(slug, command === 'suspend' ? 'suspended' : 'active', ACTOR);
      console.log(`Organización ${slug}: ${command === 'suspend' ? 'suspendida' : 'reactivada'}.`);
      return 0;
    }
    if (group === 'audit' && command === 'export') {
      const { values } = parseArgs({ args: rest, options: { tenant: { type: 'string' }, out: { type: 'string' } }, strict: true });
      if (!values.tenant) throw new UsageError('Falta --tenant.');
      const handle = await m.openTenant(values.tenant);
      const jsonl = toJsonl(await handle.audit.exportRaw());
      if (values.out === undefined) {
        process.stdout.write(jsonl);
      } else {
        writeNewFile(values.out, jsonl);
        console.error(`Bitácora exportada a ${values.out}. Identificador de cadena (--chain-id): ${values.tenant}`);
      }
      return 0;
    }
    throw new UsageError(`Comando desconocido: ${[group, command].filter(Boolean).join(' ')}`);
  } finally {
    await m.close();
  }
}

export async function main(argv: string[]): Promise<number> {
  try {
    return await run(argv);
  } catch (error) {
    // Los mensajes de error nunca incluyen contraseñas: las credenciales no se imprimen.
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof UsageError) {
      console.error(USAGE);
      return 2;
    }
    return 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
