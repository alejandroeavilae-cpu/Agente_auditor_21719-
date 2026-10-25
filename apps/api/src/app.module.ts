// SPDX-License-Identifier: AGPL-3.0-or-later

import { Module, type DynamicModule } from '@nestjs/common';
import { AboutController } from './about/about.controller.js';
import { APP_CONFIG, type AppConfig } from './config/app-config.js';
import { HealthController } from './health/health.controller.js';

/**
 * Módulo raíz. En la Fase 1 solo contiene salud e información de versión;
 * los módulos de dominio se agregan a partir de la Fase 2.
 */
@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, AboutController],
      providers: [{ provide: APP_CONFIG, useValue: config }],
    };
  }
}
