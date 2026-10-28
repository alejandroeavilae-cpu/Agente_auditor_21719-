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
  tenant suspend --slug <id>               Suspende una organización: el motor bloquea su usuario
  tenant reactivate --slug <id>            Reactiva una organización suspendida
  tenant check                             Comprueba que cada organización activa puede abrirse
  tenant rotate-password --slug <id>       Cambia la contraseña de base de datos de una organización
  tenant cleanup-provisioning --slug <id>  Limpia un alta que quedó incompleta
  audit export --tenant <id> [--out <archivo>]
                                           Exporta la bitácora en JSONL (también de organizaciones suspendidas)

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

/** `parseArgs` con errores de uso convertidos en `UsageError` (código de salida 2, hallazgo QA B-05). */
function parse<T extends Record<string, { type: 'string' }>>(args: string[], options: T): { [K in keyof T]?: string } {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value === '') throw new UsageError(`Falta --${name}.`);
  return value;
}

/** Imprime avisos en la salida de errores. Devuelve si hubo alguno. */
function printWarnings(warnings: readonly string[]): boolean {
  for (const w of warnings) console.error(`Aviso: ${w}`);
  return warnings.length > 0;
}

/**
 * Escribe un archivo nuevo. O_EXCL hace fallar la apertura si el archivo ya existe
 * (también si es un enlace simbólico, aunque apunte a un archivo inexistente): nunca se
 * sobrescribe ni se escribe a través de un enlace. El error informa la causa real (B-05).
 */
function writeNewFile(path: string, content: string): void {
  let fd: number;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o640);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ELOOP') throw new Error(`El archivo ya existe (o es un enlace); no se sobrescribe: ${path}`, { cause: error });
    throw new Error(`No se puede crear el archivo ${path}: ${code ?? String(error)}`, { cause: error });
  }
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

const S = { type: 'string' } as const;
/** Opciones admitidas por cada comando. */
const COMMANDS: Record<string, Record<string, typeof S>> = {
  init: {},
  'tenant create': { slug: S, name: S },
  'tenant list': {},
  'tenant suspend': { slug: S },
  'tenant reactivate': { slug: S },
  'tenant check': {},
  'tenant rotate-password': { slug: S },
  'tenant cleanup-provisioning': { slug: S },
  'audit export': { tenant: S, out: S },
};

async function run(argv: string[]): Promise<number> {
  const [group, command, ...rest] = argv;
  if (group === undefined || group === '--help' || group === 'help') {
    console.log(USAGE);
    return group === undefined ? 2 : 0;
  }
  const key = group === 'init' ? (command === undefined ? 'init' : `init ${command}`) : `${group} ${command ?? ''}`;
  // Comando y opciones se validan ANTES de leer configuración o secretos.
  const spec = COMMANDS[key];
  if (spec === undefined) throw new UsageError(`Comando desconocido: ${key.trim()}`);
  const v = parse(key === 'init' ? [] : rest, spec);
  for (const name of ['slug', 'name', 'tenant'] as const) {
    if (name in spec) required(v[name], name);
  }

  const m = manager();
  try {
    switch (key) {
      case 'init': {
        const { applied, warnings } = await m.initControl();
        console.log(`Base de control: ${applied.length === 0 ? 'al día' : `migraciones aplicadas: ${applied.join(', ')}`}`);
        printWarnings(warnings);
        let failed = false;
        for (const [slug, r] of Object.entries(await m.migrateAllTenants(ACTOR))) {
          if (r.error !== undefined) {
            failed = true;
            console.error(`Organización ${slug}: ERROR al migrar: ${r.error}`);
          } else {
            console.log(`Organización ${slug}: ${r.applied.length === 0 ? 'al día' : `migraciones aplicadas: ${r.applied.join(', ')}`}`);
          }
        }
        return failed ? 1 : 0;
      }
      case 'tenant create': {
        const t = await m.createTenant(required(v.slug, 'slug'), required(v.name, 'name'), ACTOR);
        console.log(`Organización creada: ${t.slug} (${t.name}) · base ${t.dbName} · estado ${t.status}`);
        printWarnings(t.warnings);
        return 0;
      }
      case 'tenant list': {
        const list = await m.listTenants();
        if (list.length === 0) console.log('No hay organizaciones registradas.');
        for (const t of list) console.log(`${t.slug.padEnd(30)} ${t.status.padEnd(12)} ${t.dbName.padEnd(28)} ${t.name}`);
        return 0;
      }
      case 'tenant suspend':
      case 'tenant reactivate': {
        const slug = required(v.slug, 'slug');
        const { warnings } = await m.setStatus(slug, command === 'suspend' ? 'suspended' : 'active', ACTOR);
        console.log(`Organización ${slug}: ${command === 'suspend' ? 'suspendida' : 'reactivada'}.`);
        printWarnings(warnings);
        return 0;
      }
      case 'tenant check': {
        let failed = false;
        for (const [slug, problem] of Object.entries(await m.checkTenants())) {
          if (problem === null) console.log(`${slug}: ok`);
          else {
            failed = true;
            console.error(`${slug}: ERROR: ${problem}`);
          }
        }
        return failed ? 1 : 0;
      }
      case 'tenant rotate-password': {
        const slug = required(v.slug, 'slug');
        await m.rotatePassword(slug, ACTOR);
        console.log(`Organización ${slug}: contraseña de base de datos cambiada.`);
        return 0;
      }
      case 'tenant cleanup-provisioning': {
        const slug = required(v.slug, 'slug');
        await m.cleanupProvisioning(slug);
        console.log(`Organización ${slug}: alta incompleta eliminada. Puede volver a crearla.`);
        return 0;
      }
      default: {
        // audit export
        const tenant = required(v.tenant, 'tenant');
        const jsonl = toJsonl(await m.exportAuditLog(tenant));
        if (v.out === undefined) {
          process.stdout.write(jsonl);
        } else {
          writeNewFile(v.out, jsonl);
          console.error(`Bitácora exportada a ${v.out}. Identificador de cadena (--chain-id): ${tenant}`);
        }
        return 0;
      }
    }
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
