// SPDX-License-Identifier: AGPL-3.0-or-later

import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { Authenticated, IDENTITY_SERVICE, requestMeta, sessionOf, type IdentityRequest, type IdentityRuntime } from './http.js';

const uuid = z.uuid();
const rolesSchema = z.array(z.string().max(40)).max(10);
const inviteSchema = z.strictObject({
  email: z.email().max(254),
  // Sin caracteres de control (evita inyectar secuencias en listados, como en B-06).
  displayName: z.string().trim().min(2).max(200).regex(/^[^\p{C}]+$/u),
  roles: rolesSchema,
});
const setRolesSchema = z.strictObject({ roles: rolesSchema });

function userId(raw: string): string {
  const parsed = uuid.safeParse(raw);
  if (!parsed.success) throw new ApiError(404, 'user_not_found', 'Usuario no encontrado.');
  return parsed.data;
}

/**
 * Gestión de usuarios de la organización (solo Administrador de organización). Las
 * acciones que cambian permisos o desactivan cuentas son de alto riesgo: exigen MFA
 * verificada en los últimos 5 minutos (D-79).
 */
@Controller('api/v1/users')
export class UsersController {
  constructor(@Inject(IDENTITY_SERVICE) private readonly identity: IdentityRuntime) {}

  /** Lista con estado de bloqueo y aviso de contraseña comprometida (R-38, `docs/fase-2/2c2-api.md`). */
  @Get()
  @Authenticated({ permission: 'users.read' })
  async list(@Req() req: IdentityRequest): Promise<object> {
    return { users: await this.identity.service.listUsers(sessionOf(req).tenant) };
  }

  /** Devuelve el token de activación UNA vez: el administrador lo entrega por un canal seguro. */
  @Post('invitations')
  @HttpCode(201)
  @Authenticated({ permission: 'users.manage', recentMfa: true })
  async invite(@Body() body: unknown, @Req() req: IdentityRequest): Promise<object> {
    const input = inviteSchema.parse(body);
    const ctx = sessionOf(req);
    return this.identity.service.inviteUser(ctx.tenant, { userId: ctx.user.id }, input, requestMeta(req));
  }

  @Patch(':id/roles')
  @HttpCode(204)
  @Authenticated({ permission: 'users.manage', recentMfa: true })
  async setRoles(@Param('id') id: string, @Body() body: unknown, @Req() req: IdentityRequest): Promise<void> {
    const { roles } = setRolesSchema.parse(body);
    await this.identity.service.setRoles(sessionOf(req), userId(id), roles, requestMeta(req));
  }

  @Post(':id/deactivate')
  @HttpCode(204)
  @Authenticated({ permission: 'users.manage', recentMfa: true })
  async deactivate(@Param('id') id: string, @Req() req: IdentityRequest): Promise<void> {
    await this.identity.service.deactivate(sessionOf(req), userId(id), requestMeta(req));
  }

  /**
   * Desbloquea una cuenta bloqueada por intentos fallidos (QA 2B-11). Si levanta un bloqueo
   * de MFA, la persona queda obligada a cambiar su contraseña (R-38); la lista de usuarios
   * lo informa en `mustChangePassword`.
   */
  @Post(':id/unlock')
  @HttpCode(204)
  @Authenticated({ permission: 'users.manage', recentMfa: true })
  async unlock(@Param('id') id: string, @Req() req: IdentityRequest): Promise<void> {
    const ctx = sessionOf(req);
    await this.identity.service.unlockUser(ctx.tenant, { userId: ctx.user.id }, userId(id), requestMeta(req));
  }

  @Post(':id/mfa/reset')
  @HttpCode(204)
  @Authenticated({ permission: 'users.manage', recentMfa: true })
  async resetMfa(@Param('id') id: string, @Req() req: IdentityRequest): Promise<void> {
    await this.identity.service.resetMfa(sessionOf(req), userId(id), requestMeta(req));
  }
}
