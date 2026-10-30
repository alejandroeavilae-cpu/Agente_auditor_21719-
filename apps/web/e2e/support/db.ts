// SPDX-License-Identifier: AGPL-3.0-or-later

import { connect } from '@auditor-21719/persistence';
import { sql } from 'kysely';
import { loadState } from './state.js';

/**
 * Acceso directo a la base de la organización SOLO para simular el paso del tiempo en las
 * sesiones (la API no permite configurar los 30 min de inactividad ni los 5 min de MFA
 * reciente, D-79). No se usa para preparar ni verificar otros datos: eso va por la API o la
 * interfaz.
 */
async function withTenantDb<T>(fn: (db: ReturnType<typeof connect<unknown>>) => Promise<T>): Promise<T> {
  const state = loadState();
  const db = connect<unknown>(state.superServer, state.tenantDb, 1);
  try {
    return await fn(db);
  } finally {
    await db.destroy();
  }
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/** Hace que la última verificación MFA de las sesiones de la persona tenga `minutes` minutos. */
export async function ageMfaVerification(email: string, minutes: number): Promise<void> {
  await withTenantDb(async (db) => {
    await sql`UPDATE user_session SET mfa_verified_at = ${minutesAgo(minutes)} WHERE user_id = (SELECT id FROM app_user WHERE email = ${email})`.execute(db);
  });
}

/** Hace que la última actividad de las sesiones de la persona tenga `minutes` minutos. */
export async function ageLastSeen(email: string, minutes: number): Promise<void> {
  await withTenantDb(async (db) => {
    await sql`UPDATE user_session SET last_seen_at = ${minutesAgo(minutes)} WHERE user_id = (SELECT id FROM app_user WHERE email = ${email})`.execute(db);
  });
}

/** Cantidad de sesiones abiertas de la persona. */
export async function sessionCount(email: string): Promise<number> {
  return withTenantDb(async (db) => {
    const res = await sql<{ n: string }>`SELECT count(*) AS n FROM user_session WHERE user_id = (SELECT id FROM app_user WHERE email = ${email})`.execute(db);
    return Number(res.rows[0]?.n ?? 0);
  });
}
