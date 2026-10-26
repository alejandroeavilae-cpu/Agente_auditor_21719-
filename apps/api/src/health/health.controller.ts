// SPDX-License-Identifier: AGPL-3.0-or-later

import { Controller, Get } from '@nestjs/common';

/** Respuesta de la sonda de vida. */
export interface HealthResponse {
  status: 'ok';
}

/**
 * Sonda de vida usada por Docker Compose y el proxy inverso.
 * No expone versiones ni detalles internos: está accesible sin autenticación.
 */
@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return { status: 'ok' };
  }
}
