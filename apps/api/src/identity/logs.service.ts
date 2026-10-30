// SPDX-License-Identifier: AGPL-3.0-or-later

import { canonicalJson, type JsonValue } from '@auditor-21719/audit-log';
import { ApiError } from './errors.js';
import type { IdentityService, RequestMeta, SessionContext } from './identity.service.js';

/**
 * Registro de accesos y exportación de la bitácora para el administrador (2C-2).
 *
 * - Registro de accesos (pregunta 3 de 2C §6, D-88): lectura paginada de `access_log`, que
 *   guarda la IP en claro con retención (D-78). Ver los eventos es en sí un evento que queda
 *   en la bitácora inmutable (`access_log.viewed`), con la IP de quien mira solo como HMAC.
 * - Exportación (2C §2.4): JSON Lines en forma canónica, exactamente lo que exige
 *   `auditor-log verify`, por lotes para no cargar la bitácora entera en memoria.
 */

/** Tamaño máximo de página del registro de accesos [DECISIÓN 2C-2]. */
export const ACCESS_LOG_MAX_PAGE = 100;
/** Tamaño de página por defecto. */
export const ACCESS_LOG_DEFAULT_PAGE = 50;
/** Filas por lote al exportar la bitácora [DECISIÓN 2C-2]. */
export const EXPORT_BATCH_SIZE = 500;

/** Filtros ya validados del registro de accesos. */
export interface AccessLogQuery {
  limit: number;
  cursor?: string | undefined;
  /** Nombres exactos de evento (p. ej. `auth.login.failed`, `account.attack_suspected`). */
  events?: string[] | undefined;
  userId?: string | undefined;
  /** Desde (inclusive), ISO 8601 UTC con milisegundos. */
  from?: string | undefined;
  /** Hasta (exclusive), ISO 8601 UTC con milisegundos. */
  to?: string | undefined;
}

/** Una fila del registro de accesos tal como la ve el administrador. */
export interface AccessLogItem {
  id: string;
  ts: string;
  event: string;
  userId: string | null;
  /** Correo actual del usuario, si existe todavía (los intentos con correos inexistentes no tienen usuario). */
  userEmail: string | null;
  /** IP en claro (D-78): solo en el registro de accesos, nunca en la bitácora. */
  ip: string | null;
  /** Familia de navegador, sin huella digital (A-04). */
  uaFamily: string | null;
}

const CURSOR_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CURSOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Cursor opaco: posición (ts, id) de la última fila entregada, en base64url. La paginación
 * por clave (no por desplazamiento) no salta ni repite filas aunque lleguen eventos nuevos
 * mientras el administrador recorre las páginas.
 */
export function encodeCursor(ts: string, id: string): string {
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { ts: string; id: string } {
  const invalid = new ApiError(400, 'invalid_cursor', 'El cursor de paginación no es válido. Vuelva a la primera página.');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(cursor)) throw invalid;
  const [ts, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (rest.length > 0 || ts === undefined || id === undefined || !CURSOR_TS.test(ts) || !CURSOR_ID.test(id)) throw invalid;
  return { ts, id };
}

/**
 * Lee una página del registro de accesos, de lo más reciente a lo más antiguo, y registra
 * la consulta en la bitácora. Los filtros se registran (sin la IP de nadie): quién miró qué.
 */
export async function listAccessLog(identity: IdentityService, ctx: SessionContext, query: AccessLogQuery, meta: RequestMeta): Promise<{ events: AccessLogItem[]; nextCursor: string | null }> {
  const position = query.cursor !== undefined ? decodeCursor(query.cursor) : undefined;
  let q = ctx.tenant.db
    .selectFrom('access_log')
    .leftJoin('app_user', 'app_user.id', 'access_log.user_id')
    .select(['access_log.id', 'access_log.ts', 'access_log.event', 'access_log.user_id', 'access_log.ip', 'access_log.ua_family', 'app_user.email']);
  if (query.events !== undefined && query.events.length > 0) q = q.where('access_log.event', 'in', query.events);
  if (query.userId !== undefined) q = q.where('access_log.user_id', '=', query.userId);
  if (query.from !== undefined) q = q.where('access_log.ts', '>=', query.from);
  if (query.to !== undefined) q = q.where('access_log.ts', '<', query.to);
  if (position !== undefined) {
    q = q.where((eb) => eb.or([eb('access_log.ts', '<', position.ts), eb.and([eb('access_log.ts', '=', position.ts), eb('access_log.id', '<', position.id)])]));
  }
  // Una fila extra indica si hay página siguiente. OFFSET/FETCH: sintaxis común a ambos motores.
  const rows = await q.orderBy('access_log.ts', 'desc').orderBy('access_log.id', 'desc').offset(0).fetch(query.limit + 1).execute();
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor = rows.length > query.limit && last !== undefined ? encodeCursor(last.ts, last.id) : null;

  const filters: Record<string, JsonValue> = {};
  if (query.events !== undefined) filters.events = query.events;
  if (query.userId !== undefined) filters.userId = query.userId;
  if (query.from !== undefined) filters.from = query.from;
  if (query.to !== undefined) filters.to = query.to;
  // Solo bitácora (accessLog: false): anotar cada consulta en el registro de accesos lo
  // llenaría con las propias consultas del administrador y desplazaría lo que investiga.
  await identity.record(ctx.tenant, 'access_log.viewed', {
    actor: { userId: ctx.user.id },
    object: 'access_log',
    data: { filters, page: position === undefined ? 'first' : 'next', returned: page.length },
    meta,
    accessLog: false,
  });

  return {
    events: page.map((r) => ({ id: r.id, ts: r.ts, event: r.event, userId: r.user_id, userEmail: r.email, ip: r.ip, uaFamily: r.ua_family })),
    nextCursor,
  };
}

/** Exportación lista para enviarse: nombre del archivo, cadena y contenido por lotes. */
export interface AuditLogExport {
  filename: string;
  /** Valor para `auditor-log verify --chain-id` (el slug de la organización). */
  chainId: string;
  /** Texto JSON Lines por lotes; cada línea en forma canónica y terminada en `\n`. */
  chunks: AsyncGenerator<string>;
}

/**
 * Prepara la exportación completa de la bitácora. Primero registra `audit_log.exported`
 * (con la IP solo como HMAC) y luego fija como final la última entrada existente: la
 * exportación incluye su propio registro y no crece mientras se descarga.
 */
export async function exportAuditLog(identity: IdentityService, ctx: SessionContext, meta: RequestMeta, now: Date = new Date()): Promise<AuditLogExport> {
  await identity.record(ctx.tenant, 'audit_log.exported', { actor: { userId: ctx.user.id }, object: 'audit_log', data: { format: 'jsonl' }, meta });
  const upTo = await ctx.tenant.audit.lastSeqRaw();
  const batches = ctx.tenant.audit.exportRawBatches(EXPORT_BATCH_SIZE, upTo);
  async function* chunks(): AsyncGenerator<string> {
    for await (const batch of batches) {
      // Misma serialización que `toJsonl` (y que espera `auditor-log verify`): una línea
      // canónica por entrada, sin validar ni corregir nada (ver `exportRaw`).
      yield batch.map((entry) => `${canonicalJson(entry as JsonValue)}\n`).join('');
    }
  }
  // El slug solo tiene minúsculas, dígitos y guiones (assertTenantSlug): seguro en la cabecera.
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return { filename: `bitacora-${ctx.tenant.info.slug}-${stamp}.jsonl`, chainId: ctx.tenant.info.slug, chunks: chunks() };
}
