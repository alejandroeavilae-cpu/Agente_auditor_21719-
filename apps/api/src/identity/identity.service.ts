// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from 'node:crypto';
import type { JsonValue } from '@auditor-21719/audit-log';
import {
  checkPasswordPolicy,
  generateTotpSecret,
  hashPassword,
  hashToken,
  isRole,
  newRecoveryCodes,
  newToken,
  normalizeRecoveryCode,
  otpauthUri,
  base32Encode,
  requiresMfa,
  TOKEN_FORMAT,
  validateRoleSet,
  verifyAgainstDummy,
  verifyPassword,
  verifyTotp,
  type PasswordIssue,
  type Role,
} from '@auditor-21719/identity';
import { ATTACK_ALERT_ORIGIN, type AppUserTable, type SessionStage, type TenantDatabase, type TenantHandle, type UserSessionTable } from '@auditor-21719/persistence';
import { Logger } from '@nestjs/common';
import type { ExpressionBuilder, Transaction } from 'kysely';
import { ApiError, INVALID_CREDENTIALS, UNAUTHENTICATED, UNAVAILABLE } from './errors.js';

/**
 * Lógica de identidad (2B), independiente de NestJS para poder usarla desde la API y
 * desde la CLI y probarla directamente.
 *
 * Valores de D-79: inactividad 30 min, máximo 12 h, reautenticación MFA válida 5 min,
 * activación válida 24 h.
 *
 * Bloqueo progresivo [DECISIÓN de implementación, D-82 y D-83; por cuenta + origen desde
 * 2C-1 como mitigación de R-34]:
 * - el contador es del par **cuenta + origen** (IP como HMAC con la DEK, propósito
 *   `login-origin`): los fallos desde el equipo de un atacante bloquean solo ese origen y la
 *   persona sigue entrando desde el suyo;
 * - contadores SEPARADOS para contraseña y MFA, incrementados de forma atómica en la base
 *   ANTES de verificar (un intento cuenta aunque se envíe en paralelo con otros);
 * - desde el 5.º fallo consecutivo, el par queda bloqueado 30 s, que se duplican con cada
 *   fallo, hasta 15 min; durante el bloqueo no se verifica nada y los intentos no cuentan;
 * - al vencer el bloqueo se admite UN solo intento (quien lo reclama con una actualización
 *   condicional); si falla, se bloquea de nuevo con más espera;
 * - acertar la contraseña no reinicia el contador de MFA;
 * - contra el ataque distribuido (muchos orígenes) la defensa es la MFA obligatoria para
 *   todos (D-86); además se registra `account.attack_suspected` sin bloquear la cuenta.
 */
export const IDLE_MS = 30 * 60_000;
export const ABSOLUTE_MS = 12 * 60 * 60_000;
export const PRE_MFA_MS = 10 * 60_000;
export const REAUTH_MS = 5 * 60_000;
export const ACTIVATION_MS = 24 * 60 * 60_000;
export const LOCK_THRESHOLD = 5;
const LOCK_BASE_MS = 30_000;
const LOCK_MAX_MS = 15 * 60_000;
/**
 * Duración mínima de una respuesta de autenticación fallida [DECISIÓN, QA 2B-04]: iguala
 * el tiempo entre "la organización no existe", "el usuario no existe" y "contraseña
 * incorrecta", que de otro modo difieren por el trabajo en la base.
 */
export const MIN_FAILURE_MS = 300;

/** Contador del par cuenta + origen. */
type Counter = 'password' | 'mfa';

/** Propósito del HMAC del origen en `login_throttle` (distinto del de la bitácora). */
const ORIGIN_PURPOSE = 'login-origin';

/** Vueltas máximas de comparar y reemplazar al reservar un intento. */
const CAS_ATTEMPTS = 50;

/** Ventana de la detección de ataque distribuido. */
const ATTACK_WINDOW_MS = 60 * 60_000;

/**
 * Fallos VERIFICADOS que cuentan para la detección de ataque distribuido. Los intentos
 * rechazados por un bloqueo vigente (`*.blocked`) no se verificaron y no cuentan.
 */
const VERIFIED_FAILURE_EVENTS = ['auth.login.failed', 'auth.mfa.failed', 'auth.reauth.failed', 'auth.password.change_failed'];

/** Formato del token anti-CSRF (HMAC-SHA256 en hexadecimal). */
const CSRF_FORMAT = /^[0-9a-f]{64}$/;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Errores de serialización o interbloqueo: otra transacción concurrente ganó.
 * - PostgreSQL: SQLSTATE 40001 (serialization_failure) y 40P01 (deadlock_detected).
 * - SQL Server: 1205 (interbloqueo), 3960 (conflicto de instantánea) y, si el motor ya
 *   revirtió la transacción por el interbloqueo, el ROLLBACK posterior falla con 3903.
 * Se revisa también la causa encadenada (`cause`), que algunos controladores usan.
 */
function isSerializationConflict(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 3) return false;
  const e = error as { code?: unknown; number?: unknown; message?: unknown; cause?: unknown };
  if (e.code === '40001' || e.code === '40P01') return true;
  if (e.number === 1205 || e.number === 3960 || e.number === 3903) return true;
  if (typeof e.message === 'string' && /deadlock|could not serialize|interbloque/i.test(e.message)) return true;
  return isSerializationConflict(e.cause, depth + 1);
}

/** El motor rechazó una inserción por clave duplicada (PostgreSQL 23505; SQL Server 2627 y 2601). */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { code?: unknown; number?: unknown };
  return e.code === '23505' || e.number === 2627 || e.number === 2601;
}

/**
 * La organización de la instalación (D-84). La API usa `OrganizationDirectory`, que solo
 * tiene las credenciales de esa organización (D-87); la CLI, el `TenantManager`.
 */
export interface OrganizationSource {
  open(): Promise<TenantHandle>;
}

/** Datos de la petición que se registran (D-78). */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

/** Sesión emitida: el valor de la cookie y el token anti-CSRF van al cliente, nunca a la base. */
export interface IssuedSession {
  cookieValue: string;
  csrfToken: string;
  stage: SessionStage;
}

/** Usuario autenticado en el contexto de una petición. */
export interface SessionContext {
  tenant: TenantHandle;
  user: AppUserTable;
  roles: Role[];
  session: UserSessionTable;
}

/** Quién ejecuta una acción administrativa: un usuario o el operador por CLI. */
export type Actor = { userId: string } | { label: string };

const iso = (d: Date): string => d.toISOString();
const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** Familia del navegador, sin huella digital (A-04). */
export function userAgentFamily(ua: string | null): string | null {
  if (ua === null || ua === '') return null;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  if (/^curl\//.test(ua)) return 'curl';
  return 'otro';
}

export function weakPassword(issues: PasswordIssue[]): ApiError {
  const text: Record<PasswordIssue, string> = {
    too_short: 'tiene menos de 12 caracteres',
    too_long: 'tiene más de 128 caracteres',
    common: 'es una contraseña común',
    contains_email: 'contiene su correo',
  };
  return new ApiError(400, 'weak_password', `La contraseña no cumple la política: ${issues.map((i) => text[i]).join('; ')}.`);
}

export class IdentityService {
  private readonly logger = new Logger('Identidad');

  constructor(
    private readonly organization: OrganizationSource,
    private readonly options: {
      accessLogRetentionDays: number;
      /** Fallos en 1 hora desde orígenes distintos que disparan `account.attack_suspected` [ESTIMACIÓN: 20]. */
      attackAlertThreshold?: number;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /**
   * Ejecuta una operación de entrada (inicio de sesión, activación, autenticación de una
   * petición). Un error que no sea de la API (p. ej. la base de la organización rechaza la
   * conexión porque la organización fue suspendida) se responde como "servicio no
   * disponible", sin detalles: falla segura (D-87).
   */
  private async entry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      this.logger.error(`Base de la organización no disponible: ${error instanceof Error ? error.message : 'error no identificado'}`);
      throw UNAVAILABLE();
    }
  }

  // ---------- Registro (bitácora + registro de accesos) ----------

  /**
   * Registra un evento: en la bitácora inmutable con la IP como HMAC (D-78) y en el
   * registro de accesos con la IP en claro, que se purga según la retención.
   */
  async record(
    tenant: TenantHandle,
    event: string,
    params: {
      actor: Actor | null;
      subjectUserId?: string | null;
      data?: Record<string, JsonValue>;
      meta?: RequestMeta | null;
      accessLog?: boolean;
      /**
       * `false` = solo registro de accesos. Los intentos fallidos van solo ahí (con
       * retención), para que un atacante no haga crecer sin límite la bitácora inmutable
       * (QA 2B-08); a la bitácora van los bloqueos y los éxitos.
       */
      audit?: boolean;
    },
  ): Promise<void> {
    const meta = params.meta ?? null;
    const actor = params.actor === null ? 'anonimo' : 'userId' in params.actor ? `user:${params.actor.userId}` : params.actor.label;
    // La IP en claro nunca va a la bitácora: solo su HMAC (D-78).
    const data: Record<string, JsonValue> = { ...(params.data ?? {}) };
    if (meta?.ip != null) data.ipHmac = tenant.crypto.hmac('ip', meta.ip);
    const ua = userAgentFamily(meta?.userAgent ?? null);
    if (ua !== null) data.ua = ua;
    if (params.audit ?? true) {
      await tenant.audit.append({ actor, action: event, object: params.subjectUserId != null ? `user/${params.subjectUserId}` : 'auth', data });
    }
    if (params.accessLog ?? meta !== null) {
      const now = this.now();
      await tenant.db
        .insertInto('access_log')
        .values({ id: randomUUID(), ts: iso(now), user_id: params.subjectUserId ?? null, event, ip: meta?.ip ?? null, ua_family: ua })
        .execute();
      const cutoff = new Date(now.getTime() - this.options.accessLogRetentionDays * 24 * 60 * 60_000);
      await tenant.db.deleteFrom('access_log').where('ts', '<', iso(cutoff)).execute();
      // Los contadores por origen son datos de acceso derivados de la IP: misma retención
      // (D-78). Nunca se borra un bloqueo vigente.
      await tenant.db
        .deleteFrom('login_throttle')
        .where('updated_at', '<', iso(cutoff))
        .where((eb) => eb.or([eb('locked_until', 'is', null), eb('locked_until', '<', iso(now))]))
        .execute();
    }
  }

  // ---------- Sesiones ----------

  /**
   * Token anti-CSRF derivado de la sesión con una clave de la organización: es estable
   * durante la sesión (no hay que rotarlo en cada lectura y no invalida otras pestañas) y
   * no se guarda en claro.
   */
  private csrfFor(tenant: TenantHandle, sessionIdHash: string): string {
    return tenant.crypto.hmac('csrf', sessionIdHash);
  }

  private async issueSession(tenant: TenantHandle, userId: string, stage: SessionStage, mfaVerifiedAt: string | null): Promise<IssuedSession> {
    const token = newToken();
    const csrfToken = this.csrfFor(tenant, hashToken(token));
    const now = this.now();
    const expires = new Date(now.getTime() + (stage === 'full' ? ABSOLUTE_MS : PRE_MFA_MS));
    await tenant.db
      .insertInto('user_session')
      .values({
        id_hash: hashToken(token),
        user_id: userId,
        stage,
        csrf_hash: hashToken(csrfToken),
        created_at: iso(now),
        last_seen_at: iso(now),
        expires_at: iso(expires),
        mfa_verified_at: mfaVerifiedAt,
      })
      .execute();
    // Desde 2C-1 (D-75 ajustada) la cookie lleva solo el token: la organización es fija.
    return { cookieValue: token, csrfToken, stage };
  }

  /** Reemplaza la sesión por una nueva (evita fijación de sesión al subir de nivel). */
  private async rotate(ctx: SessionContext, stage: SessionStage, mfaVerifiedAt: string | null): Promise<IssuedSession> {
    await ctx.tenant.db.deleteFrom('user_session').where('id_hash', '=', ctx.session.id_hash).execute();
    return this.issueSession(ctx.tenant, ctx.user.id, stage, mfaVerifiedAt);
  }

  private async revokeAllSessions(tenant: TenantHandle, userId: string): Promise<void> {
    await tenant.db.deleteFrom('user_session').where('user_id', '=', userId).execute();
  }

  /**
   * Resuelve la sesión de una petición. La cookie contiene solo el token (D-75 ajustada); se
   * busca su hash en la base de la organización de la instalación.
   */
  async authenticate(cookieValue: string | undefined, allowedStages: readonly SessionStage[]): Promise<SessionContext> {
    if (cookieValue === undefined || !TOKEN_FORMAT.test(cookieValue)) throw UNAUTHENTICATED();
    return this.entry(async () => this.resolveSession(await this.organization.open(), cookieValue, allowedStages));
  }

  private async resolveSession(tenant: TenantHandle, token: string, allowedStages: readonly SessionStage[]): Promise<SessionContext> {
    const session = await tenant.db.selectFrom('user_session').selectAll().where('id_hash', '=', hashToken(token)).executeTakeFirst();
    if (session === undefined) throw UNAUTHENTICATED();
    const now = this.now();
    const idleExpired = session.stage === 'full' && new Date(session.last_seen_at).getTime() + IDLE_MS <= now.getTime();
    if (new Date(session.expires_at).getTime() <= now.getTime() || idleExpired) {
      await tenant.db.deleteFrom('user_session').where('id_hash', '=', session.id_hash).execute();
      throw new ApiError(401, 'session_expired', 'La sesión expiró. Inicie sesión nuevamente.');
    }
    const user = await tenant.db.selectFrom('app_user').selectAll().where('id', '=', session.user_id).executeTakeFirst();
    if (user?.status !== 'active') {
      await this.revokeAllSessions(tenant, session.user_id);
      throw UNAUTHENTICATED();
    }
    if (!allowedStages.includes(session.stage)) {
      throw session.stage === 'mfa_enroll'
        ? new ApiError(403, 'mfa_enrollment_required', 'Debe configurar la verificación en dos pasos antes de continuar.')
        : new ApiError(403, 'mfa_required', 'Debe completar la verificación en dos pasos.');
    }
    await tenant.db.updateTable('user_session').set({ last_seen_at: iso(now) }).where('id_hash', '=', session.id_hash).execute();
    const roles = await this.rolesOf(tenant, user.id);
    return { tenant, user, roles, session: { ...session, last_seen_at: iso(now) } };
  }

  /** Comprueba el token anti-CSRF de una petición con efectos. */
  verifyCsrf(ctx: SessionContext, header: string | undefined): void {
    if (header === undefined || !CSRF_FORMAT.test(header) || hashToken(header) !== ctx.session.csrf_hash) {
      throw new ApiError(403, 'csrf', 'Falta o no es válido el token anti-CSRF.');
    }
  }

  /** Acciones de alto riesgo: exige una verificación MFA de los últimos 5 minutos (D-79). */
  requireRecentMfa(ctx: SessionContext): void {
    const at = ctx.session.mfa_verified_at;
    if (at === null || new Date(at).getTime() + REAUTH_MS <= this.now().getTime()) {
      throw new ApiError(403, 'reauth_required', 'Esta acción requiere confirmar nuevamente su código de verificación.');
    }
  }

  /** Token anti-CSRF de la sesión actual (p. ej. al recargar la página). No lo rota. */
  csrfToken(ctx: SessionContext): string {
    return this.csrfFor(ctx.tenant, ctx.session.id_hash);
  }

  private async rolesOf(tenant: TenantHandle, userId: string): Promise<Role[]> {
    const rows = await tenant.db.selectFrom('user_role').select('role').where('user_id', '=', userId).execute();
    return rows.map((r) => r.role).filter(isRole);
  }

  // ---------- Inicio de sesión ----------

  /** HMAC del origen de la petición (IP) con la DEK: la IP en claro no se guarda en `login_throttle`. */
  private originOf(tenant: TenantHandle, meta: RequestMeta | null): string {
    return tenant.crypto.hmac(ORIGIN_PURPOSE, meta?.ip ?? 'desconocido');
  }

  /**
   * Reserva un intento ANTES de verificar (QA 2B-01) en el par cuenta + origen. Devuelve si
   * se permite verificar y si este intento acaba de activar un bloqueo.
   *
   * El incremento y el bloqueo se aplican en UNA actualización condicional sobre el valor
   * leído (comparar y reemplazar): de varias peticiones simultáneas, cada una cuenta solo si
   * el par no estaba bloqueado en ese instante. Así:
   * - en paralelo no se pierde ningún fallo antes del umbral (los perdedores reintentan);
   * - la que llega al umbral fija el bloqueo y es la única que se verifica;
   * - al vencer la espera entra UN intento; los demás encuentran el bloqueo nuevo y NO
   *   cuentan ni lo alargan (QA 2B-11): una ráfaga ya no lleva la espera directo al tope.
   * Si la contención no se resuelve en `CAS_ATTEMPTS` vueltas, se niega (falla segura).
   */
  private async beginAttempt(tenant: TenantHandle, userId: string, counter: Counter, meta: RequestMeta | null): Promise<{ allowed: boolean; lockedNow: boolean }> {
    const now = this.now();
    const nowIso = iso(now);
    const origin = this.originOf(tenant, meta);
    const key = (eb: ExpressionBuilder<TenantDatabase, 'login_throttle'>) => eb.and([eb('user_id', '=', userId), eb('origin_hmac', '=', origin), eb('kind', '=', counter)]);
    for (let round = 0; round < CAS_ATTEMPTS; round++) {
      const row = await tenant.db.selectFrom('login_throttle').select(['failed_attempts', 'locked_until']).where(key).executeTakeFirst();
      if (row === undefined) {
        try {
          // Primer fallo del par: no alcanza el umbral (LOCK_THRESHOLD > 1).
          await tenant.db.insertInto('login_throttle').values({ user_id: userId, origin_hmac: origin, kind: counter, failed_attempts: 1, locked_until: null, updated_at: nowIso }).execute();
          return { allowed: true, lockedNow: false };
        } catch (error) {
          // Otra petición simultánea creó la fila: se vuelve a leer.
          if (!isUniqueViolation(error)) throw error;
          continue;
        }
      }
      // Bloqueo vigente: no se verifica y el intento no cuenta.
      if (row.locked_until !== null && row.locked_until > nowIso) return { allowed: false, lockedNow: false };
      const n = row.failed_attempts + 1;
      const lockedUntil = n >= LOCK_THRESHOLD ? iso(new Date(now.getTime() + Math.min(LOCK_MAX_MS, LOCK_BASE_MS * 2 ** (n - LOCK_THRESHOLD)))) : null;
      const swapped = await tenant.db
        .updateTable('login_throttle')
        .set({ failed_attempts: n, locked_until: lockedUntil, updated_at: nowIso })
        .where(key)
        .where('failed_attempts', '=', row.failed_attempts)
        .where((eb) => (row.locked_until === null ? eb('locked_until', 'is', null) : eb('locked_until', '=', row.locked_until)))
        .executeTakeFirst();
      if (Number(swapped.numUpdatedRows) === 1) return { allowed: true, lockedNow: lockedUntil !== null };
      // Otra petición cambió la fila entre la lectura y la escritura: se reintenta.
    }
    return { allowed: false, lockedNow: false };
  }

  /** Intento exitoso: borra los contadores indicados del par cuenta + origen (no los de otros orígenes). */
  private async attemptSucceeded(tenant: TenantHandle, userId: string, counters: readonly Counter[], meta: RequestMeta | null): Promise<void> {
    await tenant.db
      .deleteFrom('login_throttle')
      .where('user_id', '=', userId)
      .where('origin_hmac', '=', this.originOf(tenant, meta))
      .where('kind', 'in', [...counters])
      .execute();
  }

  /**
   * Reclama la marca "ya registrado en esta ventana" de una cuenta (fila con el origen fijo
   * `ATTACK_ALERT_ORIGIN`). Solo una petición la obtiene por ventana, aunque lleguen muchas a
   * la vez: inserción (clave primaria) o actualización condicional al vencer la anterior.
   */
  private async claimOncePerWindow(tenant: TenantHandle, userId: string, kind: 'attack_alert' | 'lock_logged_pw' | 'lock_logged_mfa', now: Date): Promise<boolean> {
    const until = iso(new Date(now.getTime() + ATTACK_WINDOW_MS));
    try {
      await tenant.db.insertInto('login_throttle').values({ user_id: userId, origin_hmac: ATTACK_ALERT_ORIGIN, kind, failed_attempts: 0, locked_until: until, updated_at: iso(now) }).execute();
      return true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
    const claimed = await tenant.db
      .updateTable('login_throttle')
      .set({ locked_until: until, updated_at: iso(now) })
      .where('user_id', '=', userId)
      .where('origin_hmac', '=', ATTACK_ALERT_ORIGIN)
      .where('kind', '=', kind)
      .where((eb) => eb.or([eb('locked_until', 'is', null), eb('locked_until', '<=', iso(now))]))
      .executeTakeFirst();
    return Number(claimed.numUpdatedRows) === 1;
  }

  /**
   * Registra un bloqueo del par cuenta + origen. El registro de accesos anota CADA bloqueo
   * (con su IP); la bitácora inmutable, solo UNO por cuenta, contador y ventana de 1 hora:
   * un atacante que bloquea muchos orígenes no puede hacer crecer sin límite la bitácora
   * (QA 2C1-10, misma razón que QA 2B-08).
   */
  private async recordLock(tenant: TenantHandle, userId: string, counter: Counter, actor: Actor | null, meta: RequestMeta): Promise<void> {
    const toAudit = await this.claimOncePerWindow(tenant, userId, counter === 'password' ? 'lock_logged_pw' : 'lock_logged_mfa', this.now());
    await this.record(tenant, 'auth.account.locked', {
      actor,
      subjectUserId: userId,
      data: { counter, scope: 'account+origin', ...(toAudit ? { auditWindowMinutes: ATTACK_WINDOW_MS / 60_000 } : {}) },
      meta,
      audit: toAudit,
    });
  }

  /**
   * Detección de ataque distribuido (R-34): si la cuenta acumula al menos
   * `attackAlertThreshold` fallos verificados en 1 hora, desde al menos 2 orígenes
   * distintos, se registra `account.attack_suspected` en la bitácora UNA vez por ventana
   * (reclamada con una inserción o actualización condicional). No bloquea la cuenta, para
   * no recrear R-34. La bitácora no recibe la IP: solo conteos.
   */
  private async detectAttack(tenant: TenantHandle, userId: string): Promise<void> {
    const threshold = this.options.attackAlertThreshold ?? 20;
    const now = this.now();
    const stats = await tenant.db
      .selectFrom('access_log')
      .select((eb) => [eb.fn.countAll<number | string>().as('failures'), eb.fn.count<number | string>('ip').distinct().as('origins')])
      .where('user_id', '=', userId)
      .where('event', 'in', VERIFIED_FAILURE_EVENTS)
      .where('ts', '>=', iso(new Date(now.getTime() - ATTACK_WINDOW_MS)))
      .executeTakeFirst();
    const failures = Number(stats?.failures ?? 0);
    const origins = Number(stats?.origins ?? 0);
    if (failures < threshold || origins < 2) return;
    const won = await this.claimOncePerWindow(tenant, userId, 'attack_alert', now);
    if (!won) return;
    await this.record(tenant, 'account.attack_suspected', {
      actor: { label: 'sistema:deteccion-ataques' },
      subjectUserId: userId,
      data: { failures, origins, windowMinutes: ATTACK_WINDOW_MS / 60_000, threshold },
      meta: null,
      accessLog: true,
    });
  }

  /** Registra un fallo verificado (solo registro de accesos) y revisa si hay un ataque distribuido. */
  private async recordFailure(tenant: TenantHandle, event: string, params: { actor: Actor | null; userId: string; data?: Record<string, JsonValue>; meta: RequestMeta }): Promise<void> {
    await this.record(tenant, event, { actor: params.actor, subjectUserId: params.userId, ...(params.data !== undefined ? { data: params.data } : {}), meta: params.meta, audit: false });
    await this.detectAttack(tenant, params.userId);
  }

  /** Espera hasta completar la duración mínima de una respuesta fallida (QA 2B-04). */
  private async padFailure(startedAt: number): Promise<void> {
    const elapsed = Date.now() - startedAt;
    if (elapsed < MIN_FAILURE_MS) await sleep(MIN_FAILURE_MS - elapsed);
  }

  /**
   * Primer paso: correo + contraseña (D-75 ajustada; la organización es la de la
   * instalación). Cualquier fallo responde lo mismo y tarda al menos lo mismo (se calcula un
   * hash aunque el usuario no exista): no revela qué correos tienen cuenta.
   */
  async login(input: { email: string; password: string }, meta: RequestMeta): Promise<IssuedSession> {
    return this.entry(async () => this.loginIn(await this.organization.open(), input, meta));
  }

  private async loginIn(tenant: TenantHandle, input: { email: string; password: string }, meta: RequestMeta): Promise<IssuedSession> {
    const startedAt = Date.now();
    const fail = async (): Promise<never> => {
      await this.padFailure(startedAt);
      throw INVALID_CREDENTIALS();
    };
    const email = normalizeEmail(input.email);
    const user = await tenant.db.selectFrom('app_user').selectAll().where('email', '=', email).executeTakeFirst();
    if (user?.status !== 'active' || user.password_hash === null) {
      await verifyAgainstDummy(input.password);
      await this.record(tenant, 'auth.login.failed', { actor: null, data: { reason: 'unknown_or_inactive', emailHmac: tenant.crypto.hmac('email', email) }, meta, audit: false });
      return fail();
    }
    const attempt = await this.beginAttempt(tenant, user.id, 'password', meta);
    if (attempt.lockedNow) {
      await this.recordLock(tenant, user.id, 'password', null, meta);
    }
    if (!attempt.allowed) {
      await verifyAgainstDummy(input.password);
      await this.record(tenant, 'auth.login.blocked', { actor: null, subjectUserId: user.id, meta, audit: false });
      return fail();
    }
    const result = await verifyPassword(input.password, user.password_hash);
    if (!result.ok) {
      await this.recordFailure(tenant, 'auth.login.failed', { actor: null, userId: user.id, data: { reason: 'password' }, meta });
      return fail();
    }
    // Acertar la contraseña NO reinicia el contador de MFA (QA 2B-01).
    await this.attemptSucceeded(tenant, user.id, ['password'], meta);
    if (result.needsRehash) {
      await tenant.db.updateTable('app_user').set({ password_hash: await hashPassword(input.password) }).where('id', '=', user.id).execute();
    }
    // D-86 (QA 2C1-06): sin MFA configurada, cualquier usuario debe configurarla primero.
    const stage: SessionStage = user.mfa_secret_sealed !== null ? 'mfa_pending' : requiresMfa() ? 'mfa_enroll' : 'full';
    const issued = await this.issueSession(tenant, user.id, stage, null);
    await this.record(tenant, stage === 'full' ? 'auth.login.succeeded' : 'auth.login.password_ok', { actor: { userId: user.id }, subjectUserId: user.id, data: { stage }, meta });
    return issued;
  }

  /** Segundo paso: código TOTP o código de recuperación. */
  async verifyMfa(ctx: SessionContext, input: { code?: string | undefined; recoveryCode?: string | undefined }, meta: RequestMeta): Promise<IssuedSession> {
    const { tenant, user } = ctx;
    const invalid = (): ApiError => new ApiError(401, 'invalid_code', 'Código incorrecto.');
    const attempt = await this.beginAttempt(tenant, user.id, 'mfa', meta);
    if (attempt.lockedNow) await this.recordLock(tenant, user.id, 'mfa', { userId: user.id }, meta);
    if (!attempt.allowed) {
      await this.record(tenant, 'auth.mfa.blocked', { actor: { userId: user.id }, subjectUserId: user.id, meta, audit: false });
      throw invalid();
    }
    let ok = false;
    let recoveryUsed = false;
    if (input.code !== undefined) {
      ok = await this.checkTotp(ctx, input.code);
    } else if (input.recoveryCode !== undefined) {
      const hash = hashToken(normalizeRecoveryCode(input.recoveryCode));
      const used = await tenant.db
        .updateTable('recovery_code')
        .set({ used_at: iso(this.now()) })
        .where('code_hash', '=', hash)
        .where('user_id', '=', user.id)
        .where('used_at', 'is', null)
        .executeTakeFirst();
      ok = Number(used.numUpdatedRows) === 1;
      recoveryUsed = ok;
    }
    if (!ok) {
      await this.recordFailure(tenant, 'auth.mfa.failed', { actor: { userId: user.id }, userId: user.id, meta });
      throw invalid();
    }
    await this.attemptSucceeded(tenant, user.id, ['password', 'mfa'], meta);
    const issued = await this.rotate(ctx, 'full', iso(this.now()));
    await this.record(tenant, recoveryUsed ? 'auth.mfa.recovery_used' : 'auth.login.succeeded', { actor: { userId: user.id }, subjectUserId: user.id, data: { stage: 'full' }, meta });
    return issued;
  }

  /** Verifica un TOTP contra el secreto del usuario y registra el paso usado (sin reuso). */
  private async checkTotp(ctx: SessionContext, code: string): Promise<boolean> {
    const sealed = ctx.user.mfa_secret_sealed;
    if (sealed === null) return false;
    const key = ctx.tenant.crypto.open('mfa-secret', sealed);
    const last = ctx.user.mfa_last_step === null ? null : Number(ctx.user.mfa_last_step);
    const step = verifyTotp(key, code, Math.floor(this.now().getTime() / 1000), last);
    if (step === null) return false;
    // Actualización condicional: si otra petición usó el mismo paso, esta no lo acepta.
    const updated = await ctx.tenant.db
      .updateTable('app_user')
      .set({ mfa_last_step: step })
      .where('id', '=', ctx.user.id)
      .where((eb) => (last === null ? eb('mfa_last_step', 'is', null) : eb('mfa_last_step', '=', last)))
      .executeTakeFirst();
    return Number(updated.numUpdatedRows) === 1;
  }

  /** Inicia el registro de MFA: devuelve el secreto para la app autenticadora. */
  async enrollMfa(ctx: SessionContext): Promise<{ secret: string; otpauthUri: string }> {
    if (ctx.user.mfa_secret_sealed !== null) {
      throw new ApiError(409, 'mfa_already_enabled', 'La verificación en dos pasos ya está activa. Para cambiarla, un administrador debe restablecerla.');
    }
    const secret = generateTotpSecret();
    await ctx.tenant.db
      .updateTable('app_user')
      .set({ mfa_pending_secret_sealed: ctx.tenant.crypto.seal('mfa-secret', secret), updated_at: iso(this.now()) })
      .where('id', '=', ctx.user.id)
      .execute();
    return { secret: base32Encode(secret), otpauthUri: otpauthUri(secret, `Auditor 21719 (${ctx.tenant.info.name})`, ctx.user.email) };
  }

  /** Confirma el registro de MFA con un primer código; entrega los códigos de recuperación. */
  async confirmMfa(ctx: SessionContext, code: string, meta: RequestMeta): Promise<{ session: IssuedSession; recoveryCodes: string[] }> {
    const pending = ctx.user.mfa_pending_secret_sealed;
    if (pending === null) throw new ApiError(409, 'mfa_not_started', 'Primero inicie el registro de la verificación en dos pasos.');
    const key = ctx.tenant.crypto.open('mfa-secret', pending);
    const step = verifyTotp(key, code, Math.floor(this.now().getTime() / 1000), null);
    if (step === null) throw new ApiError(401, 'invalid_code', 'Código incorrecto.');
    const recoveryCodes = newRecoveryCodes();
    await ctx.tenant.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('app_user')
        .set({ mfa_secret_sealed: pending, mfa_pending_secret_sealed: null, mfa_last_step: step, updated_at: iso(this.now()) })
        .where('id', '=', ctx.user.id)
        .execute();
      await trx.deleteFrom('recovery_code').where('user_id', '=', ctx.user.id).execute();
      await trx
        .insertInto('recovery_code')
        .values(recoveryCodes.map((c) => ({ code_hash: hashToken(normalizeRecoveryCode(c)), user_id: ctx.user.id, used_at: null })))
        .execute();
    });
    const session = await this.rotate(ctx, 'full', iso(this.now()));
    await this.record(ctx.tenant, 'auth.mfa.enabled', { actor: { userId: ctx.user.id }, subjectUserId: ctx.user.id, meta });
    return { session, recoveryCodes };
  }

  /** Reautenticación para acciones de alto riesgo. */
  async reauthenticate(ctx: SessionContext, code: string, meta: RequestMeta): Promise<void> {
    const attempt = await this.beginAttempt(ctx.tenant, ctx.user.id, 'mfa', meta);
    if (attempt.lockedNow) await this.recordLock(ctx.tenant, ctx.user.id, 'mfa', { userId: ctx.user.id }, meta);
    if (!attempt.allowed) {
      await this.record(ctx.tenant, 'auth.reauth.blocked', { actor: { userId: ctx.user.id }, subjectUserId: ctx.user.id, meta, audit: false });
      throw new ApiError(401, 'invalid_code', 'Código incorrecto.');
    }
    if (!(await this.checkTotp(ctx, code))) {
      await this.recordFailure(ctx.tenant, 'auth.reauth.failed', { actor: { userId: ctx.user.id }, userId: ctx.user.id, meta });
      throw new ApiError(401, 'invalid_code', 'Código incorrecto.');
    }
    await this.attemptSucceeded(ctx.tenant, ctx.user.id, ['mfa'], meta);
    await ctx.tenant.db.updateTable('user_session').set({ mfa_verified_at: iso(this.now()) }).where('id_hash', '=', ctx.session.id_hash).execute();
    await this.record(ctx.tenant, 'auth.reauth.succeeded', { actor: { userId: ctx.user.id }, subjectUserId: ctx.user.id, meta });
  }

  async logout(ctx: SessionContext, meta: RequestMeta): Promise<void> {
    await ctx.tenant.db.deleteFrom('user_session').where('id_hash', '=', ctx.session.id_hash).execute();
    await this.record(ctx.tenant, 'auth.logout', { actor: { userId: ctx.user.id }, subjectUserId: ctx.user.id, meta });
  }

  /** Cambio de contraseña: revoca todas las sesiones y emite una nueva. */
  async changePassword(ctx: SessionContext, current: string, next: string, meta: RequestMeta): Promise<IssuedSession> {
    const stored = ctx.user.password_hash;
    const attempt = await this.beginAttempt(ctx.tenant, ctx.user.id, 'password', meta);
    if (attempt.lockedNow) await this.recordLock(ctx.tenant, ctx.user.id, 'password', { userId: ctx.user.id }, meta);
    const wrong = new ApiError(401, 'invalid_credentials', 'La contraseña actual no es correcta.');
    if (!attempt.allowed) {
      await this.record(ctx.tenant, 'auth.password.change_blocked', { actor: { userId: ctx.user.id }, subjectUserId: ctx.user.id, meta, audit: false });
      throw wrong;
    }
    if (stored === null || !(await verifyPassword(current, stored)).ok) {
      await this.recordFailure(ctx.tenant, 'auth.password.change_failed', { actor: { userId: ctx.user.id }, userId: ctx.user.id, meta });
      throw wrong;
    }
    await this.attemptSucceeded(ctx.tenant, ctx.user.id, ['password'], meta);
    const issues = checkPasswordPolicy(next, { email: ctx.user.email });
    if (issues.length > 0) throw weakPassword(issues);
    const now = iso(this.now());
    await ctx.tenant.db
      .updateTable('app_user')
      .set({ password_hash: await hashPassword(next), password_changed_at: now, updated_at: now })
      .where('id', '=', ctx.user.id)
      .execute();
    await this.revokeAllSessions(ctx.tenant, ctx.user.id);
    const session = await this.issueSession(ctx.tenant, ctx.user.id, 'full', ctx.session.mfa_verified_at);
    await this.record(ctx.tenant, 'auth.password.changed', { actor: { userId: ctx.user.id }, subjectUserId: ctx.user.id, meta });
    return session;
  }

  /** Activación con el enlace de un solo uso: fija la contraseña. */
  async activate(input: { token: string; password: string }, meta: RequestMeta): Promise<IssuedSession> {
    return this.entry(async () => this.activateIn(await this.organization.open(), input, meta));
  }

  private async activateIn(tenant: TenantHandle, input: { token: string; password: string }, meta: RequestMeta): Promise<IssuedSession> {
    const startedAt = Date.now();
    const invalid = async (): Promise<never> => {
      await this.padFailure(startedAt);
      throw new ApiError(400, 'invalid_token', 'El enlace de activación no es válido o expiró.');
    };
    if (!TOKEN_FORMAT.test(input.token)) return invalid();
    const row = await tenant.db.selectFrom('activation_token').selectAll().where('token_hash', '=', hashToken(input.token)).executeTakeFirst();
    if (row === undefined || row.used_at !== null || new Date(row.expires_at).getTime() <= this.now().getTime()) return invalid();
    const user = await tenant.db.selectFrom('app_user').selectAll().where('id', '=', row.user_id).executeTakeFirst();
    if (user?.status !== 'invited') return invalid();
    const issues = checkPasswordPolicy(input.password, { email: user.email });
    if (issues.length > 0) throw weakPassword(issues);
    const now = iso(this.now());
    const hash = await hashPassword(input.password);
    // El token se marca usado con una condición: dos activaciones simultáneas no prosperan.
    const consumed = await tenant.db
      .updateTable('activation_token')
      .set({ used_at: now })
      .where('token_hash', '=', row.token_hash)
      .where('used_at', 'is', null)
      .executeTakeFirst();
    if (Number(consumed.numUpdatedRows) !== 1) return invalid();
    await tenant.db.updateTable('app_user').set({ status: 'active', password_hash: hash, password_changed_at: now, updated_at: now }).where('id', '=', user.id).execute();
    const stage: SessionStage = requiresMfa() ? 'mfa_enroll' : 'full';
    const session = await this.issueSession(tenant, user.id, stage, null);
    await this.record(tenant, 'user.activated', { actor: { userId: user.id }, subjectUserId: user.id, meta });
    return session;
  }

  // ---------- Gestión de usuarios ----------

  async listUsers(tenant: TenantHandle): Promise<{ id: string; email: string; displayName: string; status: string; roles: Role[]; mfaEnabled: boolean }[]> {
    const users = await tenant.db.selectFrom('app_user').select(['id', 'email', 'display_name', 'status', 'mfa_secret_sealed']).orderBy('email').execute();
    const roles = await tenant.db.selectFrom('user_role').selectAll().execute();
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      status: u.status,
      roles: roles.filter((r) => r.user_id === u.id).map((r) => r.role).filter(isRole),
      mfaEnabled: u.mfa_secret_sealed !== null,
    }));
  }

  /** Invita a un usuario: queda "invitado" hasta usar su enlace de activación (24 h). */
  async inviteUser(
    tenant: TenantHandle,
    actor: Actor,
    input: { email: string; displayName: string; roles: string[] },
    meta: RequestMeta | null,
  ): Promise<{ userId: string; activationToken: string; expiresAt: string }> {
    const problems = validateRoleSet(input.roles);
    if (problems.length > 0) throw new ApiError(400, 'invalid_roles', problems.join(' '));
    const email = normalizeEmail(input.email);
    const existing = await tenant.db.selectFrom('app_user').select('id').where('email', '=', email).executeTakeFirst();
    if (existing !== undefined) throw new ApiError(409, 'email_exists', 'Ya existe un usuario con ese correo en esta organización.');
    const userId = randomUUID();
    const token = newToken();
    const now = this.now();
    const expiresAt = iso(new Date(now.getTime() + ACTIVATION_MS));
    await tenant.db.transaction().execute(async (trx) => {
      await trx
        .insertInto('app_user')
        .values({
          id: userId,
          email,
          display_name: input.displayName.trim(),
          status: 'invited',
          password_hash: null,
          mfa_secret_sealed: null,
          mfa_pending_secret_sealed: null,
          mfa_last_step: null,
          failed_attempts: 0,
          mfa_failed_attempts: 0,
          locked_until: null,
          password_changed_at: null,
          created_at: iso(now),
          updated_at: iso(now),
        })
        .execute();
      await trx.insertInto('user_role').values(input.roles.map((role) => ({ user_id: userId, role }))).execute();
      await trx.insertInto('activation_token').values({ token_hash: hashToken(token), user_id: userId, expires_at: expiresAt, used_at: null, created_at: iso(now) }).execute();
    });
    await this.record(tenant, 'user.invited', { actor, subjectUserId: userId, data: { roles: [...input.roles].sort() }, meta });
    return { userId, activationToken: token, expiresAt };
  }

  private async findUser(tenant: TenantHandle, userId: string): Promise<AppUserTable> {
    const user = await tenant.db.selectFrom('app_user').selectAll().where('id', '=', userId).executeTakeFirst();
    if (user === undefined) throw new ApiError(404, 'user_not_found', 'Usuario no encontrado.');
    return user;
  }

  /**
   * Siempre debe quedar al menos un administrador activo con MFA (D-79). La comprobación y
   * el cambio van en una transacción SERIALIZABLE: dos cambios simultáneos que juntos
   * dejarían la organización sin administrador no pueden confirmarse ambos (QA 2B-03).
   */
  private async withAdminGuard(tenant: TenantHandle, userId: string, change: (trx: Transaction<TenantDatabase>) => Promise<void>, removesAdmin: (trx: Transaction<TenantDatabase>) => Promise<boolean>): Promise<void> {
    try {
      await tenant.db
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async (trx) => {
          if (await removesAdmin(trx)) {
            const admins = await trx
              .selectFrom('app_user')
              .innerJoin('user_role', 'user_role.user_id', 'app_user.id')
              .select('app_user.id')
              .where('user_role.role', '=', 'org_admin')
              .where('app_user.status', '=', 'active')
              .where('app_user.mfa_secret_sealed', 'is not', null)
              .where('app_user.id', '!=', userId)
              .execute();
            if (admins.length === 0) {
              throw new ApiError(409, 'last_admin', 'La organización debe conservar al menos un administrador activo con verificación en dos pasos.');
            }
          }
          await change(trx);
        });
    } catch (error) {
      if (isSerializationConflict(error)) throw new ApiError(409, 'conflict', 'Otro cambio simultáneo afectó a los administradores. Intente nuevamente.');
      throw error;
    }
  }

  async setRoles(ctx: SessionContext, userId: string, roles: string[], meta: RequestMeta): Promise<void> {
    const problems = validateRoleSet(roles);
    if (problems.length > 0) throw new ApiError(400, 'invalid_roles', problems.join(' '));
    const target = await this.findUser(ctx.tenant, userId);
    let before: Role[] = [];
    await this.withAdminGuard(
      ctx.tenant,
      userId,
      async (trx) => {
        await trx.deleteFrom('user_role').where('user_id', '=', userId).execute();
        await trx.insertInto('user_role').values(roles.map((role) => ({ user_id: userId, role }))).execute();
      },
      async (trx) => {
        const rows = await trx.selectFrom('user_role').select('role').where('user_id', '=', userId).execute();
        before = rows.map((r) => r.role).filter(isRole);
        return before.includes('org_admin') && !roles.includes('org_admin');
      },
    );
    // Los permisos nuevos rigen desde ya: se cierran las sesiones del usuario afectado.
    await this.revokeAllSessions(ctx.tenant, target.id);
    await this.record(ctx.tenant, 'user.roles.changed', { actor: { userId: ctx.user.id }, subjectUserId: userId, data: { before: [...before].sort(), after: [...roles].sort() }, meta });
  }

  async deactivate(ctx: SessionContext, userId: string, meta: RequestMeta): Promise<void> {
    const target = await this.findUser(ctx.tenant, userId);
    if (target.status === 'disabled') return;
    await this.withAdminGuard(
      ctx.tenant,
      userId,
      async (trx) => {
        await trx.updateTable('app_user').set({ status: 'disabled', updated_at: iso(this.now()) }).where('id', '=', userId).execute();
      },
      async (trx) => (await trx.selectFrom('user_role').select('role').where('user_id', '=', userId).where('role', '=', 'org_admin').execute()).length > 0,
    );
    await this.revokeAllSessions(ctx.tenant, userId);
    await ctx.tenant.db.deleteFrom('activation_token').where('user_id', '=', userId).execute();
    await this.record(ctx.tenant, 'user.deactivated', { actor: { userId: ctx.user.id }, subjectUserId: userId, meta });
  }

  /** Restablece la MFA de otro usuario (p. ej. perdió su teléfono). Alto riesgo. */
  async resetMfa(ctx: SessionContext, userId: string, meta: RequestMeta): Promise<void> {
    if (userId === ctx.user.id) throw new ApiError(409, 'self_mfa_reset', 'Otro administrador debe restablecer su verificación en dos pasos.');
    await this.findUser(ctx.tenant, userId);
    await ctx.tenant.db
      .updateTable('app_user')
      .set({ mfa_secret_sealed: null, mfa_pending_secret_sealed: null, mfa_last_step: null, updated_at: iso(this.now()) })
      .where('id', '=', userId)
      .execute();
    // Restablecer la MFA levanta también sus bloqueos, en todos los orígenes (D-83).
    await ctx.tenant.db.deleteFrom('login_throttle').where('user_id', '=', userId).where('kind', '=', 'mfa').execute();
    await ctx.tenant.db.deleteFrom('recovery_code').where('user_id', '=', userId).execute();
    await this.revokeAllSessions(ctx.tenant, userId);
    await this.record(ctx.tenant, 'user.mfa.reset', { actor: { userId: ctx.user.id }, subjectUserId: userId, meta });
  }

  /**
   * Desbloquea una cuenta: borra los contadores de contraseña y MFA de TODOS sus orígenes
   * (QA 2B-11, R-34). Lo usan un administrador por la API (alto riesgo) o el operador por la
   * CLI. La marca de alerta de ataque se conserva: evita repetir la alerta en la ventana.
   */
  async unlockUser(tenant: TenantHandle, actor: Actor, userId: string, meta: RequestMeta | null): Promise<void> {
    await this.findUser(tenant, userId);
    await tenant.db.deleteFrom('login_throttle').where('user_id', '=', userId).where('kind', 'in', ['password', 'mfa']).execute();
    // Columnas de bloqueo por cuenta de 2B (sin uso desde 2C-1): se dejan en cero por coherencia.
    await tenant.db.updateTable('app_user').set({ failed_attempts: 0, mfa_failed_attempts: 0, locked_until: null, updated_at: iso(this.now()) }).where('id', '=', userId).execute();
    await this.record(tenant, 'user.unlocked', { actor, subjectUserId: userId, meta });
  }

  /** Busca un usuario por correo (para la CLI). */
  async userIdByEmail(tenant: TenantHandle, email: string): Promise<string> {
    const row = await tenant.db.selectFrom('app_user').select('id').where('email', '=', normalizeEmail(email)).executeTakeFirst();
    if (row === undefined) throw new ApiError(404, 'user_not_found', 'Usuario no encontrado.');
    return row.id;
  }
}
