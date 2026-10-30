// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import type { DbServerConfig } from '@auditor-21719/persistence';

/** Estado de la ejecución E2E. Solo datos SINTÉTICOS generados en la ejecución. */
export interface E2EState {
  webUrl: string;
  apiUrl: string;
  slug: string;
  organizationName: string;
  /** Base de la organización (para simular el paso del tiempo en sesiones). */
  tenantDb: string;
  controlDb: string;
  superServer: DbServerConfig;
  admin: { email: string; password: string; secret: string; name: string };
  stateDir: string;
  repoRoot: string;
}

/**
 * El global setup entrega el estado en la variable de entorno `E2E_STATE` (Playwright la
 * hereda a los procesos de prueba). No se escribe a disco: incluye el secreto TOTP
 * sintético del administrador de prueba.
 */
export function loadState(): E2EState {
  const raw = process.env.E2E_STATE;
  if (raw === undefined) throw new Error('E2E_STATE no está definido (¿se ejecutó el global setup?)');
  return JSON.parse(raw) as E2EState;
}

/** Contraseña sintética aleatoria y larga (pasa la política: ≥ 12, no común). */
export function syntheticPassword(): string {
  return `frase-sintetica-${randomBytes(9).toString('base64url')}`;
}

/** Sufijo único para correos y nombres sintéticos (minúsculas y dígitos). */
export function uid(): string {
  return `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}
