// SPDX-License-Identifier: AGPL-3.0-or-later

import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AboutController } from './about/about.controller.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { HealthController } from './health/health.controller.js';
import { AuthController } from './identity/auth.controller.js';
import { ErrorFilter } from './identity/errors.js';
import { AccessGuard } from './identity/guard.js';
import { IDENTITY_SERVICE, type IdentityRuntime } from './identity/http.js';
import { AccessLogController, AuditLogController } from './identity/logs.controller.js';
import { UsersController } from './identity/users.controller.js';

/**
 * Módulo raíz. Con identidad configurada (2B) agrega autenticación y gestión de usuarios;
 * desde 2C-2, el registro de accesos y la exportación de la bitácora.
 * El guardia global deniega por defecto toda ruta sin política declarada.
 */
@Module({})
export class AppModule {
  static register(config: AppConfig, identity?: IdentityRuntime): DynamicModule {
    const providers: Provider[] = [
      { provide: APP_CONFIG, useValue: config },
      { provide: APP_GUARD, useClass: AccessGuard },
      { provide: APP_FILTER, useClass: ErrorFilter },
    ];
    if (identity !== undefined) providers.push({ provide: IDENTITY_SERVICE, useValue: identity });
    return {
      module: AppModule,
      controllers: identity !== undefined ? [HealthController, AboutController, AuthController, UsersController, AccessLogController, AuditLogController] : [HealthController, AboutController],
      providers,
    };
  }
}
