// SPDX-License-Identifier: AGPL-3.0-or-later

import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import { loadMasterKey, type SymmetricKey } from '@auditor-21719/crypto';
import { assertTenantName, assertTenantSlug, defaultPort, type DbServerConfig, type OrganizationDescriptor } from '@auditor-21719/persistence';
import { z } from 'zod';

/**
 * Configuración de identidad de la API. Si `DB_ENGINE` no está definido, la API arranca sin
 * identidad (solo salud y versión, como en la Fase 1).
 *
 * Desde 2C-1 (D-87 precisada por D-88) la API **no** recibe la clave maestra, no usa la
 * cuenta `auditor_api` ni lee la base de control. Recibe solo lo de SU organización (una por
 * instalación, D-84), en tres archivos que escribe `auditor-admin api-secrets write`:
 * - `ORGANIZATION_FILE`: datos no secretos (id, slug, nombre, base, usuario, id de la DEK);
 * - `ORGANIZATION_DB_PASSWORD_FILE`: contraseña de la base de la organización;
 * - `ORGANIZATION_DEK_FILE`: DEK ya desenvuelta (mismo formato que la clave maestra).
 */
const schema = z.object({
  DB_ENGINE: z.enum(['postgresql', 'sqlserver']),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  DB_TLS: z.enum(['disable', 'verify', 'trust-server-certificate']).default('verify'),
  ORGANIZATION_FILE: z.string().min(1),
  ORGANIZATION_DB_PASSWORD_FILE: z.string().min(1),
  ORGANIZATION_DEK_FILE: z.string().min(1),
  /**
   * Comprobación opcional: si se define, debe coincidir con el identificador del archivo de
   * la organización (evita montar por error los secretos de otra instalación).
   */
  ORGANIZATION_SLUG: z.string().optional(),
  /** Rechazar archivos de secretos legibles por otros usuarios (ver `loadMasterKey`). */
  SECRETS_CHECK_PERMISSIONS: z.enum(['true', 'false']).default('true'),
  /** Cookies `Secure` (solo HTTPS). Desactivar únicamente en el perfil local sin TLS (D-81). */
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  /** Días de retención del registro de accesos con IP (D-78). */
  ACCESS_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  /**
   * Confiar en `X-Forwarded-For` de UN salto de proxy inverso (Caddy en Compose). Solo es
   * válido si la API está detrás de exactamente un proxy y no se publica directamente: si
   * no, cualquier cliente fija la IP que quiera y elude el límite por IP y el bloqueo por
   * origen (R-34, QA 2C1-05). La API lo advierte al arrancar.
   */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /** Intentos sensibles (inicio de sesión, códigos) por IP cada 5 minutos. */
  SENSITIVE_RATE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(20),
  /**
   * Fallos de una cuenta en 1 hora, desde orígenes distintos, a partir de los cuales se
   * registra `account.attack_suspected` (R-34). Valor inicial `[ESTIMACIÓN]`: 20.
   */
  ATTACK_ALERT_THRESHOLD: z.coerce.number().int().min(2).max(100_000).default(20),
});

/** Formato del archivo de la organización (lo escribe `api-secrets write`). */
const organizationFileSchema = z.strictObject({
  id: z.uuid(),
  slug: z.string().min(1).max(30),
  name: z.string().min(1).max(200),
  dbName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
  dbUser: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/),
  dekId: z.string().regex(/^[0-9a-f]{16}$/),
});

export interface IdentityConfig {
  /** Motor y destino; las credenciales son las de la organización. */
  server: Omit<DbServerConfig, 'user' | 'password'>;
  organization: OrganizationDescriptor;
  dbPassword: string;
  dek: SymmetricKey;
  cookieSecure: boolean;
  accessLogRetentionDays: number;
  trustProxy: boolean;
  sensitiveRateLimit: number;
  attackAlertThreshold: number;
}

const HINT = 'Ejecute: auditor-admin api-secrets write --tenant <id> --out <directorio> (ver docs/fase-1/ejecucion-local.md).';

/**
 * Lee un archivo de secreto pequeño. Con la comprobación activa rechaza enlaces simbólicos y
 * archivos legibles por grupo u otros, igual que la clave maestra (hallazgo QA B-09). La
 * comprobación se hace sobre el descriptor abierto, sin carrera entre comprobar y leer.
 */
function readSecretFile(path: string, variable: string, checkPermissions: boolean): string {
  let fd: number | undefined;
  try {
    try {
      const flags = constants.O_RDONLY | constants.O_NONBLOCK;
      fd = openSync(path, checkPermissions ? flags | constants.O_NOFOLLOW : flags);
    } catch {
      throw new Error(`No se pudo leer ${variable} (${path}). ${HINT}`);
    }
    const info = fstatSync(fd);
    if (!info.isFile()) throw new Error(`${variable} debe ser un archivo regular: ${path}`);
    if (checkPermissions && (info.mode & 0o077) !== 0) throw new Error(`Permisos inseguros en ${path} (${variable}): solo su dueño debe poder leerlo (chmod 600).`);
    const content = readFileSync(fd, 'utf8').trim();
    if (content === '') throw new Error(`${variable} está vacío (${path}). ${HINT}`);
    return content;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function loadIdentityConfig(env: NodeJS.ProcessEnv = process.env): IdentityConfig | undefined {
  if (env.DB_ENGINE === undefined || env.DB_ENGINE === '') return undefined;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración de identidad inválida: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const v = parsed.data;
  const check = v.SECRETS_CHECK_PERMISSIONS === 'true';
  // El archivo de la organización no es secreto, pero se valida igual de estricto.
  let organization: OrganizationDescriptor;
  try {
    organization = organizationFileSchema.parse(JSON.parse(readSecretFile(v.ORGANIZATION_FILE, 'ORGANIZATION_FILE', false)));
    assertTenantSlug(organization.slug);
    assertTenantName(organization.name);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ORGANIZATION_FILE')) throw error;
    throw new Error(`ORGANIZATION_FILE no tiene el formato esperado (${v.ORGANIZATION_FILE}). ${HINT}`, { cause: error });
  }
  if (v.ORGANIZATION_SLUG !== undefined && v.ORGANIZATION_SLUG !== '' && v.ORGANIZATION_SLUG !== organization.slug) {
    throw new Error(`ORGANIZATION_SLUG ("${v.ORGANIZATION_SLUG}") no coincide con la organización de ORGANIZATION_FILE ("${organization.slug}").`);
  }
  const dbPassword = readSecretFile(v.ORGANIZATION_DB_PASSWORD_FILE, 'ORGANIZATION_DB_PASSWORD_FILE', check);
  let dek: SymmetricKey;
  try {
    dek = loadMasterKey(v.ORGANIZATION_DEK_FILE, { checkPermissions: check });
  } catch (error) {
    throw new Error(`No se pudo cargar ORGANIZATION_DEK_FILE (${v.ORGANIZATION_DEK_FILE}): ${error instanceof Error ? error.message : String(error)} ${HINT}`, { cause: error });
  }
  if (dek.id !== organization.dekId) {
    throw new Error(`La DEK de ORGANIZATION_DEK_FILE no corresponde a la organización "${organization.slug}". ${HINT}`);
  }
  return {
    server: { engine: v.DB_ENGINE, host: v.DB_HOST, port: v.DB_PORT ?? defaultPort(v.DB_ENGINE), tls: v.DB_TLS },
    organization,
    dbPassword,
    dek,
    cookieSecure: v.COOKIE_SECURE === 'true',
    accessLogRetentionDays: v.ACCESS_LOG_RETENTION_DAYS,
    trustProxy: v.TRUST_PROXY === 'true',
    sensitiveRateLimit: v.SENSITIVE_RATE_LIMIT,
    attackAlertThreshold: v.ATTACK_ALERT_THRESHOLD,
  };
}
