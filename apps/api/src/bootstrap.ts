// SPDX-License-Identifier: AGPL-3.0-or-later

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/app-config.js';

/**
 * Cabeceras de seguridad aplicadas por la propia API, además de las que agrega
 * el proxy inverso: defensa en profundidad si la API se expone sin proxy.
 */
function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Crea la aplicación sin escuchar todavía (permite pruebas con puerto efímero). */
export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    logger: ['error', 'warn', 'log'],
  });
  // Oculta la cabecera "X-Powered-By: Express" para no revelar tecnología.
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.enableShutdownHooks();
  return app;
}
