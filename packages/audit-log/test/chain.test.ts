// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { canonicalJson, createEntry, GENESIS_HASH, verifyChain, type AuditEntry } from '../src/index.js';

/** Construye una cadena sintética reproducible de `n` entradas. */
function buildChain(n: number, chainId = 'tenant-sintetico-a'): AuditEntry[] {
  const entries: AuditEntry[] = [];
  for (let i = 0; i < n; i++) {
    entries.push(
      createEntry(entries.at(-1) ?? null, chainId, {
        actor: `usuario-sintetico-${i % 3}`,
        action: 'audit.authorization.created',
        object: `authorization/${i}`,
        data: { scope: ['sistema-ficticio'], n: i },
      }, new Date(Date.UTC(2026, 9, 25, 12, 0, i))),
    );
  }
  return entries;
}

describe('canonicalJson', () => {
  it('ordena claves y produce la misma salida sin importar el orden de inserción', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 'x'], c: null } })).toBe('{"a":{"c":null,"d":[1,"x"]},"b":1}');
    expect(canonicalJson({ a: { c: null, d: [1, 'x'] }, b: 1 })).toBe(canonicalJson({ b: 1, a: { d: [1, 'x'], c: null } }));
  });

  it('rechaza números no finitos', () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow(TypeError);
  });
});

describe('createEntry / verifyChain', () => {
  it('la primera entrada parte del hash génesis y la cadena íntegra verifica', () => {
    const chain = buildChain(5);
    expect(chain[0]?.prevHash).toBe(GENESIS_HASH);
    const result = verifyChain(chain, 'tenant-sintetico-a');
    expect(result).toMatchObject({ ok: true, count: 5, lastSeq: 4, issues: [] });
    expect(result.lastHash).toBe(chain[4]?.hash);
  });

  it('PT-04: detecta la alteración de un campo de una entrada intermedia', () => {
    const chain = buildChain(5);
    const tampered = chain.map((e) => ({ ...e }));
    tampered[2] = { ...tampered[2]!, actor: 'atacante' };
    const result = verifyChain(tampered);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.seq === 2 && i.reason.includes('alterada'))).toBe(true);
  });

  it('PT-04: detecta la eliminación de una entrada intermedia', () => {
    const chain = buildChain(5);
    const result = verifyChain([chain[0], chain[1], chain[3], chain[4]]);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.reason.includes('Secuencia rota'))).toBe(true);
  });

  it('detecta una entrada copiada desde la cadena de otro tenant', () => {
    const a = buildChain(3, 'tenant-sintetico-a');
    const b = buildChain(3, 'tenant-sintetico-b');
    const result = verifyChain([a[0], a[1], b[2]], 'tenant-sintetico-a');
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.reason.includes('chainId'))).toBe(true);
  });

  it('rechaza encadenar sobre una entrada de otra cadena', () => {
    const a = buildChain(1, 'tenant-sintetico-a');
    expect(() => createEntry(a[0]!, 'tenant-sintetico-b', { actor: 'x', action: 'y', object: 'z' })).toThrow();
  });

  it('reporta formato inválido sin lanzar excepción', () => {
    const result = verifyChain([{ seq: 0 }]);
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.reason).toMatch(/Formato inválido/);
  });

  it('limitación documentada (R-26): una reescritura completa y coherente pasa la verificación interna', () => {
    const original = buildChain(4);
    // El atacante reconstruye toda la cadena desde cero con contenido distinto.
    const rewritten: AuditEntry[] = [];
    for (const e of original) {
      rewritten.push(createEntry(rewritten.at(-1) ?? null, e.chainId, { actor: 'atacante', action: e.action, object: e.object, data: e.data }, new Date(e.timestamp)));
    }
    expect(verifyChain(rewritten).ok).toBe(true);
  });
});
