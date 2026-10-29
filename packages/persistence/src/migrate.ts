// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Kysely } from 'kysely';
import { Migrator, type Migration } from 'kysely/migration';

/** Resultado de aplicar migraciones a una base. */
export interface MigrationOutcome {
  applied: string[];
}

/**
 * Aplica las migraciones pendientes. Kysely toma un bloqueo para que dos procesos no
 * migren la misma base a la vez.
 *
 * @throws {Error} si alguna migración falla; las ya aplicadas quedan registradas.
 */
export async function migrateToLatest(db: Kysely<unknown>, migrations: Record<string, Migration>): Promise<MigrationOutcome> {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });
  const { error, results } = await migrator.migrateToLatest();
  const applied = (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
  if (error !== undefined) {
    const failed = (results ?? []).find((r) => r.status === 'Error')?.migrationName ?? 'desconocida';
    const detail = error instanceof Error ? error.message : JSON.stringify(error);
    throw new Error(`Falló la migración "${failed}": ${detail}`);
  }
  return { applied };
}
