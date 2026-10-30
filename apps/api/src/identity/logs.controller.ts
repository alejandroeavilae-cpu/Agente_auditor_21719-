// SPDX-License-Identifier: AGPL-3.0-or-later

import { Controller, Get, Inject, Logger, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ApiError } from './errors.js';
import { Authenticated, IDENTITY_SERVICE, requestMeta, sessionOf, type IdentityRequest, type IdentityRuntime } from './http.js';
import { ACCESS_LOG_DEFAULT_PAGE, ACCESS_LOG_MAX_PAGE, exportAuditLog, listAccessLog } from './logs.service.js';

/** Nombre de evento: minúsculas, dígitos, punto y guion bajo (como los que registra la API). */
const EVENT_NAME = /^[a-z][a-z0-9_.]{0,59}$/;

/** Fecha ISO 8601 en UTC ("Z"), normalizada al formato guardado (milisegundos). */
const isoUtc = z.iso.datetime().transform((v) => new Date(v).toISOString());

/**
 * Parámetros del registro de accesos. Esquema estricto: un parámetro no declarado o
 * repetido (llega como arreglo) se rechaza (`09-seguridad.md` §10.4).
 */
const accessLogQuery = z
  .strictObject({
    limit: z
      .string()
      .regex(/^\d{1,3}$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(ACCESS_LOG_MAX_PAGE))
      .optional(),
    cursor: z.string().max(200).optional(),
    // Lista separada por comas, hasta 20 eventos.
    event: z
      .string()
      .max(1300)
      .transform((v) => v.split(','))
      .pipe(z.array(z.string().regex(EVENT_NAME)).min(1).max(20))
      .optional(),
    userId: z.uuid().optional(),
    from: isoUtc.optional(),
    to: isoUtc.optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.from < q.to, { message: '"from" debe ser anterior a "to"', path: ['from'] });

/**
 * Registro de accesos (2C-2, pregunta 3 de 2C §6, D-88): solo lectura, solo el
 * Administrador de organización, con reautenticación MFA reciente porque muestra IP en claro.
 */
@Controller('api/v1/access-log')
export class AccessLogController {
  constructor(@Inject(IDENTITY_SERVICE) private readonly identity: IdentityRuntime) {}

  @Get()
  @Authenticated({ permission: 'access_log.read', recentMfa: true })
  async list(@Query() raw: unknown, @Req() req: IdentityRequest): Promise<object> {
    const q = accessLogQuery.parse(raw ?? {});
    return listAccessLog(
      this.identity.service,
      sessionOf(req),
      { limit: q.limit ?? ACCESS_LOG_DEFAULT_PAGE, cursor: q.cursor, events: q.event, userId: q.userId, from: q.from, to: q.to },
      requestMeta(req),
    );
  }
}

/** Espera a que el socket acepte más datos, o a que se cierre (cliente que abandona la descarga). */
function drained(res: Response): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.on('drain', done);
    res.on('close', done);
  });
}

/**
 * Exportación de la bitácora (2C §2.4): solo el Administrador de organización, con
 * reautenticación MFA reciente. JSON Lines verificable con `auditor-log verify`.
 */
@Controller('api/v1/audit-log')
export class AuditLogController {
  private readonly logger = new Logger('Bitácora');

  constructor(@Inject(IDENTITY_SERVICE) private readonly identity: IdentityRuntime) {}

  @Get('export')
  @Authenticated({ permission: 'audit_log.export', recentMfa: true })
  async export(@Query() raw: unknown, @Req() req: IdentityRequest, @Res() res: Response): Promise<void> {
    z.strictObject({}).parse(raw ?? {});
    // Todo lo que puede fallar ANTES de enviar datos lanza un error normal (respuesta JSON).
    const exp = await exportAuditLog(this.identity.service, sessionOf(req), requestMeta(req));
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exp.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    // Para que la interfaz indique el comando exacto de verificación (`--chain-id`).
    res.setHeader('X-Audit-Chain-Id', exp.chainId);
    try {
      for await (const chunk of exp.chunks) {
        if (res.destroyed) return;
        if (!res.write(chunk)) await drained(res);
      }
      res.end();
    } catch (error) {
      // Ya se enviaron cabeceras: se corta la conexión para que la descarga quede
      // incompleta de forma visible (la verificación fallará), nunca "terminada" a medias.
      this.logger.error(`Exportación interrumpida: ${error instanceof Error ? error.message : 'error no identificado'}`);
      if (!res.headersSent) {
        // Nada enviado aún: respuesta de error JSON normal, sin las cabeceras de descarga.
        for (const h of ['Content-Type', 'Content-Disposition', 'X-Audit-Chain-Id']) res.removeHeader(h);
        throw new ApiError(500, 'internal', 'Error interno.');
      }
      res.destroy();
    }
  }
}
