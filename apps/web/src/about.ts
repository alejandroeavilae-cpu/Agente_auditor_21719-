// SPDX-License-Identifier: AGPL-3.0-or-later

/** Información de versión que expone la API (`GET /api/v1/about`). */
export interface About {
  name: string;
  version: string;
  commit: string;
  license: string;
  sourceUrl: string;
  sourceForThisVersionUrl: string;
}

/**
 * Valida la respuesta de la API antes de mostrarla.
 * La interfaz no confía en la forma de los datos recibidos por red.
 */
export function parseAbout(value: unknown): About | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const keys = ['name', 'version', 'commit', 'license', 'sourceUrl', 'sourceForThisVersionUrl'] as const;
  if (!keys.every((k) => typeof v[k] === 'string')) return null;
  // Solo se aceptan enlaces https para evitar esquemas peligrosos (p. ej. javascript:).
  if (!String(v.sourceForThisVersionUrl).startsWith('https://')) return null;
  return v as unknown as About;
}

/** Texto corto de versión: "0.1.0 (abc1234)". */
export function formatVersion(about: About): string {
  return `${about.version} (${about.commit.slice(0, 7)})`;
}
