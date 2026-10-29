// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Permission } from '@auditor-21719/identity';
import type { SessionStage } from '@auditor-21719/persistence';
import { SetMetadata } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import type { IdentityConfig } from './identity-config.js';
import type { IdentityService, IssuedSession, RequestMeta, SessionContext } from './identity.service.js';

/** Tokens de inyección. */
export const IDENTITY_SERVICE = Symbol('IDENTITY_SERVICE');
export const IDENTITY_CONFIG = Symbol('IDENTITY_CONFIG');

/** Lo que la API necesita en tiempo de ejecución para la identidad. */
export interface IdentityRuntime {
  service: IdentityService;
  config: IdentityConfig;
}

// ---------- Metadatos de rutas (denegar por defecto) ----------

export const ROUTE_POLICY = 'auditor:route-policy';

/** Política de acceso de una ruta. TODA ruta debe declarar una (prueba automática). */
export type RoutePolicy =
  | { kind: 'public'; rateLimited?: boolean }
  | { kind: 'session'; stages: readonly SessionStage[]; permission?: Permission; recentMfa?: boolean; rateLimited?: boolean };

/** Ruta sin sesión (salud, versión, inicio de sesión, activación). */
export const Public = (options: { rateLimited?: boolean } = {}): MethodDecorator & ClassDecorator =>
  SetMetadata(ROUTE_POLICY, { kind: 'public', ...options } satisfies RoutePolicy);

/**
 * Ruta con sesión. Por defecto exige sesión completa (con MFA si corresponde).
 * @param options.permission permiso requerido (RBAC).
 * @param options.recentMfa acción de alto riesgo: MFA verificada en los últimos 5 min.
 * @param options.rateLimited cuenta como intento sensible (códigos MFA, contraseña).
 */
export const Authenticated = (
  options: { stages?: readonly SessionStage[]; permission?: Permission; recentMfa?: boolean; rateLimited?: boolean } = {},
): MethodDecorator & ClassDecorator =>
  SetMetadata(ROUTE_POLICY, {
    kind: 'session',
    stages: options.stages ?? ['full'],
    ...(options.permission !== undefined ? { permission: options.permission } : {}),
    ...(options.recentMfa === true ? { recentMfa: true } : {}),
    ...(options.rateLimited === true ? { rateLimited: true } : {}),
  } satisfies RoutePolicy);

// ---------- Petición ----------

/** Petición con el contexto de identidad que agrega el guardia. */
export interface IdentityRequest extends Request {
  identity?: SessionContext;
}

export function requestMeta(req: Request): RequestMeta {
  const ua = req.headers['user-agent'];
  return { ip: req.ip ?? null, userAgent: typeof ua === 'string' ? ua.slice(0, 500) : null };
}

/** Contexto de sesión ya validado por el guardia. */
export function sessionOf(req: IdentityRequest): SessionContext {
  if (req.identity === undefined) throw new Error('Ruta sin contexto de sesión: falta @Authenticated().');
  return req.identity;
}

// ---------- Cookies ----------

/**
 * Nombre de la cookie de sesión. Con `Secure` se usa el prefijo `__Host-`: el navegador
 * exige HTTPS, `Path=/` y ningún `Domain`, lo que impide que un subdominio la pise.
 */
export function sessionCookieName(config: IdentityConfig): string {
  return config.cookieSecure ? '__Host-auditor_session' : 'auditor_session';
}

function cookieOptions(config: IdentityConfig): CookieOptions {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: '/' };
}

export function setSessionCookie(res: Response, config: IdentityConfig, issued: IssuedSession): void {
  res.cookie(sessionCookieName(config), issued.cookieValue, cookieOptions(config));
}

export function clearSessionCookie(res: Response, config: IdentityConfig): void {
  res.clearCookie(sessionCookieName(config), cookieOptions(config));
}

/** Lee una cookie del encabezado sin dependencias adicionales. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

// ---------- Límite de tasa ----------

/**
 * Límite de tasa en memoria por IP (ventana deslizante). Suficiente para la instalación
 * local de un solo proceso (D-74); con varias instancias habría que compartirlo (Valkey).
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Registra un intento; devuelve `false` si se superó el límite. */
  allow(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    // Limpieza ocasional para que el mapa no crezca sin límite.
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.every((t) => t <= now - this.windowMs)) this.hits.delete(k);
    }
    return true;
  }
}
