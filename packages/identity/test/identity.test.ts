// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import {
  checkPasswordPolicy,
  hashPassword,
  hashToken,
  MFA_REQUIRED_ROLES,
  newRecoveryCodes,
  newToken,
  normalizeRecoveryCode,
  otpauthUri,
  permissionsOf,
  requiresMfa,
  ROLE_PERMISSIONS,
  ROLES,
  TOKEN_FORMAT,
  totpAt,
  totpStep,
  validateRoleSet,
  verifyPassword,
  verifyTotp,
  base32Encode,
} from '../src/index.js';

describe('contraseñas argon2id', () => {
  it('produce un hash PHC con los parámetros de OWASP y lo verifica', async () => {
    const hash = await hashPassword('caballo-correcto-bateria-grapa');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(await verifyPassword('caballo-correcto-bateria-grapa', hash)).toEqual({ ok: true, needsRehash: false });
    expect((await verifyPassword('caballo-correcto-bateria-grapX', hash)).ok).toBe(false);
  });

  it('usa sal aleatoria: dos hashes de la misma contraseña difieren', async () => {
    expect(await hashPassword('misma-contraseña-larga')).not.toBe(await hashPassword('misma-contraseña-larga'));
  });

  it('normaliza Unicode (NFKC): é compuesta y descompuesta coinciden', async () => {
    const hash = await hashPassword('contraseña-éxito-2026');
    expect((await verifyPassword('contraseña-éxito-2026', hash)).ok).toBe(true);
  });

  it('detecta parámetros más débiles que los actuales (needsRehash)', async () => {
    const weak = await hashPassword('otra-contraseña-larga', { memory: 8192, passes: 1, parallelism: 1 });
    expect(await verifyPassword('otra-contraseña-larga', weak)).toEqual({ ok: true, needsRehash: true });
  });

  it('nunca lanza ni acepta con un hash dañado o con parámetros abusivos', async () => {
    const good = await hashPassword('contraseña-de-prueba-1');
    const bad = [
      '',
      'texto-cualquiera',
      good.replace('argon2id', 'argon2i'),
      good.replace('m=19456', 'm=99999999'),
      good.replace('t=2', 't=0'),
      good.slice(0, -1),
    ];
    for (const stored of bad) expect((await verifyPassword('contraseña-de-prueba-1', stored)).ok).toBe(false);
  });

  it('política: 12 a 128 caracteres, sin contraseñas comunes ni el correo', () => {
    expect(checkPasswordPolicy('corta-11ch')).toContain('too_short');
    expect(checkPasswordPolicy('x'.repeat(129))).toContain('too_long');
    expect(checkPasswordPolicy('1qaz2wsx3edc')).toContain('common');
    expect(checkPasswordPolicy('1QAZ2WSX3EDC')).toContain('common');
    expect(checkPasswordPolicy('maria.perez-2026!', { email: 'maria.perez@ejemplo.cl' })).toContain('contains_email');
    expect(checkPasswordPolicy('tres palabras sin relación')).toEqual([]);
    // Se cuentan caracteres Unicode, no bytes.
    expect(checkPasswordPolicy('ñññññññññññ')).toContain('too_short');
    expect(checkPasswordPolicy('ñandú-pingüino-árbol')).toEqual([]);
  });
});

describe('TOTP (RFC 6238)', () => {
  // Vectores del Apéndice B de RFC 6238 (8 dígitos). Semillas según la errata 2866
  // [VERIFICADO: rfc-editor.org/errata/rfc6238]; valores esperados [FUENTE SECUNDARIA:
  // reproducidos por otplib, "RFC Implementations"].
  const seeds = {
    sha1: Buffer.from('12345678901234567890'),
    sha256: Buffer.from('12345678901234567890123456789012'),
    sha512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
  } as const;
  const vectors: [number, string, string, string][] = [
    [59, '94287082', '46119246', '90693936'],
    [1111111109, '07081804', '68084774', '25091201'],
  ];
  it.each(vectors)('t=%i coincide en SHA1/SHA256/SHA512', (t, sha1, sha256, sha512) => {
    expect(totpAt(seeds.sha1, t, { digits: 8, algorithm: 'sha1' })).toBe(sha1);
    expect(totpAt(seeds.sha256, t, { digits: 8, algorithm: 'sha256' })).toBe(sha256);
    expect(totpAt(seeds.sha512, t, { digits: 8, algorithm: 'sha512' })).toBe(sha512);
  });
  it.each([
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('SHA1 t=%i → %s', (t, expected) => {
    expect(totpAt(seeds.sha1, t, { digits: 8 })).toBe(expected);
  });

  it('acepta ±1 paso, rechaza fuera de ventana, formato inválido y reuso', () => {
    const key = seeds.sha1;
    const now = 1_800_000_000;
    const step = totpStep(now);
    const code = totpAt(key, now);
    expect(verifyTotp(key, code, now, null)).toBe(step);
    expect(verifyTotp(key, totpAt(key, now - 30), now, null)).toBe(step - 1);
    expect(verifyTotp(key, totpAt(key, now + 30), now, null)).toBe(step + 1);
    expect(verifyTotp(key, totpAt(key, now - 90), now, null)).toBeNull();
    expect(verifyTotp(key, '12345', now, null)).toBeNull();
    expect(verifyTotp(key, 'abcdef', now, null)).toBeNull();
    // Reuso: el mismo paso (o anterior) ya aceptado se rechaza.
    expect(verifyTotp(key, code, now, step)).toBeNull();
    expect(verifyTotp(key, totpAt(key, now - 30), now, step)).toBeNull();
  });

  it('base32 (RFC 4648) y URI otpauth', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    const uri = otpauthUri(seeds.sha1, 'Auditor 21719', 'ana@ejemplo.cl');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Auditor%2021719:ana%40ejemplo\.cl\?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&/);
    expect(uri).toContain('digits=6');
  });
});

describe('tokens', () => {
  it('tokens aleatorios de 256 bits y hash SHA-256', () => {
    const t = newToken();
    expect(t).toMatch(TOKEN_FORMAT);
    expect(newToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });
  it('códigos de recuperación: 10, distintos, normalizables', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(normalizeRecoveryCode(' AB3K-9MZQ ')).toBe('ab3k9mzq');
  });
});

describe('roles y permisos', () => {
  it('matriz: solo el administrador gestiona usuarios; nadie más tiene users.*', () => {
    for (const role of ROLES) {
      const p = ROLE_PERMISSIONS[role];
      expect(p.includes('users.manage')).toBe(role === 'org_admin');
      expect(p.includes('users.read')).toBe(role === 'org_admin');
    }
    // Solo el revisor jurídico decide en obligaciones legales (D-06).
    for (const role of ROLES) expect(ROLE_PERMISSIONS[role].includes('controls.legal_decision')).toBe(role === 'legal_reviewer');
    // El administrador no audita (separación de funciones).
    expect(permissionsOf(['org_admin']).has('audits.run')).toBe(false);
  });
  it('MFA obligatoria para los 6 roles (D-86)', () => {
    expect(MFA_REQUIRED_ROLES.size).toBe(ROLES.length);
    for (const role of ROLES) expect(MFA_REQUIRED_ROLES.has(role), role).toBe(true);
    // QA 2C1-06: la MFA se exige siempre, sin depender de los roles (incluso sin roles).
    expect(requiresMfa()).toBe(true);
  });
  it('combinaciones prohibidas y roles inválidos', () => {
    expect(validateRoleSet(['org_admin', 'legal_reviewer']).join(' ')).toMatch(/Separación de funciones/);
    expect(validateRoleSet(['org_admin', 'auditor'])).toHaveLength(1);
    expect(validateRoleSet([])).toHaveLength(1);
    expect(validateRoleSet(['superusuario'])).toHaveLength(1);
    expect(validateRoleSet(['reader', 'reader'])).toHaveLength(1);
    expect(validateRoleSet(['auditor', 'remediation_owner'])).toEqual([]);
  });
});
