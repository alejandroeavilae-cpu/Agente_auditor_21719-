// SPDX-License-Identifier: AGPL-3.0-or-later

import { Kysely, MssqlDialect, PostgresDialect } from 'kysely';
import pg from 'pg';
import * as tarn from 'tarn';
import * as tedious from 'tedious';
import type { DbServerConfig } from './config.js';

/**
 * Crea una conexión (con su propio pool) a una base de datos concreta.
 *
 * Cada organización tiene su propio pool con sus propias credenciales: no existe un
 * pool compartido que pueda usarse por error contra la base de otra organización.
 *
 * @param server credenciales y destino.
 * @param database base a la que se conecta.
 * @param maxConnections tamaño máximo del pool (bajo por defecto: la plataforma está
 *   pensada para instituciones con recursos limitados).
 */
export function connect<DB>(server: DbServerConfig, database: string, maxConnections = 5): Kysely<DB> {
  if (server.engine === 'postgresql') {
    const pool = new pg.Pool({
      host: server.host,
      port: server.port,
      user: server.user,
      password: server.password,
      database,
      max: maxConnections,
      ssl: server.tls === 'disable' ? false : { rejectUnauthorized: server.tls === 'verify' },
      // Nombre visible en pg_stat_activity: permite a la institución ver qué hace la plataforma.
      application_name: 'auditor-21719',
      connectionTimeoutMillis: 15_000,
      // Fija el esquema en cada conexión: anula un search_path que el usuario de la
      // organización haya configurado para sí mismo (hallazgo QA M-02).
      options: '-c search_path=public',
    });
    // Sin este manejador, un error en una conexión inactiva (p. ej. el motor la corta al
    // eliminar una base o al reiniciarse) termina el proceso completo (hallazgo QA A-01).
    // Las consultas en curso igual reciben su error; aquí solo se evita la caída.
    pool.on('error', () => undefined);
    return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  }
  return new Kysely<DB>({
    dialect: new MssqlDialect({
      tarn: { ...tarn, options: { min: 0, max: maxConnections } },
      tedious: {
        ...tedious,
        connectionFactory: () => {
          const connection = new tedious.Connection({
            server: server.host,
            authentication: { type: 'default', options: { userName: server.user, password: server.password } },
            options: {
              port: server.port,
              database,
              encrypt: server.tls !== 'disable',
              trustServerCertificate: server.tls === 'trust-server-certificate',
              appName: 'auditor-21719',
              connectTimeout: 15_000,
            },
          });
          // Mismo motivo que en PostgreSQL: un error de una conexión inactiva no debe
          // terminar el proceso.
          connection.on('error', () => undefined);
          return connection;
        },
      },
    }),
  });
}

/** Base administrativa del servidor desde la que se crean otras bases. */
export function serverAdminDatabase(server: DbServerConfig): string {
  return server.engine === 'postgresql' ? 'postgres' : 'master';
}
