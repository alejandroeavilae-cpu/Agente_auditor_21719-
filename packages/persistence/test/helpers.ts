// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import type { DbEngine, DbServerConfig, DbTlsMode } from '../src/index.js';

/**
 * Configuración de los motores de prueba, leída de variables de entorno:
 *   TEST_PG_HOST, TEST_PG_PORT, TEST_PG_USER, TEST_PG_PASSWORD, TEST_PG_TLS
 *   TEST_MSSQL_HOST, TEST_MSSQL_PORT, TEST_MSSQL_USER, TEST_MSSQL_PASSWORD, TEST_MSSQL_TLS
 *
 * Si un motor no está configurado sus pruebas se omiten, SALVO que figure en
 * REQUIRE_DB_ENGINES (p. ej. "postgresql,sqlserver"): en CI se exige así para que una
 * prueba omitida nunca se confunda con una prueba aprobada.
 */
export function engineConfigs(): { engine: DbEngine; server: DbServerConfig }[] {
  const required = (process.env.REQUIRE_DB_ENGINES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const result: { engine: DbEngine; server: DbServerConfig }[] = [];
  const read = (prefix: string, engine: DbEngine, defaultPort: number): void => {
    const host = process.env[`${prefix}_HOST`];
    if (host === undefined || host === '') {
      if (required.includes(engine)) throw new Error(`REQUIRE_DB_ENGINES exige ${engine}, pero ${prefix}_HOST no está definido.`);
      return;
    }
    result.push({
      engine,
      server: {
        engine,
        host,
        port: Number(process.env[`${prefix}_PORT`] ?? defaultPort),
        user: process.env[`${prefix}_USER`] ?? '',
        password: process.env[`${prefix}_PASSWORD`] ?? '',
        tls: (process.env[`${prefix}_TLS`] ?? 'disable') as DbTlsMode,
      },
    });
  };
  read('TEST_PG', 'postgresql', 5432);
  read('TEST_MSSQL', 'sqlserver', 1433);
  return result;
}

/** Sufijo aleatorio para que ejecuciones simultáneas no choquen. */
export function runId(): string {
  return randomBytes(3).toString('hex');
}
