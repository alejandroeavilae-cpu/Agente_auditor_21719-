// SPDX-License-Identifier: AGPL-3.0-or-later

import { canonicalJson, type JsonValue } from './canonical-json.js';

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

/** Línea JSONL interpretada, con su número real de línea (base 1) y su texto exacto. */
export interface JsonlLine {
  line: number;
  raw: string;
  value: unknown;
}

/**
 * Igual que `parseJsonl`, pero conserva número de línea real y texto exacto, necesarios
 * para reportar ubicaciones correctas y exigir forma canónica (hallazgos QA H-03, H-15).
 * Solo se tolera un retorno de carro final (archivos editados en Windows).
 *
 * @throws {JsonlParseError} si una línea no es JSON válido.
 */
export function parseJsonlLines(text: string): JsonlLine[] {
  const result: JsonlLine[] = [];
  text.split('\n').forEach((rawLine, index) => {
    const raw = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (raw.trim() === '') return;
    try {
      result.push({ line: index + 1, raw, value: JSON.parse(raw) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new JsonlParseError(index + 1, `JSON inválido (${detail})`);
    }
  });
  return result;
}

/**
 * Serializa objetos como JSON Lines en forma canónica (claves ordenadas, sin espacios),
 * terminando en salto de línea. La verificación exige esta forma exacta.
 *
 * @throws {TypeError} si algún valor no es JSON representable.
 */
export function toJsonl(items: readonly unknown[]): string {
  return items.map((item) => canonicalJson(item as JsonValue)).join('\n') + (items.length > 0 ? '\n' : '');
}
