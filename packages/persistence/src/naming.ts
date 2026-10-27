// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Reglas de nombres de organizaciones y de sus recursos de base de datos.
 *
 * Los nombres de bases y usuarios se derivan SOLO de un identificador validado con una
 * lista permitida estricta. Esto es una defensa contra inyección SQL: las sentencias
 * `CREATE DATABASE`, `CREATE ROLE` y `CREATE LOGIN` no admiten parámetros para nombres.
 */

/** Identificador público de una organización: minúsculas, dígitos y guiones; 3 a 30 caracteres. */
export const TENANT_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Prefijo común: permite a la institución reconocer los recursos de la plataforma. */
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

/** Nombre de la base de datos de una organización. */
export function tenantDatabaseName(slug: string): string {
  assertTenantSlug(slug);
  return PREFIX + slug.replaceAll('-', '_');
}

/** Nombre del usuario (rol o login) con el que la aplicación accede a la base de una organización. */
export function tenantLoginName(slug: string): string {
  return `${tenantDatabaseName(slug)}_app`;
}

/** Contexto de cifrado de la contraseña de base de datos de una organización. */
export function passwordContext(tenantId: string): string {
  return `tenant:${tenantId}:db-password`;
}

/** Contexto de cifrado de la DEK de una organización. */
export function dekContext(tenantId: string): string {
  return `tenant:${tenantId}`;
}
