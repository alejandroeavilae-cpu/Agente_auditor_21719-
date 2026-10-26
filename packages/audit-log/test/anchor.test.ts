// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAnchor, createEntry, verifyAgainstAnchors, verifyAnchorSignature, type AuditEntry } from '../src/index.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const keys = new Map([['clave-instalacion-1', publicKey]]);

function buildChain(n: number, actor = 'usuario-sintetico'): AuditEntry[] {
  const entries: AuditEntry[] = [];
  for (let i = 0; i < n; i++) {
    entries.push(createEntry(entries.at(-1) ?? null, 'tenant-sintetico-a', { actor, action: 'scan.query.logged', object: `scan/${i}` }, new Date(Date.UTC(2026, 9, 25, 13, 0, i))));
  }
  return entries;
}

describe('anclaje externo', () => {
  it('firma y verifica un anclaje', () => {
    const chain = buildChain(3);
    const anchor = createAnchor(chain[2]!, privateKey, 'clave-instalacion-1');
    expect(verifyAnchorSignature(anchor, publicKey)).toBe(true);
    expect(verifyAgainstAnchors(chain, [anchor], keys)).toEqual([]);
  });

  it('PT-21: detecta una reescritura completa de la bitácora contrastando con el anclaje', () => {
    const original = buildChain(4);
    const anchor = createAnchor(original[3]!, privateKey, 'clave-instalacion-1');
    const rewritten = buildChain(4, 'atacante');
    const issues = verifyAgainstAnchors(rewritten, [anchor], keys);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toMatch(/reescrita/);
  });

  it('detecta truncamiento: anclaje posterior al final de la bitácora exportada', () => {
    const chain = buildChain(5);
    const anchor = createAnchor(chain[4]!, privateKey, 'clave-instalacion-1');
    const issues = verifyAgainstAnchors(chain.slice(0, 3), [anchor], keys);
    expect(issues[0]?.reason).toMatch(/truncamiento/);
  });

  it('rechaza un anclaje con firma alterada', () => {
    const chain = buildChain(2);
    const anchor = createAnchor(chain[1]!, privateKey, 'clave-instalacion-1');
    const forged = { ...anchor, hash: chain[0]!.hash };
    expect(verifyAgainstAnchors(chain, [forged], keys)[0]?.reason).toMatch(/Firma/);
  });

  it('rechaza un anclaje firmado con una clave desconocida', () => {
    const other = generateKeyPairSync('ed25519');
    const chain = buildChain(2);
    const anchor = createAnchor(chain[1]!, other.privateKey, 'clave-desconocida');
    expect(verifyAgainstAnchors(chain, [anchor], keys)[0]?.reason).toMatch(/Clave desconocida/);
  });

  it('rechaza claves que no son Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const chain = buildChain(1);
    expect(() => createAnchor(chain[0]!, rsa.privateKey, 'rsa')).toThrow(/Ed25519/);
  });
});
