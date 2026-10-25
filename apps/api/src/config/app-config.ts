// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/** Token de inyección de la configuración validada. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Esquema de configuración por variables de entorno.
 *
 * Se valida al arrancar: un valor inválido detiene el proceso en vez de
 * funcionar con una configuración insegura o ambigua (falla cerrada).
 * Los secretos NO se leen de variables de entorno sino de archivos montados
 * (`*_FILE`), decisión documentada en docs/fase-0/05-arquitectura.md §5.4.
 */
const configSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  /** Commit exacto de la compilación; lo inyecta el pipeline de construcción. */
  BUILD_COMMIT: z.string().regex(/^[0-9a-f]{7,40}$|^desarrollo$/).default('desarrollo'),
  /** Versión publicada (SemVer) de la compilación. */
  BUILD_VERSION: z.string().default('0.1.0'),
  /**
   * URL del código fuente correspondiente a la versión en ejecución.
   * Requisito de la sección 13 de la AGPL-3.0 y del Centro de Confianza.
   */
  SOURCE_URL: z.url().default('https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-'),
});

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Lee y valida la configuración.
 * @throws {Error} con la lista de variables inválidas.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${detail}`);
  }
  return parsed.data;
}
