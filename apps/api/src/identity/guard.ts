// SPDX-License-Identifier: AGPL-3.0-or-later

import { permissionsOf } from '@auditor-21719/identity';
import { Inject, Injectable, Optional, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiError, FORBIDDEN } from './errors.js';
import { IDENTITY_SERVICE, readCookie, ROUTE_POLICY, RateLimiter, sessionCookieName, type IdentityRequest, type IdentityRuntime, type RoutePolicy } from './http.js';

/** Métodos sin efectos: no requieren token anti-CSRF. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Guardia global de acceso. **Deniega por defecto**: una ruta sin `@Public()` ni
 * `@Authenticated()` responde 403 (y una prueba automática lo detecta antes).
 *
 * Orden de comprobaciones de una ruta con sesión: límite de tasa → sesión y etapa →
 * CSRF (si la petición tiene efectos) → permiso (RBAC) → MFA reciente (alto riesgo).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  /** Inicio de sesión, activación y códigos: 20 intentos cada 5 min por IP por defecto [DECISIÓN]. */
  private readonly sensitive: RateLimiter;
  /** Resto de la API: 600 peticiones por minuto por IP [DECISIÓN]. */
  private readonly general = new RateLimiter(600, 60_000);

  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(IDENTITY_SERVICE) private readonly identity?: IdentityRuntime,
  ) {
    this.sensitive = new RateLimiter(identity?.config.sensitiveRateLimit ?? 20, 5 * 60_000);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<RoutePolicy | undefined>(ROUTE_POLICY, [context.getHandler(), context.getClass()]);
    if (policy === undefined) throw new ApiError(403, 'route_not_declared', 'Ruta sin política de acceso declarada.');
    const req = context.switchToHttp().getRequest<IdentityRequest>();
    const ip = req.ip ?? 'desconocida';
    if (!this.general.allow(ip)) throw new ApiError(429, 'rate_limited', 'Demasiadas solicitudes. Intente más tarde.');
    if (policy.kind === 'public') {
      if (policy.rateLimited === true && !this.sensitive.allow(ip)) throw new ApiError(429, 'rate_limited', 'Demasiados intentos. Espere unos minutos.');
      return true;
    }
    if (this.identity === undefined) throw new ApiError(503, 'identity_disabled', 'La identidad no está configurada en esta instalación.');
    const { service, config } = this.identity;
    // Los códigos MFA y el cambio de contraseña también cuentan como intentos sensibles.
    if (policy.rateLimited === true && !this.sensitive.allow(ip)) throw new ApiError(429, 'rate_limited', 'Demasiados intentos. Espere unos minutos.');
    const ctx = await service.authenticate(readCookie(req, sessionCookieName(config)), policy.stages);
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.headers['x-csrf-token'];
      service.verifyCsrf(ctx, typeof header === 'string' ? header : undefined);
    }
    if (policy.permission !== undefined && !permissionsOf(ctx.roles).has(policy.permission)) throw FORBIDDEN();
    if (policy.recentMfa === true) service.requireRecentMfa(ctx);
    req.identity = ctx;
    return true;
  }
}
