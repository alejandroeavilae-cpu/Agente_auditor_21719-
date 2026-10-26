// SPDX-License-Identifier: AGPL-3.0-or-later
// Regresiones de los hallazgos de la revisión QA independiente de la Fase 1 (H-01 a H-15).
// Cada prueba reproduce un ataque que antes pasaba la verificación indebidamente.

import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import {
  createAnchor,
  createEntry,
  parseJsonlLines,
  toJsonl,
  verifyAnchorItems,
  verifyChainItems,
  type AuditEntry,
} from '../src/index.js';

const CHAIN = 'tenant-sintetico-a';

function chain(n: number, chainId = CHAIN): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (let i = 0; i < n; i++) {
    out.push(createEntry(out.at(-1) ?? null, chainId, { actor: 'u', action: 'a', object: `o/${i}`, data: { n: i } }, new Date(Date.UTC(2026, 9, 25, 15, 0, i))));
  }
  return out;
}

/** Verifica un texto JSONL completo como lo hace la CLI. */
function verifyText(text: string, chainId = CHAIN) {
  return verifyChainItems(parseJsonlLines(text), chainId);
}

/** Reemplaza el texto de la línea `index` (base 0) de un JSONL. */
function editLine(text: string, index: number, edit: (line: string) => string): string {
  const lines = text.split('\n');
  lines[index] = edit(lines[index]!);
  return lines.join('\n');
}

describe('H-01: contenido oculto con __proto__', () => {
  it('rechaza __proto__ inyectado en data aunque el resto de la línea no cambie', () => {
    const text = toJsonl(chain(3));
    const tampered = editLine(text, 1, (l) => l.replace('"data":{', '"data":{"__proto__":{"accion_real":"borrado_masivo"},'));
    expect(verifyText(tampered).ok).toBe(false);
  });
  it('createEntry no acepta claves prohibidas', () => {
    const data = JSON.parse('{"constructor":1}') as Record<string, number>;
    expect(() => createEntry(null, CHAIN, { actor: 'u', action: 'a', object: 'o', data })).toThrow();
  });
});

describe('H-03: codificaciones no canónicas', () => {
  const text = toJsonl(chain(3));
  it.each([
    ['clave duplicada', (l: string) => l.replace('"actor":"u"', '"actor":"atacante","actor":"u"')],
    ['número escrito como 1e0', (l: string) => l.replace('"n":1', '"n":1e0')],
    ['escape unicode equivalente', (l: string) => l.replace('"actor":"u"', '"actor":"\\u0075"')],
    ['espacios', (l: string) => l.replace('"actor":"u"', '"actor": "u"')],
  ])('rechaza %s', (_name, edit) => {
    expect(verifyText(editLine(text, 1, edit)).ok).toBe(false);
  });
});

describe('estructura de la cadena', () => {
  it('rechaza entradas reordenadas y duplicadas', () => {
    const [a, b, c] = chain(3).map((e) => toJsonl([e]));
    expect(verifyText(`${a}${c}${b}`).ok).toBe(false);
    expect(verifyText(`${a}${b}${b}${c}`).ok).toBe(false);
  });
  it('H-05: rechaza la cadena completa de otro tenant cuando se indica el chainId', () => {
    expect(verifyText(toJsonl(chain(3, 'tenant-sintetico-b')), CHAIN).ok).toBe(false);
  });
  it('H-13: rechaza timestamps con offset distinto de Z', () => {
    const text = toJsonl(chain(2));
    const tampered = editLine(text, 0, (l) => l.replace(/"timestamp":"([^"]+)Z"/, '"timestamp":"$1+00:00"'));
    expect(verifyText(tampered).ok).toBe(false);
  });
  it('H-13: rechaza timestamps decrecientes aunque los hashes sean coherentes', () => {
    const e0 = createEntry(null, CHAIN, { actor: 'u', action: 'a', object: 'o' }, new Date(Date.UTC(2026, 9, 25, 16)));
    const e1 = createEntry(e0, CHAIN, { actor: 'u', action: 'a', object: 'o' }, new Date(Date.UTC(2026, 9, 25, 15)));
    const result = verifyText(toJsonl([e0, e1]));
    expect(result.issues.some((i) => i.reason.includes('Marca de tiempo'))).toBe(true);
  });
  it('H-15: informa el número de línea real del archivo', () => {
    const [a, b] = chain(2).map((e) => toJsonl([e]));
    const result = verifyText(`${a}\n${b!.replace('"actor":"u"', '"actor":"x"')}`);
    expect(result.issues[0]?.line).toBe(3);
  });
});

describe('re-revisión QA (N-01, N-04, N-05)', () => {
  it('N-01: rechaza timestamps sin exactamente 3 decimales', () => {
    const text = toJsonl(chain(2));
    expect(verifyText(editLine(text, 1, (l) => l.replace(/\.(\d{3})Z"/, 'Z"'))).ok).toBe(false);
    expect(verifyText(editLine(text, 1, (l) => l.replace(/\.(\d{3})Z"/, '.$10Z"'))).ok).toBe(false);
  });
  it('N-04: verifyChain (API) rechaza __proto__ propio aunque zod lo descarte', () => {
    const entries = chain(2);
    const raw = JSON.parse(JSON.stringify(entries[1]).replace('"data":{', '"data":{"__proto__":{"x":1},')) as unknown;
    expect(verifyChainItems([{ line: 1, value: entries[0] }, { line: 2, value: raw }], CHAIN).ok).toBe(false);
  });
  it('N-04: createEntry rechaza __proto__ propio en data', () => {
    const data = JSON.parse('{"__proto__":{"x":1}}') as Record<string, number>;
    expect(() => createEntry(null, CHAIN, { actor: 'u', action: 'a', object: 'o', data })).toThrow(/prohibida/);
  });
  it('N-05: rechaza firmas con bits de relleno alterados', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const entries = chain(1);
    const anchor = createAnchor(entries[0]!, privateKey, 'k1');
    const last = anchor.signature[85]!;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const flipped = alphabet[alphabet.indexOf(last) + 1]!;
    const forged = { ...anchor, signature: anchor.signature.slice(0, 85) + flipped + '==' };
    expect(verifyAnchorItems(entries, [{ line: 1, value: forged }], new Map([['k1', publicKey]]))).toHaveLength(1);
  });
});

describe('H-14: firma de anclaje maleable', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  it.each(['!!!', 'AAAA', ' '])('rechaza la firma con agregado %j', (suffix) => {
    const entries = chain(2);
    const anchor = createAnchor(entries[1]!, privateKey, 'k1');
    const forged = { ...anchor, signature: anchor.signature + suffix };
    const issues = verifyAnchorItems(entries, [{ line: 1, value: forged }], new Map([['k1', publicKey]]));
    expect(issues).toHaveLength(1);
  });
});

describe('CLI: casos que antes informaban "íntegra"', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-regresion-'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('H-04: bitácora vacía → código 1', () => {
    writeFileSync(join(dir, 'b.jsonl'), '');
    expect(main(['verify', '--entries', join(dir, 'b.jsonl'), '--chain-id', CHAIN])).toBe(1);
  });

  it('H-04: archivo de anclajes vacío → código 1', () => {
    writeFileSync(join(dir, 'b.jsonl'), toJsonl(chain(2)));
    writeFileSync(join(dir, 'a.jsonl'), '');
    main(['keygen', '--out-dir', dir, '--key-id', 'k1']);
    expect(main(['verify', '--entries', join(dir, 'b.jsonl'), '--chain-id', CHAIN, '--anchors', join(dir, 'a.jsonl'), '--public-key', `k1=${join(dir, 'k1.public.pem')}`])).toBe(1);
  });

  it('H-01 de extremo a extremo: __proto__ inyectado en bitácora anclada → código 1', () => {
    const b = join(dir, 'b.jsonl');
    writeFileSync(b, toJsonl(chain(3)));
    main(['keygen', '--out-dir', dir, '--key-id', 'k1']);
    main(['anchor', '--entries', b, '--chain-id', CHAIN, '--private-key', join(dir, 'k1.private.pem'), '--key-id', 'k1', '--out', join(dir, 'a.jsonl')]);
    writeFileSync(b, editLine(readFileSync(b, 'utf8'), 1, (l) => l.replace('"data":{', '"data":{"__proto__":{"x":"y"},')));
    expect(main(['verify', '--entries', b, '--chain-id', CHAIN, '--anchors', join(dir, 'a.jsonl'), '--public-key', `k1=${join(dir, 'k1.public.pem')}`])).toBe(1);
  });

  it('H-06: rechaza key-id con recorrido de rutas (código 2) y no escribe fuera', () => {
    const keys = join(dir, 'keys');
    mkdirSync(keys);
    expect(main(['keygen', '--out-dir', keys, '--key-id', '../../traversal'])).toBe(2);
    expect(existsSync(join(dir, 'traversal.private.pem'))).toBe(false);
  });

  it('H-06: no escribe anclajes a través de un enlace simbólico (código 2)', () => {
    const b = join(dir, 'b.jsonl');
    writeFileSync(b, toJsonl(chain(2)));
    main(['keygen', '--out-dir', dir, '--key-id', 'k1']);
    const target = join(dir, 'objetivo.txt');
    symlinkSync(target, join(dir, 'enlace.jsonl'));
    expect(main(['anchor', '--entries', b, '--chain-id', CHAIN, '--private-key', join(dir, 'k1.private.pem'), '--key-id', 'k1', '--out', join(dir, 'enlace.jsonl')])).toBe(2);
    expect(existsSync(target)).toBe(false);
  });
});
