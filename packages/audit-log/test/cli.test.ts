// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli.js';
import { createEntry, toJsonl, type AuditEntry } from '../src/index.js';

let dir: string;

function writeChain(file: string, actor = 'usuario-sintetico'): AuditEntry[] {
  const entries: AuditEntry[] = [];
  for (let i = 0; i < 3; i++) {
    entries.push(createEntry(entries.at(-1) ?? null, 'tenant-sintetico-a', { actor, action: 'test', object: `o/${i}` }, new Date(Date.UTC(2026, 9, 25, 14, 0, i))));
  }
  writeFileSync(file, toJsonl(entries));
  return entries;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'auditor-log-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('CLI auditor-log', () => {
  it('flujo completo: keygen → anchor → verify íntegra (código 0)', () => {
    const entries = join(dir, 'bitacora.jsonl');
    const anchors = join(dir, 'anclajes.jsonl');
    writeChain(entries);
    expect(main(['keygen', '--out-dir', dir, '--key-id', 'k1'])).toBe(0);
    expect(main(['anchor', '--entries', entries, '--private-key', join(dir, 'k1.private.pem'), '--key-id', 'k1', '--out', anchors])).toBe(0);
    expect(main(['verify', '--entries', entries, '--anchors', anchors, '--public-key', `k1=${join(dir, 'k1.public.pem')}`])).toBe(0);
  });

  it('PT-21 vía CLI: bitácora reescrita contra anclajes conservados → código 1', () => {
    const entries = join(dir, 'bitacora.jsonl');
    const anchors = join(dir, 'anclajes.jsonl');
    writeChain(entries);
    main(['keygen', '--out-dir', dir, '--key-id', 'k1']);
    main(['anchor', '--entries', entries, '--private-key', join(dir, 'k1.private.pem'), '--key-id', 'k1', '--out', anchors]);
    writeChain(entries, 'atacante');
    expect(main(['verify', '--entries', entries, '--anchors', anchors, '--public-key', `k1=${join(dir, 'k1.public.pem')}`])).toBe(1);
  });

  it('PT-04 vía CLI: línea alterada → código 1', () => {
    const entries = join(dir, 'bitacora.jsonl');
    writeChain(entries);
    const lines = readFileSync(entries, 'utf8').trim().split('\n');
    lines[1] = lines[1]!.replace('"action":"test"', '"action":"otra"');
    writeFileSync(entries, lines.join('\n') + '\n');
    expect(main(['verify', '--entries', entries])).toBe(1);
  });

  it('no sobrescribe claves existentes (código 2)', () => {
    expect(main(['keygen', '--out-dir', dir, '--key-id', 'k1'])).toBe(0);
    expect(main(['keygen', '--out-dir', dir, '--key-id', 'k1'])).toBe(2);
  });

  it('no ancla una cadena rota (código 1)', () => {
    const entries = join(dir, 'bitacora.jsonl');
    writeChain(entries);
    const lines = readFileSync(entries, 'utf8').trim().split('\n');
    writeFileSync(entries, [lines[0], lines[2]].join('\n') + '\n');
    main(['keygen', '--out-dir', dir, '--key-id', 'k1']);
    expect(main(['anchor', '--entries', entries, '--private-key', join(dir, 'k1.private.pem'), '--key-id', 'k1', '--out', join(dir, 'a.jsonl')])).toBe(1);
  });

  it('errores de uso devuelven código 2', () => {
    expect(main(['verify'])).toBe(2);
    expect(main(['verify', '--entries', join(dir, 'no-existe.jsonl')])).toBe(2);
    expect(main(['comando-inexistente'])).toBe(2);
  });
});
