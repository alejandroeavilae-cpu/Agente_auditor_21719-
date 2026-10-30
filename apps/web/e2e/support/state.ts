// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DbServerConfig } from '@auditor-21719/persistence';

/**
 * Estado de la ejecución E2E que escribe el global setup en un directorio temporal propio
 * (permisos 700, fuera del repositorio). Solo datos SINTÉTICOS generados en la ejecución.
 */
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

export function loadState(): E2EState {
  const dir = process.env.E2E_STATE_DIR;
  if (dir === undefined) throw new Error('E2E_STATE_DIR no está definido (¿se ejecutó el global setup?)');
  return JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as E2EState;
}

/** Contraseña sintética aleatoria y larga (pasa la política: ≥ 12, no común). */
export function syntheticPassword(): string {
  return `frase-sintetica-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

/** Sufijo único para correos sintéticos. */
export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
