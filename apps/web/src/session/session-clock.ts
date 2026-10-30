// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cálculo en el cliente de la expiración de la sesión (2C §2.2, `2c2-api.md` §1).
 *
 * `GET /me` renueva la inactividad, así que NO se usa para sondear: se lee una vez y desde
 * ahí se cuenta en el cliente. Cada petición autenticada posterior también renueva la
 * inactividad en el servidor, y el cliente mueve su plazo de la misma forma.
 *
 * Para no depender del reloj del equipo (que puede estar desfasado), los plazos se miden
 * contra la cabecera `Date` de la respuesta (reloj del servidor) y se trasladan al reloj
 * local como "tiempo restante". La cabecera tiene resolución de 1 s: se descuenta un margen
 * para que el cliente cierre antes que el servidor, nunca después.
 */

/** Aviso con este tiempo de anticipación `[DECISIÓN técnica 2C-2]`. */
export const WARNING_MS = 2 * 60_000;
/** Margen de seguridad por la resolución de la cabecera `Date` y la latencia. */
export const SAFETY_MARGIN_MS = 5_000;

export interface SessionClock {
  /** Duración de la ventana de inactividad observada en `/me` (30 min en la API actual). */
  idleWindowMs: number;
  /** Instante (reloj local, ms) en que vence por inactividad si no hay más peticiones. */
  idleDeadline: number;
  /** Instante (reloj local, ms) del vencimiento absoluto (12 h en sesión completa). */
  absoluteDeadline: number;
}

export interface SessionTimes {
  expiresAt: string;
  idleExpiresAt: string;
}

/**
 * Construye el reloj de la sesión a partir de `/me`.
 * @param serverDate cabecera `Date` de la respuesta en ms, o `null` (se usa el reloj local).
 * @param receivedAt `Date.now()` al recibir la respuesta.
 */
export function clockFromMe(times: SessionTimes, serverDate: number | null, receivedAt: number): SessionClock {
  const reference = serverDate ?? receivedAt;
  const idleRemaining = Math.max(0, Date.parse(times.idleExpiresAt) - reference - SAFETY_MARGIN_MS);
  const absoluteRemaining = Math.max(0, Date.parse(times.expiresAt) - reference - SAFETY_MARGIN_MS);
  return {
    idleWindowMs: idleRemaining,
    idleDeadline: receivedAt + idleRemaining,
    absoluteDeadline: receivedAt + absoluteRemaining,
  };
}

/** Una petición autenticada renovó la inactividad en `now` (reloj local). */
export function renewed(clock: SessionClock, now: number): SessionClock {
  // Nunca se acorta un plazo ya conocido (p. ej. por mensajes de otra pestaña desordenados).
  const next = Math.min(now + clock.idleWindowMs, clock.absoluteDeadline);
  return next > clock.idleDeadline ? { ...clock, idleDeadline: next } : clock;
}

export type SessionPhase =
  | { kind: 'active'; deadline: number }
  | { kind: 'warning'; deadline: number; reason: 'idle' | 'absolute'; remainingMs: number }
  | { kind: 'expired'; reason: 'idle' | 'absolute' };

export function phaseAt(clock: SessionClock, now: number): SessionPhase {
  const absolute = clock.absoluteDeadline <= clock.idleDeadline;
  const deadline = absolute ? clock.absoluteDeadline : clock.idleDeadline;
  const reason = absolute ? 'absolute' : 'idle';
  const remainingMs = deadline - now;
  if (remainingMs <= 0) return { kind: 'expired', reason };
  if (remainingMs <= WARNING_MS) return { kind: 'warning', deadline, reason, remainingMs };
  return { kind: 'active', deadline };
}

/** "1 minuto y 05 segundos" para el aviso (texto, no solo una barra). */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const sec = `${String(seconds)} ${seconds === 1 ? 'segundo' : 'segundos'}`;
  if (minutes === 0) return sec;
  return `${String(minutes)} ${minutes === 1 ? 'minuto' : 'minutos'} y ${sec}`;
}
