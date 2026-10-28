// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';

/**
 * Reglas de nombres de organizaciones y de sus recursos de base de datos.
 *
 * - El identificador público (`slug`) se valida con una lista permitida estricta.
 * - Los nombres de base y usuario NO se derivan del identificador: usan un token
 *   aleatorio opaco. Así, aunque el catálogo del motor sea visible para todos sus usuarios
 *   (p. ej. `pg_database` en PostgreSQL), el usuario de una organización no puede saber
 *   qué otras organizaciones existen (hallazgo QA M-03).
 * - Los nombres derivan solo de valores validados: defensa contra inyección SQL, porque
 *   `CREATE DATABASE`, `CREATE ROLE` y `CREATE LOGIN` no admiten parámetros para nombres.
 */

/** Identificador público de una organización: minúsculas, dígitos y guiones; 3 a 30 caracteres. */
export const TENANT_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const TOKEN = /^[0-9a-f]{12}$/;
const PREFIX = 'auditor_t_';

/**
 * Valida un identificador de organización.
 * @throws {Error} si no cumple el formato.
 */
export function assertTenantSlug(slug: string): void {
  if (slug.length < 3 || slug.length > 30 || !TENANT_SLUG.test(slug)) {
    throw new Error('Identificador de organización inválido: use 3 a 30 caracteres en minúsculas, dígitos y guiones (p. ej. "muni-ejemplo").');
  }
}

/**
 * Valida el nombre visible de una organización: 2 a 200 caracteres, sin caracteres de
 * control (evita inyectar secuencias de terminal al listar, hallazgo QA B-06).
 */
export function assertTenantName(name: string): string {
  const clean = name.trim();
  if (clean.length < 2 || clean.length > 200 || /\p{C}/u.test(clean)) {
    throw new Error('El nombre debe tener entre 2 y 200 caracteres y no contener caracteres de control.');
  }
  return clean;
}

/** Nombres de base y usuario de una organización a partir de un token aleatorio. */
export interface TenantResourceNames {
  dbName: string;
  login: string;
}

/** Genera nombres nuevos, opacos y no relacionados con el identificador público. */
export function newTenantResourceNames(): TenantResourceNames {
  return tenantResourceNames(randomBytes(6).toString('hex'));
}

export function tenantResourceNames(token: string): TenantResourceNames {
  if (!TOKEN.test(token)) throw new Error('Token de recursos inválido.');
  return { dbName: `${PREFIX}${token}`, login: `${PREFIX}${token}_app` };
}

/** Bases de sistema o reservadas que nunca pueden usarse como base de control (hallazgo QA B-08). */
const RESERVED_DATABASES = new Set(['postgres', 'template0', 'template1', 'master', 'model', 'msdb', 'tempdb']);

export function assertControlDatabaseName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name) || RESERVED_DATABASES.has(name.toLowerCase()) || name.toLowerCase().startsWith(PREFIX)) {
    throw new Error(`Nombre de base de control no permitido: ${name}`);
  }
}

/** Contexto de cifrado de la contraseña de base de datos de una organización. */
export function passwordContext(tenantId: string): string {
  return `tenant:${tenantId}:db-password`;
}

/** Contexto de cifrado de la DEK de una organización. */
export function dekContext(tenantId: string): string {
  return `tenant:${tenantId}`;
}
