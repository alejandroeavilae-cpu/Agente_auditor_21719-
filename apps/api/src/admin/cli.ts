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
 * Desde 2C-1 (D-87) la CLI es, junto con el servicio del operador de 2C-3, el único lugar
 * con la clave maestra: entrega a la API solo los secretos de su organización
 * (`api-secrets write`).
 *
 * Códigos de salida: 0 éxito · 1 error de operación · 2 error de uso.
 */

import { toJsonl } from '@auditor-21719/audit-log';
import { loadMasterKey } from '@auditor-21719/crypto';
import { loadPlatformDbConfig, TenantManager } from '@auditor-21719/persistence';
import { IdentityService } from '../identity/identity.service.js';
import { checkSecretsDir, writeApiSecrets } from './api-secrets.js';
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
  tenant rotate-password --slug <id> [--api-secrets-out <dir>]
                                           Cambia la contraseña de base de datos de una organización
                                           (con --api-secrets-out reescribe los secretos de la API;
                                           después hay que reiniciar la API)
  tenant cleanup-provisioning --slug <id>  Limpia un alta que quedó incompleta
  user invite-admin --tenant <id> --email <correo> --name <nombre>
                                           Invita al primer administrador de una organización
                                           (imprime un token de activación de un solo uso, 24 h)
  user unlock --tenant <id> --email <correo>
                                           Desbloquea una cuenta bloqueada por intentos fallidos
  api-secrets write --tenant <id> --out <dir>
                                           Escribe los secretos que necesita la API (datos de la
                                           organización, contraseña de su base y su DEK), 0600.
                                           La API no recibe la clave maestra (D-87)
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
  'tenant rotate-password': { slug: S, 'api-secrets-out': S },
  'tenant cleanup-provisioning': { slug: S },
  'user invite-admin': { tenant: S, email: S, name: S },
  'user unlock': { tenant: S, email: S },
  'audit export': { tenant: S, out: S },
  'api-secrets write': { tenant: S, out: S },
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
  for (const name of ['slug', 'name', 'tenant', 'email'] as const) {
    if (name in spec) required(v[name], name);
  }
  if (key === 'api-secrets write') required(v.out, 'out');

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
        console.log(`Organización ${slug}: ${command === 'suspend' ? 'suspendida' : 'reactivada'}${warnings.length > 0 ? ', CON ADVERTENCIAS' : ''}.`);
        // Con advertencias el código de salida es 1: un script no debe darlo por completo (QA N-03).
        return printWarnings(warnings) ? 1 : 0;
      }
      case 'tenant check': {
        let failed = false;
        for (const [slug, problems] of Object.entries(await m.checkTenants())) {
          if (problems.length === 0) console.log(`${slug}: ok`);
          else {
            failed = true;
            for (const p of problems) console.error(`${slug}: ERROR: ${p}`);
          }
        }
        return failed ? 1 : 0;
      }
      case 'tenant rotate-password': {
        const slug = required(v.slug, 'slug');
        const out = v['api-secrets-out'];
        // El destino se revisa ANTES de cambiar la contraseña: si no sirve, no se cambia nada.
        if (out !== undefined) checkSecretsDir(out);
        const secrets = await m.rotatePassword(slug, ACTOR);
        console.log(`Organización ${slug}: contraseña de base de datos cambiada.`);
        if (out === undefined) {
          console.error(`Aviso: la API de ${slug} conserva la contraseña anterior y dejará de conectarse. Ejecute: auditor-admin api-secrets write --tenant ${slug} --out <dir> y reinicie la API.`);
          return 0;
        }
        try {
          writeApiSecrets(out, secrets);
        } catch (error) {
          throw new Error(`La contraseña se cambió, pero no se pudieron escribir los secretos de la API (${error instanceof Error ? error.message : String(error)}). Ejecute: auditor-admin api-secrets write --tenant ${slug} --out <dir>`, { cause: error });
        }
        console.log(`Secretos de la API reescritos en ${out}. Reinicie la API para que use la contraseña nueva.`);
        return 0;
      }
      case 'api-secrets write': {
        const tenant = required(v.tenant, 'tenant');
        const out = required(v.out, 'out');
        checkSecretsDir(out);
        const written = writeApiSecrets(out, await m.apiSecrets(tenant, ACTOR));
        console.log(`Secretos de la API de ${tenant} escritos (permisos 0600): ${written.join(', ')}`);
        console.log('Contienen la contraseña de la base y la llave de la organización: no los copie fuera del servidor. Reinicie la API si ya estaba en marcha.');
        return 0;
      }
      case 'tenant cleanup-provisioning': {
        const slug = required(v.slug, 'slug');
        await m.cleanupProvisioning(slug);
        console.log(`Organización ${slug}: alta incompleta eliminada. Puede volver a crearla.`);
        return 0;
      }
      case 'user invite-admin': {
        const tenant = required(v.tenant, 'tenant');
        const handle = await m.openTenant(tenant);
        const service = new IdentityService({ open: () => m.openTenant(tenant) }, { accessLogRetentionDays: 90 });
        const invited = await service.inviteUser(handle, { label: ACTOR }, { email: required(v.email, 'email'), displayName: required(v.name, 'name'), roles: ['org_admin'] }, null);
        console.log(`Administrador invitado en ${tenant}. Vence: ${invited.expiresAt}`);
        console.log('Entregue este token de activación por un canal seguro (se muestra UNA sola vez):');
        console.log(invited.activationToken);
        console.log('Con él, la persona fija su contraseña (POST /api/v1/auth/activate) y luego debe configurar la verificación en dos pasos (obligatoria para todos, D-86).');
        return 0;
      }
      case 'user unlock': {
        const tenant = required(v.tenant, 'tenant');
        const handle = await m.openTenant(tenant);
        const service = new IdentityService({ open: () => m.openTenant(tenant) }, { accessLogRetentionDays: 90 });
        await service.unlockUser(handle, { label: ACTOR }, await service.userIdByEmail(handle, required(v.email, 'email')), null);
        console.log(`Cuenta desbloqueada en ${tenant}.`);
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
