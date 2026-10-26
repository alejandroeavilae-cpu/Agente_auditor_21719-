// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { formatVersion, parseAbout } from '../src/about.js';

const valid = {
  name: 'Auditor 21719',
  version: '0.1.0',
  commit: 'abc1234def',
  license: 'AGPL-3.0-or-later',
  sourceUrl: 'https://example.invalid/repo',
  sourceForThisVersionUrl: 'https://example.invalid/repo/tree/abc1234def',
};

describe('parseAbout', () => {
  it('acepta una respuesta válida', () => {
    expect(parseAbout(valid)).toEqual(valid);
  });
  it('rechaza enlaces que no son https (p. ej. javascript:)', () => {
    expect(parseAbout({ ...valid, sourceForThisVersionUrl: 'javascript:alert(1)' })).toBeNull();
  });
  it('rechaza formas inesperadas', () => {
    expect(parseAbout(null)).toBeNull();
    expect(parseAbout({ ...valid, version: 1 })).toBeNull();
  });
});

describe('formatVersion', () => {
  it('abrevia el commit a 7 caracteres', () => {
    expect(formatVersion(valid)).toBe('0.1.0 (abc1234)');
  });
});
