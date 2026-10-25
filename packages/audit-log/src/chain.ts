// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson, type JsonValue } from './canonical-json.js';

/** Hash de 64 ceros que encabeza toda cadena (no existe entrada anterior). */
export const GENESIS_HASH = '0'.repeat(64);

const hexHash = z.string().regex(/^[0-9a-f]{64}$/, 'Debe ser un hash SHA-256 en hexadecimal minúsculo');

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    // En zod 4, z.number() ya rechaza NaN e Infinity.
    z.number(),
    z.string(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
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
    timestamp: z.iso.datetime({ offset: true }),
    actor: z.string().min(1).max(500),
    action: z.string().min(1).max(200),
    object: z.string().max(1000),
    data: z.record(z.string(), jsonValue),
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
  lastSeq: number | null;
  lastHash: string;
  issues: ChainIssue[];
}

/**
 * Verifica la integridad interna de una cadena: secuencia continua desde 0,
 * enlace `prevHash` correcto, hash recalculado y un único `chainId`.
 *
 * Limitación importante (riesgo R-26): esta verificación detecta alteraciones
 * parciales, pero NO detecta que alguien con control de la base de datos
 * reescriba la cadena completa de forma coherente. Para eso existe el anclaje
 * externo (ver `anchor.ts`).
 *
 * @param entries entradas en el orden en que fueron exportadas.
 * @param expectedChainId si se indica, toda entrada debe pertenecer a esa cadena.
 */
export function verifyChain(entries: readonly unknown[], expectedChainId?: string): ChainVerification {
  const issues: ChainIssue[] = [];
  let previous: AuditEntry | null = null;
  let chainId = expectedChainId;

  for (const [index, raw] of entries.entries()) {
    const line = index + 1;
    const parsed = auditEntrySchema.safeParse(raw);
    if (!parsed.success) {
      issues.push({ seq: null, line, reason: `Formato inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}` });
      continue;
    }
    const entry = parsed.data;
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
    const { hash, ...rest } = entry;
    if (computeEntryHash(rest) !== hash) {
      issues.push({ seq: entry.seq, line, reason: 'El hash no coincide con el contenido (entrada alterada)' });
    }
    previous = entry;
  }

  return {
    ok: issues.length === 0,
    count: entries.length,
    lastSeq: previous === null ? null : previous.seq,
    lastHash: previous === null ? GENESIS_HASH : previous.hash,
    issues,
  };
}
