// SPDX-License-Identifier: AGPL-3.0-or-later

import { Controller, Get, Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';

/** Información pública sobre la versión en ejecución. */
export interface AboutResponse {
  name: string;
  version: string;
  commit: string;
  license: 'AGPL-3.0-or-later';
  sourceUrl: string;
  sourceForThisVersionUrl: string;
}

/**
 * Expone qué versión exacta se está ejecutando y dónde está su código fuente.
 *
 * Razones: (1) la sección 13 de la AGPL-3.0 obliga a ofrecer el código fuente
 * a quienes usan el programa por red; (2) el Centro de Confianza exige que una
 * organización pueda contrastar la versión instalada con el código publicado.
 */
@Controller('api/v1/about')
export class AboutController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  about(): AboutResponse {
    const ref = this.config.BUILD_COMMIT === 'desarrollo' ? 'main' : this.config.BUILD_COMMIT;
    return {
      name: 'Auditor 21719',
      version: this.config.BUILD_VERSION,
      commit: this.config.BUILD_COMMIT,
      license: 'AGPL-3.0-or-later',
      sourceUrl: this.config.SOURCE_URL,
      sourceForThisVersionUrl: `${this.config.SOURCE_URL}/tree/${ref}`,
    };
  }
}
