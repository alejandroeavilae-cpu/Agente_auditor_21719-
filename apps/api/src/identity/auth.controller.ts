// SPDX-License-Identifier: AGPL-3.0-or-later

import { ROLE_LABELS } from '@auditor-21719/identity';
import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Authenticated, clearSessionCookie, IDENTITY_SERVICE, Public, requestMeta, sessionOf, setSessionCookie, type IdentityRequest, type IdentityRuntime } from './http.js';
import type { IssuedSession } from './identity.service.js';

// Esquemas estrictos: se rechazan campos no declarados (`09-seguridad.md` §10.4).
const organization = z.string().max(30).optional();
const loginSchema = z.strictObject({ organization, email: z.string().min(3).max(254), password: z.string().min(1).max(1024) });
const codeSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/) });
const mfaVerifySchema = z.union([z.strictObject({ code: z.string().regex(/^\d{6}$/) }), z.strictObject({ recoveryCode: z.string().min(16).max(40) })]);
const passwordSchema = z.strictObject({ currentPassword: z.string().min(1).max(1024), newPassword: z.string().min(1).max(1024) });
const activateSchema = z.strictObject({ organization, token: z.string().max(100), password: z.string().min(1).max(1024) });

/** Respuesta común tras emitir una sesión: la etapa y el token anti-CSRF (nunca el de sesión). */
function sessionBody(issued: IssuedSession): { stage: string; csrfToken: string } {
  return { stage: issued.stage, csrfToken: issued.csrfToken };
}

/**
 * Autenticación (2B). Endpoints bajo `/api/v1/auth`. La cookie de sesión es `HttpOnly`,
 * `SameSite=Strict` y `Secure` (salvo configuración explícita de pruebas).
 */
@Controller('api/v1/auth')
export class AuthController {
  constructor(@Inject(IDENTITY_SERVICE) private readonly identity: IdentityRuntime) {}

  @Post('login')
  @HttpCode(200)
  @Public({ rateLimited: true })
  async login(@Body() body: unknown, @Req() req: IdentityRequest, @Res({ passthrough: true }) res: Response): Promise<object> {
    const input = loginSchema.parse(body);
    const issued = await this.identity.service.login(input, requestMeta(req));
    setSessionCookie(res, this.identity.config, issued);
    return sessionBody(issued);
  }

  @Post('mfa/verify')
  @HttpCode(200)
  @Authenticated({ stages: ['mfa_pending'], rateLimited: true })
  async verifyMfa(@Body() body: unknown, @Req() req: IdentityRequest, @Res({ passthrough: true }) res: Response): Promise<object> {
    const input = mfaVerifySchema.parse(body);
    const issued = await this.identity.service.verifyMfa(sessionOf(req), input, requestMeta(req));
    setSessionCookie(res, this.identity.config, issued);
    return sessionBody(issued);
  }

  @Post('mfa/enroll')
  @HttpCode(200)
  @Authenticated({ stages: ['mfa_enroll', 'full'] })
  async enrollMfa(@Body() body: unknown, @Req() req: IdentityRequest): Promise<object> {
    z.strictObject({}).parse(body ?? {});
    return this.identity.service.enrollMfa(sessionOf(req));
  }

  @Post('mfa/confirm')
  @HttpCode(200)
  @Authenticated({ stages: ['mfa_enroll', 'full'], rateLimited: true })
  async confirmMfa(@Body() body: unknown, @Req() req: IdentityRequest, @Res({ passthrough: true }) res: Response): Promise<object> {
    const { code } = codeSchema.parse(body);
    const { session, recoveryCodes } = await this.identity.service.confirmMfa(sessionOf(req), code, requestMeta(req));
    setSessionCookie(res, this.identity.config, session);
    return { ...sessionBody(session), recoveryCodes };
  }

  @Post('reauth')
  @HttpCode(204)
  @Authenticated({ rateLimited: true })
  async reauth(@Body() body: unknown, @Req() req: IdentityRequest): Promise<void> {
    const { code } = codeSchema.parse(body);
    await this.identity.service.reauthenticate(sessionOf(req), code, requestMeta(req));
  }

  @Post('logout')
  @HttpCode(204)
  @Authenticated({ stages: ['mfa_pending', 'mfa_enroll', 'full'] })
  async logout(@Req() req: IdentityRequest, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.identity.service.logout(sessionOf(req), requestMeta(req));
    clearSessionCookie(res, this.identity.config);
  }

  @Post('password')
  @HttpCode(200)
  @Authenticated({ rateLimited: true })
  async changePassword(@Body() body: unknown, @Req() req: IdentityRequest, @Res({ passthrough: true }) res: Response): Promise<object> {
    const input = passwordSchema.parse(body);
    const issued = await this.identity.service.changePassword(sessionOf(req), input.currentPassword, input.newPassword, requestMeta(req));
    setSessionCookie(res, this.identity.config, issued);
    return sessionBody(issued);
  }

  @Post('activate')
  @HttpCode(200)
  @Public({ rateLimited: true })
  async activate(@Body() body: unknown, @Req() req: IdentityRequest, @Res({ passthrough: true }) res: Response): Promise<object> {
    const input = activateSchema.parse(body);
    const issued = await this.identity.service.activate(input, requestMeta(req));
    setSessionCookie(res, this.identity.config, issued);
    return sessionBody(issued);
  }

  /** Datos del usuario actual y un token anti-CSRF nuevo (p. ej. al recargar la página). */
  @Get('me')
  @Authenticated({ stages: ['mfa_pending', 'mfa_enroll', 'full'] })
  async me(@Req() req: IdentityRequest): Promise<object> {
    const ctx = sessionOf(req);
    return {
      organization: { slug: ctx.tenant.info.slug, name: ctx.tenant.info.name },
      user: { id: ctx.user.id, email: ctx.user.email, displayName: ctx.user.display_name, mfaEnabled: ctx.user.mfa_secret_sealed !== null },
      roles: ctx.roles.map((r) => ({ id: r, label: ROLE_LABELS[r] })),
      stage: ctx.session.stage,
      csrfToken: await this.identity.service.refreshCsrf(ctx),
    };
  }
}
