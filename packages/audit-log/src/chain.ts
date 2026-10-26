// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, type JsonValue } from './canonical-json.js';

/** Hash de 64 ceros que encabeza toda cadena (no existe entrada anterior). */
export const GENESIS_HASH = '0'.repeat(64);

const hexHash = z.string().regex(/^[0-9a-f]{64}$/, 'Debe ser un hash SHA-256 en hexadecimal minúsculo');

/**
 * Claves prohibidas en objetos de la bitácora. `JSON.parse` las crea como propiedades
 * propias, pero al copiarlas a un objeto nuevo se interpretan como el prototipo y
 * desaparecen: el contenido visible del archivo dejaría de coincidir con lo encadenado
 * (hallazgo QA H-01).
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/**
 * Detecta claves prohibidas como propiedades PROPIAS en cualquier nivel. Es necesario
 * porque zod descarta `__proto__` en silencio antes de que un refinamiento lo vea
 * (hallazgo QA N-04).
 */
export function hasForbiddenKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKey(item));
  if (typeof value === 'object' && value !== null) {
    for (const key of FORBIDDEN_KEYS) if (Object.hasOwn(value, key)) return true;
    return Object.values(value).some((item) => hasForbiddenKey(item));
  }
  return false;
}

const safeKey = z.string().refine((key) => !FORBIDDEN_KEYS.has(key), {
  message: 'Clave prohibida en la bitácora (__proto__, constructor o prototype)',
});

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    // En zod 4, z.number() ya rechaza NaN e Infinity.
    z.number(),
    z.string(),
    z.array(jsonValue),
    z.record(safeKey, jsonValue),
  ]),
);

/**
 * Esquema de una entrada de bitácora.
 *
 * `chainId` identifica la cadena (normalmente un tenant) y forma parte del hash:
 * así una entrada copiada desde la cadena de otra organización no valida.
 * `data` nunca debe contener valores de registros personales de sistemas
 * auditados (decisión D-09); solo metadatos de la acción.
 */
export const auditEntrySchema = z
  .object({
    chainId: z.string().min(1).max(200),
    seq: z.number().int().nonnegative(),
    // Solo UTC con sufijo "Z" (formato de Date.toISOString): una única representación
    // por instante, comparable entre entradas (hallazgo QA H-13).
    // Exactamente 3 decimales, como Date.toISOString: así la comparación de texto
    // equivale a la cronológica (hallazgo QA N-01).
    timestamp: z.iso.datetime({ precision: 3 }),
    actor: z.string().min(1).max(500),
    action: z.string().min(1).max(200),
    object: z.string().max(1000),
    data: z.record(safeKey, jsonValue),
    prevHash: hexHash,
    hash: hexHash,
  })
  .strict();

export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** Datos que aporta quien registra una acción; el resto lo calcula la bitácora. */
export interface AuditEntryInput {
  actor: string;
  action: string;
  object: string;
  data?: Record<string, JsonValue>;
}

/**
 * Calcula el hash de una entrada a partir de todos sus campos excepto `hash`.
 * Cualquier cambio en un campo, incluido `prevHash`, cambia el resultado.
 */
export function computeEntryHash(entry: Omit<AuditEntry, 'hash'>): string {
  const payload: JsonValue = {
    chainId: entry.chainId,
    seq: entry.seq,
    timestamp: entry.timestamp,
    actor: entry.actor,
    action: entry.action,
    object: entry.object,
    data: entry.data,
    prevHash: entry.prevHash,
  };
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

/**
 * Crea la siguiente entrada de una cadena.
 *
 * @param previous última entrada existente, o `null` si la cadena está vacía.
 * @param chainId identificador de la cadena; debe coincidir con el de `previous`.
 * @param input acción a registrar.
 * @param now instante de registro (inyectable para pruebas reproducibles).
 * @throws {Error} si `previous` pertenece a otra cadena.
 */
export function createEntry(
  previous: AuditEntry | null,
  chainId: string,
  input: AuditEntryInput,
  now: Date = new Date(),
): AuditEntry {
  if (previous !== null && previous.chainId !== chainId) {
    throw new Error('La entrada anterior pertenece a otra cadena; no se puede encadenar.');
  }
  if (hasForbiddenKey(input.data)) {
    throw new Error('Los datos contienen una clave prohibida (__proto__, constructor o prototype).');
  }
  const base: Omit<AuditEntry, 'hash'> = {
    chainId,
    seq: previous === null ? 0 : previous.seq + 1,
    timestamp: now.toISOString(),
    actor: input.actor,
    action: input.action,
    object: input.object,
    data: input.data ?? {},
    prevHash: previous === null ? GENESIS_HASH : previous.hash,
  };
  const entry: AuditEntry = { ...base, hash: computeEntryHash(base) };
  // Validamos lo que producimos para no aceptar nunca una entrada que luego no verifique.
  return auditEntrySchema.parse(entry);
}

/** Motivo por el que una entrada no supera la verificación. */
export interface ChainIssue {
  seq: number | null;
  line: number;
  reason: string;
}

/** Resultado de verificar una cadena completa. */
export interface ChainVerification {
  ok: boolean;
  count: number;
  chainId: string | null;
  lastSeq: number | null;
  lastHash: string;
  /** Entradas que superaron la validación de formato, en orden. */
  entries: AuditEntry[];
  issues: ChainIssue[];
}

/** Elemento a verificar: valor ya interpretado, su línea de origen y, si existe, el texto original. */
export interface ChainItem {
  line: number;
  value: unknown;
  /** Texto exacto de la línea; si se entrega, debe ser idéntico a la forma canónica. */
  raw?: string;
}

/** Serializa una entrada en su forma canónica (formato de exportación JSONL). */
export function serializeEntry(entry: AuditEntry): string {
  return canonicalJson(entry);
}

/**
 * Verifica la integridad interna de una cadena: forma canónica exacta de cada línea,
 * secuencia continua desde 0, enlace `prevHash`, hash recalculado, un único `chainId`
 * y marcas de tiempo no decrecientes.
 *
 * Exigir la forma canónica byte a byte impide que dos programas lean contenidos
 * distintos del mismo archivo (claves duplicadas, escapes o números escritos de otra
 * forma, `__proto__`): lo que una persona ve con un editor es exactamente lo encadenado
 * (hallazgos QA H-01 y H-03).
 *
 * Limitaciones (riesgo R-26): no detecta una reescritura completa y coherente de la
 * cadena ni el truncamiento posterior al último anclaje; para eso se contrasta con los
 * anclajes externos (ver `anchor.ts`).
 *
 * @param items entradas en el orden del archivo exportado.
 * @param expectedChainId si se indica, toda entrada debe pertenecer a esa cadena.
 */
export function verifyChainItems(items: readonly ChainItem[], expectedChainId?: string): ChainVerification {
  const issues: ChainIssue[] = [];
  const entries: AuditEntry[] = [];
  let previous: AuditEntry | null = null;
  let chainId = expectedChainId;

  for (const { line, value, raw } of items) {
    if (hasForbiddenKey(value)) {
      issues.push({ seq: null, line, reason: 'Clave prohibida (__proto__, constructor o prototype)' });
      continue;
    }
    const parsed = auditEntrySchema.safeParse(value);
    if (!parsed.success) {
      issues.push({ seq: null, line, reason: `Formato inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}` });
      continue;
    }
    const entry = parsed.data;
    if (raw !== undefined && serializeEntry(entry) !== raw) {
      issues.push({ seq: entry.seq, line, reason: 'La línea no está en forma canónica (posible contenido oculto o ambiguo)' });
    }
    chainId ??= entry.chainId;

    if (entry.chainId !== chainId) {
      issues.push({ seq: entry.seq, line, reason: `chainId inesperado: "${entry.chainId}" (se esperaba "${chainId}")` });
    }
    const expectedSeq = previous === null ? 0 : previous.seq + 1;
    if (entry.seq !== expectedSeq) {
      issues.push({ seq: entry.seq, line, reason: `Secuencia rota: se esperaba ${expectedSeq}` });
    }
    const expectedPrev = previous === null ? GENESIS_HASH : previous.hash;
    if (entry.prevHash !== expectedPrev) {
      issues.push({ seq: entry.seq, line, reason: 'prevHash no coincide con el hash de la entrada anterior' });
    }
    if (previous !== null && entry.timestamp < previous.timestamp) {
      // Comparación de texto válida porque todos los timestamps son ISO 8601 en UTC con "Z".
      issues.push({ seq: entry.seq, line, reason: 'Marca de tiempo anterior a la de la entrada previa' });
    }
    const { hash, ...rest } = entry;
    if (computeEntryHash(rest) !== hash) {
      issues.push({ seq: entry.seq, line, reason: 'El hash no coincide con el contenido (entrada alterada)' });
    }
    entries.push(entry);
    previous = entry;
  }

  return {
    ok: issues.length === 0,
    count: items.length,
    chainId: chainId ?? null,
    lastSeq: previous === null ? null : previous.seq,
    lastHash: previous === null ? GENESIS_HASH : previous.hash,
    entries,
    issues,
  };
}

/**
 * Verifica una lista de entradas ya interpretadas (uso programático).
 * No comprueba la forma canónica porque no dispone del texto original;
 * para archivos exportados use `verifyChainItems` con `parseJsonlLines` (como la CLI).
 */
export function verifyChain(entries: readonly unknown[], expectedChainId?: string): ChainVerification {
  return verifyChainItems(
    entries.map((value, index) => ({ line: index + 1, value })),
    expectedChainId,
  );
}
