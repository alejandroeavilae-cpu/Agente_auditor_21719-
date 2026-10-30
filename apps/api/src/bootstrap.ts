// SPDX-License-Identifier: AGPL-3.0-or-later

import 'reflect-metadata';
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
  if (identity?.config.trustProxy === true) app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.enableShutdownHooks();
  return app;
}
