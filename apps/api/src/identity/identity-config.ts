// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { assertTenantSlug, defaultPort, type PlatformDbConfig } from '@auditor-21719/persistence';
import { z } from 'zod';

/**
 * Configuración de identidad de la API (2B). Si `DB_ENGINE` no está definido, la API
 * arranca sin identidad (solo salud y versión, como en la Fase 1).
 *
 * La API usa una cuenta de base de datos de **solo lectura del registro de
 * organizaciones** (`DB_API_USER`), nunca la de aprovisionamiento (D-80), y la clave
 * maestra para abrir las credenciales de cada organización.
 */
const schema = z.object({
  DB_ENGINE: z.enum(['postgresql', 'sqlserver']),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  DB_API_USER: z.string().min(1),
  DB_API_PASSWORD_FILE: z.string().min(1),
  DB_CONTROL_DATABASE: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/).default('auditor_control'),
  DB_TLS: z.enum(['disable', 'verify', 'trust-server-certificate']).default('verify'),
  MASTER_KEY_FILE: z.string().min(1),
  MASTER_KEY_CHECK_PERMISSIONS: z.enum(['true', 'false']).default('true'),
  /** Organización usada cuando el inicio de sesión no indica una (D-75). */
  DEFAULT_ORGANIZATION: z.string().optional(),
  /** Cookies `Secure` (solo HTTPS). Desactivar únicamente en pruebas locales sin TLS. */
  COOKIE_SECURE: z.enum(['true', 'false']).default('true'),
  /** Días de retención del registro de accesos con IP (D-78). */
  ACCESS_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  /** Confiar en `X-Forwarded-For` del proxy inverso (Caddy en Compose). */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /** Intentos sensibles (inicio de sesión, códigos) por IP cada 5 minutos. */
  SENSITIVE_RATE_LIMIT: z.coerce.number().int().min(1).max(100_000).default(20),
});

export interface IdentityConfig {
  db: PlatformDbConfig;
  masterKeyFile: string;
  checkMasterKeyPermissions: boolean;
  defaultOrganization: string | undefined;
  cookieSecure: boolean;
  accessLogRetentionDays: number;
  trustProxy: boolean;
  sensitiveRateLimit: number;
}

export function loadIdentityConfig(env: NodeJS.ProcessEnv = process.env): IdentityConfig | undefined {
  if (env.DB_ENGINE === undefined || env.DB_ENGINE === '') return undefined;
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración de identidad inválida: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const v = parsed.data;
  if (v.DEFAULT_ORGANIZATION !== undefined && v.DEFAULT_ORGANIZATION !== '') assertTenantSlug(v.DEFAULT_ORGANIZATION);
  let password: string;
  try {
    password = readFileSync(v.DB_API_PASSWORD_FILE, 'utf8').trim();
  } catch {
    throw new Error(`No se pudo leer DB_API_PASSWORD_FILE (${v.DB_API_PASSWORD_FILE}).`);
  }
  return {
    db: {
      admin: { engine: v.DB_ENGINE, host: v.DB_HOST, port: v.DB_PORT ?? defaultPort(v.DB_ENGINE), user: v.DB_API_USER, password, tls: v.DB_TLS },
      controlDatabase: v.DB_CONTROL_DATABASE,
    },
    masterKeyFile: v.MASTER_KEY_FILE,
    checkMasterKeyPermissions: v.MASTER_KEY_CHECK_PERMISSIONS === 'true',
    defaultOrganization: v.DEFAULT_ORGANIZATION === '' ? undefined : v.DEFAULT_ORGANIZATION,
    cookieSecure: v.COOKIE_SECURE === 'true',
    accessLogRetentionDays: v.ACCESS_LOG_RETENTION_DAYS,
    trustProxy: v.TRUST_PROXY === 'true',
    sensitiveRateLimit: v.SENSITIVE_RATE_LIMIT,
  };
}
