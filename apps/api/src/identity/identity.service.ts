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
import { assertTenantSlug, type AppUserTable, type SessionStage, type TenantHandle, type UserSessionTable } from '@auditor-21719/persistence';
import { ApiError, INVALID_CREDENTIALS, UNAUTHENTICATED } from './errors.js';

/**
 * Lógica de identidad (2B), independiente de NestJS para poder usarla desde la API y
 * desde la CLI y probarla directamente.
 *
 * Valores de D-79: inactividad 30 min, máximo 12 h, reautenticación MFA válida 5 min,
 * activación válida 24 h. Bloqueo progresivo [DECISIÓN de implementación]: desde el 5.º
 * fallo consecutivo, espera de 30 s que se duplica en cada fallo, hasta 15 min.
 */
export const IDLE_MS = 30 * 60_000;
export const ABSOLUTE_MS = 12 * 60 * 60_000;
export const PRE_MFA_MS = 10 * 60_000;
export const REAUTH_MS = 5 * 60_000;
export const ACTIVATION_MS = 24 * 60 * 60_000;
export const LOCK_THRESHOLD = 5;
const LOCK_BASE_MS = 30_000;
const LOCK_MAX_MS = 15 * 60_000;

/** Acceso a las organizaciones (la API usa un `TenantManager` con cuenta de solo lectura). */
export interface TenantDirectory {
  openTenant(slug: string): Promise<TenantHandle>;
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
  constructor(
    private readonly directory: TenantDirectory,
    private readonly options: { defaultOrganization?: string | undefined; accessLogRetentionDays: number; now?: () => Date },
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private resolveOrganization(organization: string | undefined): string | undefined {
    const slug = organization === undefined || organization === '' ? this.options.defaultOrganization : organization;
    if (slug === undefined) return undefined;
    try {
      assertTenantSlug(slug);
      return slug;
    } catch {
      return undefined;
    }
  }

  private async openTenantOrNull(slug: string | undefined): Promise<TenantHandle | null> {
    if (slug === undefined) return null;
    try {
      return await this.directory.openTenant(slug);
    } catch {
      return null;
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
    params: { actor: Actor | null; subjectUserId?: string | null; data?: Record<string, JsonValue>; meta?: RequestMeta | null; accessLog?: boolean },
  ): Promise<void> {
    const meta = params.meta ?? null;
    const actor = params.actor === null ? 'anonimo' : 'userId' in params.actor ? `user:${params.actor.userId}` : params.actor.label;
    const data: Record<string, JsonValue> = { ...(params.data ?? {}) };
    if (meta?.ip != null) data.ipHmac = tenant.crypto.hmac('ip', meta.ip);
    const ua = userAgentFamily(meta?.userAgent ?? null);
    if (ua !== null) data.ua = ua;
    await tenant.audit.append({ actor, action: event, object: params.subjectUserId != null ? `user/${params.subjectUserId}` : 'auth', data });
    if (params.accessLog ?? meta !== null) {
      const now = this.now();
      await tenant.db
        .insertInto('access_log')
        .values({ id: randomUUID(), ts: iso(now), user_id: params.subjectUserId ?? null, event, ip: meta?.ip ?? null, ua_family: ua })
        .execute();
      const cutoff = new Date(now.getTime() - this.options.accessLogRetentionDays * 24 * 60 * 60_000);
      await tenant.db.deleteFrom('access_log').where('ts', '<', iso(cutoff)).execute();
    }
  }

  // ---------- Sesiones ----------

  private async issueSession(tenant: TenantHandle, userId: string, stage: SessionStage, mfaVerifiedAt: string | null): Promise<IssuedSession> {
    const token = newToken();
    const csrfToken = newToken();
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
    return { cookieValue: `${tenant.info.slug}.${token}`, csrfToken, stage };
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
   * Resuelve la sesión de una petición. La organización sale del valor de la cookie y se
   * confirma porque el token existe en la base de ESA organización: un cliente que cambie
   * el identificador solo consigue un rechazo.
   */
  async authenticate(cookieValue: string | undefined, allowedStages: readonly SessionStage[]): Promise<SessionContext> {
    if (cookieValue === undefined) throw UNAUTHENTICATED();
    const dot = cookieValue.indexOf('.');
    const slug = cookieValue.slice(0, dot);
    const token = cookieValue.slice(dot + 1);
    if (dot <= 0 || !TOKEN_FORMAT.test(token)) throw UNAUTHENTICATED();
    const tenant = await this.openTenantOrNull(this.resolveOrganization(slug));
    if (tenant === null) throw UNAUTHENTICATED();
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
    if (header === undefined || !TOKEN_FORMAT.test(header) || hashToken(header) !== ctx.session.csrf_hash) {
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

  /** Emite un nuevo token anti-CSRF para la sesión (p. ej. al recargar la página). */
  async refreshCsrf(ctx: SessionContext): Promise<string> {
    const csrfToken = newToken();
    await ctx.tenant.db.updateTable('user_session').set({ csrf_hash: hashToken(csrfToken) }).where('id_hash', '=', ctx.session.id_hash).execute();
    return csrfToken;
  }

  private async rolesOf(tenant: TenantHandle, userId: string): Promise<Role[]> {
    const rows = await tenant.db.selectFrom('user_role').select('role').where('user_id', '=', userId).execute();
    return rows.map((r) => r.role).filter(isRole);
  }

  // ---------- Inicio de sesión ----------

  private async registerFailure(tenant: TenantHandle, user: AppUserTable): Promise<void> {
    const attempts = user.failed_attempts + 1;
    const lockedUntil =
      attempts >= LOCK_THRESHOLD ? iso(new Date(this.now().getTime() + Math.min(LOCK_MAX_MS, LOCK_BASE_MS * 2 ** (attempts - LOCK_THRESHOLD)))) : user.locked_until;
    await tenant.db.updateTable('app_user').set({ failed_attempts: attempts, locked_until: lockedUntil }).where('id', '=', user.id).execute();
  }

  private isLocked(user: AppUserTable): boolean {
    return user.locked_until !== null && new Date(user.locked_until).getTime() > this.now().getTime();
  }

  /**
   * Primer paso: organización + correo + contraseña (D-75). Cualquier fallo responde lo
   * mismo y tarda lo mismo (se calcula un hash aunque el usuario no exista).
   */
  async login(input: { organization?: string | undefined; email: string; password: string }, meta: RequestMeta): Promise<IssuedSession> {
    const tenant = await this.openTenantOrNull(this.resolveOrganization(input.organization));
    if (tenant === null) {
      await verifyAgainstDummy(input.password);
      throw INVALID_CREDENTIALS();
    }
    const email = normalizeEmail(input.email);
    const user = await tenant.db.selectFrom('app_user').selectAll().where('email', '=', email).executeTakeFirst();
    if (user?.status !== 'active' || user.password_hash === null) {
      await verifyAgainstDummy(input.password);
      await this.record(tenant, 'auth.login.failed', { actor: null, data: { reason: 'unknown_or_inactive', emailHmac: tenant.crypto.hmac('email', email) }, meta });
      throw INVALID_CREDENTIALS();
    }
    if (this.isLocked(user)) {
      await verifyAgainstDummy(input.password);
      await this.record(tenant, 'auth.login.failed', { actor: null, subjectUserId: user.id, data: { reason: 'locked' }, meta });
      throw INVALID_CREDENTIALS();
    }
    const result = await verifyPassword(input.password, user.password_hash);
    if (!result.ok) {
      await this.registerFailure(tenant, user);
      await this.record(tenant, 'auth.login.failed', { actor: null, subjectUserId: user.id, data: { reason: 'password' }, meta });
      throw INVALID_CREDENTIALS();
    }
    await tenant.db
      .updateTable('app_user')
      .set({ failed_attempts: 0, locked_until: null, ...(result.needsRehash ? { password_hash: await hashPassword(input.password) } : {}) })
      .where('id', '=', user.id)
      .execute();
    const roles = await this.rolesOf(tenant, user.id);
    const stage: SessionStage = user.mfa_secret_sealed !== null ? 'mfa_pending' : requiresMfa(roles) ? 'mfa_enroll' : 'full';
    const issued = await this.issueSession(tenant, user.id, stage, null);
    await this.record(tenant, stage === 'full' ? 'auth.login.succeeded' : 'auth.login.password_ok', { actor: { userId: user.id }, subjectUserId: user.id, data: { stage }, meta });
    return issued;
  }

  /** Segundo paso: código TOTP o código de recuperación. */
  async verifyMfa(ctx: SessionContext, input: { code?: string | undefined; recoveryCode?: string | undefined }, meta: RequestMeta): Promise<IssuedSession> {
    const { tenant, user } = ctx;
    if (this.isLocked(user)) throw new ApiError(401, 'invalid_code', 'Código incorrecto.');
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
      await this.registerFailure(tenant, user);
      await this.record(tenant, 'auth.mfa.failed', { actor: { userId: user.id }, subjectUserId: user.id, meta });
      throw new ApiError(401, 'invalid_code', 'Código incorrecto.');
    }
    await tenant.db.updateTable('app_user').set({ failed_attempts: 0, locked_until: null }).where('id', '=', user.id).execute();
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
    if (!(await this.checkTotp(ctx, code))) {
      await this.registerFailure(ctx.tenant, ctx.user);
      await this.record(ctx.tenant, 'auth.reauth.failed', { actor: { userId: ctx.user.id }, subjectUserId: ctx.user.id, meta });
      throw new ApiError(401, 'invalid_code', 'Código incorrecto.');
    }
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
    if (stored === null || !(await verifyPassword(current, stored)).ok) {
      await this.registerFailure(ctx.tenant, ctx.user);
      await this.record(ctx.tenant, 'auth.password.change_failed', { actor: { userId: ctx.user.id }, subjectUserId: ctx.user.id, meta });
      throw new ApiError(401, 'invalid_credentials', 'La contraseña actual no es correcta.');
    }
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
  async activate(input: { organization?: string | undefined; token: string; password: string }, meta: RequestMeta): Promise<IssuedSession> {
    const invalid = (): ApiError => new ApiError(400, 'invalid_token', 'El enlace de activación no es válido o expiró.');
    const tenant = await this.openTenantOrNull(this.resolveOrganization(input.organization));
    if (tenant === null || !TOKEN_FORMAT.test(input.token)) throw invalid();
    const row = await tenant.db.selectFrom('activation_token').selectAll().where('token_hash', '=', hashToken(input.token)).executeTakeFirst();
    if (row === undefined || row.used_at !== null || new Date(row.expires_at).getTime() <= this.now().getTime()) throw invalid();
    const user = await tenant.db.selectFrom('app_user').selectAll().where('id', '=', row.user_id).executeTakeFirst();
    if (user?.status !== 'invited') throw invalid();
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
    if (Number(consumed.numUpdatedRows) !== 1) throw invalid();
    await tenant.db.updateTable('app_user').set({ status: 'active', password_hash: hash, password_changed_at: now, updated_at: now }).where('id', '=', user.id).execute();
    const roles = await this.rolesOf(tenant, user.id);
    const stage: SessionStage = requiresMfa(roles) ? 'mfa_enroll' : 'full';
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
   * Siempre debe quedar al menos un administrador activo con MFA (D-79). Se verifica
   * excluyendo al usuario afectado por el cambio.
   */
  private async assertAnotherAdmin(tenant: TenantHandle, excludingUserId: string): Promise<void> {
    const admins = await tenant.db
      .selectFrom('app_user')
      .innerJoin('user_role', 'user_role.user_id', 'app_user.id')
      .select('app_user.id')
      .where('user_role.role', '=', 'org_admin')
      .where('app_user.status', '=', 'active')
      .where('app_user.mfa_secret_sealed', 'is not', null)
      .where('app_user.id', '!=', excludingUserId)
      .execute();
    if (admins.length === 0) {
      throw new ApiError(409, 'last_admin', 'La organización debe conservar al menos un administrador activo con verificación en dos pasos.');
    }
  }

  async setRoles(ctx: SessionContext, userId: string, roles: string[], meta: RequestMeta): Promise<void> {
    const problems = validateRoleSet(roles);
    if (problems.length > 0) throw new ApiError(400, 'invalid_roles', problems.join(' '));
    const target = await this.findUser(ctx.tenant, userId);
    const before = await this.rolesOf(ctx.tenant, userId);
    if (before.includes('org_admin') && !roles.includes('org_admin')) await this.assertAnotherAdmin(ctx.tenant, userId);
    await ctx.tenant.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('user_role').where('user_id', '=', userId).execute();
      await trx.insertInto('user_role').values(roles.map((role) => ({ user_id: userId, role }))).execute();
    });
    // Los permisos nuevos rigen desde ya: se cierran las sesiones del usuario afectado.
    await this.revokeAllSessions(ctx.tenant, target.id);
    await this.record(ctx.tenant, 'user.roles.changed', { actor: { userId: ctx.user.id }, subjectUserId: userId, data: { before: [...before].sort(), after: [...roles].sort() }, meta });
  }

  async deactivate(ctx: SessionContext, userId: string, meta: RequestMeta): Promise<void> {
    const target = await this.findUser(ctx.tenant, userId);
    if (target.status === 'disabled') return;
    if ((await this.rolesOf(ctx.tenant, userId)).includes('org_admin')) await this.assertAnotherAdmin(ctx.tenant, userId);
    await ctx.tenant.db.updateTable('app_user').set({ status: 'disabled', updated_at: iso(this.now()) }).where('id', '=', userId).execute();
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
    await ctx.tenant.db.deleteFrom('recovery_code').where('user_id', '=', userId).execute();
    await this.revokeAllSessions(ctx.tenant, userId);
    await this.record(ctx.tenant, 'user.mfa.reset', { actor: { userId: ctx.user.id }, subjectUserId: userId, meta });
  }
}
