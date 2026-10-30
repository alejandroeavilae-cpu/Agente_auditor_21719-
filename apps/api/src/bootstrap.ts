// SPDX-License-Identifier: AGPL-3.0-or-later

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/app-config.js';
import type { IdentityRuntime } from './identity/http.js';

/**
 * Cabeceras de seguridad aplicadas por la propia API, además de las que agrega
 * el proxy inverso: defensa en profundidad si la API se expone sin proxy
 * (`09-seguridad.md` §10.4).
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  // La API solo devuelve JSON: no carga ni ejecuta nada.
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Crea la aplicación sin escuchar todavía (permite pruebas con puerto efímero). */
export async function createApp(config: AppConfig, identity?: IdentityRuntime): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, identity), {
    logger: ['error', 'warn', 'log'],
  });
  // Oculta la cabecera "X-Powered-By: Express" para no revelar tecnología.
  app.disable('x-powered-by');
  // Detrás del proxy inverso (Caddy) la IP real llega en X-Forwarded-For: se confía solo
  // en UN salto, y solo si se configuró explícitamente.
  if (identity?.config.trustProxy === true) {
    app.set('trust proxy', 1);
    // QA 2C1-05: solo es correcto si delante hay EXACTAMENTE un proxy (Caddy) y la API no se
    // publica directamente; si no, un cliente podría fijar su IP con X-Forwarded-For y eludir
    // el límite por IP y el bloqueo por origen (R-34).
    new Logger('API').warn('TRUST_PROXY=true: la IP del cliente se toma de X-Forwarded-For (un salto). Use esto solo si la API está detrás de exactamente un proxy inverso y NO se publica directamente.');
  }
  app.use(securityHeaders);
  app.enableShutdownHooks();
  return app;
}
