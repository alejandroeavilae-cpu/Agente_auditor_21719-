// SPDX-License-Identifier: AGPL-3.0-or-later

/** Error de lectura de una línea JSONL, con su número de línea (base 1). */
export class JsonlParseError extends Error {
  constructor(
    readonly line: number,
    message: string,
  ) {
    super(`Línea ${line}: ${message}`);
    this.name = 'JsonlParseError';
  }
}

/**
 * Lee texto JSON Lines (un objeto JSON por línea). Ignora líneas vacías.
 *
 * Se usa JSONL como formato de exportación porque cualquier organización puede
 * inspeccionarlo con herramientas comunes (editor, `jq`) sin depender de la
 * plataforma, requisito de verificación independiente (sección 15.3).
 *
 * @throws {JsonlParseError} si una línea no es JSON válido.
 */
export function parseJsonl(text: string): unknown[] {
  const result: unknown[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '') return;
    try {
      result.push(JSON.parse(line));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new JsonlParseError(index + 1, `JSON inválido (${detail})`);
    }
  });
  return result;
}

/** Serializa objetos como JSON Lines terminando en salto de línea. */
export function toJsonl(items: readonly unknown[]): string {
  return items.map((item) => JSON.stringify(item)).join('\n') + (items.length > 0 ? '\n' : '');
}
