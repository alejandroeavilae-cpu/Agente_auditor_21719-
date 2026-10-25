// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from './canonical-json.js';
import type { AuditEntry, ChainIssue, ChainItem } from './chain.js';

/**
 * Anclaje externo de la bitácora (decisión D-31, riesgo R-26).
 *
 * Un anclaje es una declaración firmada de "en el instante T, la entrada `seq`
 * de la cadena `chainId` tenía el hash H". La organización guarda los anclajes
 * FUERA de la base de datos de la plataforma (archivo descargado, medio de solo
 * escritura u otro sistema). Si alguien reescribe la cadena completa en la base,
 * los hashes ya no coincidirán con los anclajes que la organización conserva.
 *
 * Se usa Ed25519 porque está disponible en Node.js sin dependencias externas y
 * produce firmas deterministas y cortas.
 */
export const anchorSchema = z
  .object({
    version: z.literal(1),
    chainId: z.string().min(1).max(200),
    seq: z.number().int().nonnegative(),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    anchoredAt: z.iso.datetime(),
    keyId: z.string().min(1).max(200),
    algorithm: z.literal('Ed25519'),
    // Firma Ed25519 = 64 bytes = exactamente 88 caracteres base64 con relleno. Se valida
    // estrictamente porque el decodificador de Node ignora caracteres inválidos y la firma
    // sería maleable (hallazgo QA H-14).
    signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/, 'Firma Ed25519 en base64 inválida'),
  })
  .strict();

export type Anchor = z.infer<typeof anchorSchema>;

/** Bytes exactos que se firman: todo el anclaje salvo la propia firma. */
function signedPayload(anchor: Omit<Anchor, 'signature'>): Buffer {
  return Buffer.from(
    canonicalJson({
      version: anchor.version,
      chainId: anchor.chainId,
      seq: anchor.seq,
      hash: anchor.hash,
      anchoredAt: anchor.anchoredAt,
      keyId: anchor.keyId,
      algorithm: anchor.algorithm,
    }),
    'utf8',
  );
}

/**
 * Firma un anclaje sobre la entrada indicada (normalmente la última de la cadena).
 *
 * @param entry entrada a anclar.
 * @param privateKey clave privada Ed25519 de la instalación.
 * @param keyId identificador público de la clave, para rotaciones.
 * @param now instante del anclaje.
 */
export function createAnchor(entry: AuditEntry, privateKey: KeyObject, keyId: string, now: Date = new Date()): Anchor {
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('El anclaje requiere una clave Ed25519.');
  }
  const unsigned: Omit<Anchor, 'signature'> = {
    version: 1,
    chainId: entry.chainId,
    seq: entry.seq,
    hash: entry.hash,
    anchoredAt: now.toISOString(),
    keyId,
    algorithm: 'Ed25519',
  };
  // Ed25519 no usa función de hash externa: Node exige `null` como algoritmo.
  const signature = sign(null, signedPayload(unsigned), privateKey).toString('base64');
  return anchorSchema.parse({ ...unsigned, signature });
}

/** Comprueba solo la firma de un anclaje. */
export function verifyAnchorSignature(anchor: Anchor, publicKey: KeyObject): boolean {
  const { signature, ...rest } = anchor;
  return verify(null, signedPayload(rest), publicKey, Buffer.from(signature, 'base64'));
}

/**
 * Contrasta una cadena exportada con los anclajes que la organización conservó.
 *
 * Detecta: anclajes no canónicos o mal formados, firmas inválidas, claves desconocidas,
 * anclajes de otra cadena, entradas ancladas cuyo hash cambió (reescritura) y anclajes
 * posteriores al final de la exportación (truncamiento).
 *
 * Limitación (riesgo R-26): no detecta la eliminación de entradas posteriores al último
 * anclaje; por eso conviene anclar con frecuencia y conservar el último anclaje fuera.
 *
 * @param entries cadena ya verificada internamente.
 * @param anchors anclajes en cualquier orden, con línea y texto original si se leyeron de archivo.
 * @param publicKeys claves públicas aceptadas, indexadas por `keyId`.
 */
export function verifyAnchorItems(
  entries: readonly AuditEntry[],
  anchors: readonly ChainItem[],
  publicKeys: ReadonlyMap<string, KeyObject>,
): ChainIssue[] {
  const issues: ChainIssue[] = [];
  const bySeq = new Map<number, AuditEntry>(entries.map((e) => [e.seq, e]));
  const chainId = entries[0]?.chainId;
  const lastSeq = entries.at(-1)?.seq ?? -1;

  for (const { line, value, raw } of anchors) {
    const parsed = anchorSchema.safeParse(value);
    if (!parsed.success) {
      issues.push({ seq: null, line, reason: 'Anclaje con formato inválido' });
      continue;
    }
    const anchor = parsed.data;
    if (raw !== undefined && canonicalJson(anchor) !== raw) {
      issues.push({ seq: anchor.seq, line, reason: 'Anclaje no está en forma canónica' });
      continue;
    }
    const key = publicKeys.get(anchor.keyId);
    if (key === undefined) {
      issues.push({ seq: anchor.seq, line, reason: `Clave desconocida para el anclaje: "${anchor.keyId}"` });
      continue;
    }
    if (!verifyAnchorSignature(anchor, key)) {
      issues.push({ seq: anchor.seq, line, reason: 'Firma del anclaje inválida' });
      continue;
    }
    if (chainId !== undefined && anchor.chainId !== chainId) {
      issues.push({ seq: anchor.seq, line, reason: 'El anclaje pertenece a otra cadena' });
      continue;
    }
    if (anchor.seq > lastSeq) {
      issues.push({ seq: anchor.seq, line, reason: 'Existe un anclaje posterior al final de la bitácora: posible truncamiento' });
      continue;
    }
    const entry = bySeq.get(anchor.seq);
    if (entry === undefined || entry.hash !== anchor.hash) {
      issues.push({ seq: anchor.seq, line, reason: 'El hash anclado no coincide: la bitácora fue reescrita' });
    }
  }
  return issues;
}

/** Variante programática: los anclajes se numeran por posición y no se exige forma canónica. */
export function verifyAgainstAnchors(
  entries: readonly AuditEntry[],
  anchors: readonly unknown[],
  publicKeys: ReadonlyMap<string, KeyObject>,
): ChainIssue[] {
  return verifyAnchorItems(entries, anchors.map((value, index) => ({ line: index + 1, value })), publicKeys);
}

/** Carga una clave pública PEM (SPKI) para verificación. */
export function loadPublicKey(pem: string): KeyObject {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Se esperaba una clave pública Ed25519.');
  }
  return key;
}
