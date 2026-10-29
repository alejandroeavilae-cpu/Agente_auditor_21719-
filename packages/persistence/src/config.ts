// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { assertControlDatabaseName } from './naming.js';

/** Motores de base de datos soportados (decisión D-03). */
export type DbEngine = 'postgresql' | 'sqlserver';

/**
 * Modo de cifrado de la conexión al motor:
 * - `disable`: sin TLS. Solo aceptable cuando la base corre en una red interna aislada
 *   (perfil Compose local, red `backend` sin salida).
 * - `verify`: TLS con verificación del certificado del servidor.
 * - `trust-server-certificate`: TLS sin verificar el certificado. **Solo para pruebas**
 *   (contenedores con certificado autofirmado).
 */
export type DbTlsMode = 'disable' | 'verify' | 'trust-server-certificate';

/** Credenciales para conectarse a un servidor de base de datos. */
export interface DbServerConfig {
  engine: DbEngine;
  host: string;
  port: number;
  user: string;
  password: string;
  tls: DbTlsMode;
}

/** Configuración completa que necesita la administración de organizaciones. */
export interface PlatformDbConfig {
  /** Cuenta administrativa: crea bases y usuarios de cada organización. */
  admin: DbServerConfig;
  /** Nombre de la base de control (registro de organizaciones). */
  controlDatabase: string;
}

const envSchema = z.object({
  DB_ENGINE: z.enum(['postgresql', 'sqlserver']),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  DB_ADMIN_USER: z.string().min(1),
  // La contraseña se lee de un archivo montado; nunca de una variable visible en `docker inspect`.
  DB_ADMIN_PASSWORD_FILE: z.string().min(1),
  DB_CONTROL_DATABASE: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,62}$/).default('auditor_control'),
  DB_TLS: z.enum(['disable', 'verify', 'trust-server-certificate']).default('verify'),
});

/** Puerto por defecto de cada motor. */
export function defaultPort(engine: DbEngine): number {
  return engine === 'postgresql' ? 5432 : 1433;
}

/**
 * Lee la configuración de base de datos desde variables de entorno.
 * Falla cerrada: cualquier valor inválido detiene el proceso con un mensaje claro.
 */
export function loadPlatformDbConfig(env: NodeJS.ProcessEnv = process.env): PlatformDbConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración de base de datos inválida: ${detail}`);
  }
  const v = parsed.data;
  assertControlDatabaseName(v.DB_CONTROL_DATABASE);
  let password: string;
  try {
    password = readFileSync(v.DB_ADMIN_PASSWORD_FILE, 'utf8').trim();
  } catch {
    throw new Error(`No se pudo leer DB_ADMIN_PASSWORD_FILE (${v.DB_ADMIN_PASSWORD_FILE}).`);
  }
  if (password === '') throw new Error('El archivo de contraseña de administración está vacío.');
  return {
    admin: {
      engine: v.DB_ENGINE,
      host: v.DB_HOST,
      port: v.DB_PORT ?? defaultPort(v.DB_ENGINE),
      user: v.DB_ADMIN_USER,
      password,
      tls: v.DB_TLS,
    },
    controlDatabase: v.DB_CONTROL_DATABASE,
  };
}
