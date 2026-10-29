// SPDX-License-Identifier: AGPL-3.0-or-later

import { Catch, HttpException, Logger, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Error de la API con un código estable (para la interfaz de 2C y las pruebas) y un
 * mensaje en español apto para mostrar. Nunca incluye detalles internos.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Mensaje único para cualquier fallo de inicio de sesión: no revela qué dato falló. */
export const INVALID_CREDENTIALS = (): ApiError => new ApiError(401, 'invalid_credentials', 'Organización, correo o contraseña incorrectos.');
export const UNAUTHENTICATED = (): ApiError => new ApiError(401, 'unauthenticated', 'Debe iniciar sesión.');
export const FORBIDDEN = (): ApiError => new ApiError(403, 'forbidden', 'No tiene permiso para esta acción.');

/**
 * Filtro global de errores (`09-seguridad.md` §10.4): respuestas uniformes
 * `{ error, message }` y **sin trazas internas** hacia el cliente. Los errores inesperados
 * se registran en el servidor (sin cuerpos de petición, que pueden traer contraseñas).
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('API');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ApiError) {
      res.status(exception.status).json({ error: exception.code, message: exception.message });
      return;
    }
    if (exception instanceof ZodError) {
      res.status(400).json({ error: 'invalid_request', message: 'La solicitud no tiene el formato esperado.', fields: exception.issues.map((i) => i.path.join('.')) });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      res.status(status).json({ error: status === 404 ? 'not_found' : 'http_error', message: status === 404 ? 'Recurso no encontrado.' : 'Solicitud no válida.' });
      return;
    }
    this.logger.error(exception instanceof Error ? `${exception.name}: ${exception.message}` : 'Error no identificado');
    res.status(500).json({ error: 'internal', message: 'Error interno.' });
  }
}
