// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  encodeKeyForFile,
  generateDbPassword,
  generateKey,
  loadMasterKey,
  open,
  seal,
  unwrapKey,
  wrapKey,
} from '../src/index.js';

describe('seal / open', () => {
  const key = generateKey();
  const secret = Buffer.from('contraseña-sintética-de-prueba');

  it('cifra y descifra con el mismo contexto', () => {
    const sealed = seal(key, secret, 'tenant:a:db-password');
    expect(open([key], sealed, 'tenant:a:db-password').equals(secret)).toBe(true);
  });

  it('el texto cifrado no contiene el secreto y cambia en cada cifrado (IV aleatorio)', () => {
    const a = seal(key, secret, 'ctx');
    const b = seal(key, secret, 'ctx');
    expect(a).not.toBe(b);
    expect(a).not.toContain('sintética');
  });

  it('rechaza el sobre si se usa con otro contexto (secreto copiado a otra organización)', () => {
    const sealed = seal(key, secret, 'tenant:a:db-password');
    expect(() => open([key], sealed, 'tenant:b:db-password')).toThrow(CryptoError);
  });

  it('rechaza contenido alterado', () => {
    const sealed = seal(key, secret, 'ctx');
    const parts = sealed.split('.');
    const ct = Buffer.from(parts[4]!, 'base64url');
    ct[0] = ct[0]! ^ 1;
    parts[4] = ct.toString('base64url');
    expect(() => open([key], parts.join('.'), 'ctx')).toThrow(CryptoError);
  });

  it('elige la clave por identificador (rotación) y falla si no está disponible', () => {
    const old = generateKey();
    const sealed = seal(old, secret, 'ctx');
    expect(open([key, old], sealed, 'ctx').equals(secret)).toBe(true);
    expect(() => open([key], sealed, 'ctx')).toThrow(/No está disponible la clave/);
  });

  it('exige contexto y formato válido', () => {
    expect(() => seal(key, secret, '')).toThrow(CryptoError);
    expect(() => open([key], 'v1.x.y', 'ctx')).toThrow(/Formato/);
  });
});

describe('DEK envueltas con la clave maestra', () => {
  it('envuelve y desenvuelve una DEK; otro contexto falla', () => {
    const master = generateKey();
    const dek = generateKey();
    const wrapped = wrapKey(master, dek, 'tenant:a');
    expect(unwrapKey([master], wrapped, 'tenant:a').id).toBe(dek.id);
    expect(() => unwrapKey([master], wrapped, 'tenant:b')).toThrow(CryptoError);
  });
});

describe('formato canónico (B-11)', () => {
  it('rechaza representaciones base64url no canónicas o con caracteres ajenos', () => {
    const key = generateKey();
    const sealed = seal(key, Buffer.from('secreto'), 'ctx');
    const parts = sealed.split('.');
    const variants = [
      [...parts.slice(0, 4), `${parts[4] ?? ''}=`].join('.'),
      [...parts.slice(0, 2), `${parts[2] ?? ''}+`, ...parts.slice(3)].join('.'),
      [...parts.slice(0, 3), ` ${parts[3] ?? ''}`, parts[4]].join('.'),
    ];
    for (const v of variants) expect(() => open([key], v, 'ctx')).toThrow(CryptoError);
    expect(open([key], sealed, 'ctx').toString()).toBe('secreto');
  });
});

describe('loadMasterKey', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crypto-'));

  it('carga una clave válida con permisos 600', () => {
    const key = generateKey();
    const path = join(dir, 'ok.key');
    writeFileSync(path, encodeKeyForFile(key), { mode: 0o600 });
    expect(loadMasterKey(path).id).toBe(key.id);
  });

  it('rechaza archivos legibles por otros usuarios', () => {
    const path = join(dir, 'abierta.key');
    writeFileSync(path, encodeKeyForFile(generateKey()));
    chmodSync(path, 0o644);
    expect(() => loadMasterKey(path)).toThrow(/Permisos inseguros/);
    // Excepción explícita para contenedores (la protección está en el directorio del anfitrión).
    expect(loadMasterKey(path, { checkPermissions: false }).id).toHaveLength(16);
  });

  it('rechaza archivos legibles por el grupo y enlaces simbólicos (B-09)', () => {
    const grupo = join(dir, 'grupo.key');
    writeFileSync(grupo, encodeKeyForFile(generateKey()));
    chmodSync(grupo, 0o640);
    expect(() => loadMasterKey(grupo)).toThrow(/Permisos inseguros/);
    const real = join(dir, 'real.key');
    writeFileSync(real, encodeKeyForFile(generateKey()), { mode: 0o600 });
    const link = join(dir, 'enlace.key');
    symlinkSync(real, link);
    expect(() => loadMasterKey(link)).toThrow(/enlace simbólico/);
    // Un directorio no es una clave aunque tenga permisos 700.
    const sub = mkdtempSync(join(dir, 'dir-'));
    chmodSync(sub, 0o700);
    expect(() => loadMasterKey(sub)).toThrow(CryptoError);
  });

  // `mkfifo` no existe en Windows (hallazgo QA Y-03).
  it.skipIf(process.platform === 'win32')('rechaza una tubería con nombre (FIFO) sin quedar esperando un escritor', () => {
    const fifo = join(dir, 'tuberia.key');
    execFileSync('mkfifo', ['-m', '600', fifo]);
    expect(() => loadMasterKey(fifo)).toThrow(/archivo regular/);
    expect(() => loadMasterKey(fifo, { checkPermissions: false })).toThrow(/archivo regular/);
  });

  it('rechaza formato inválido y archivo inexistente', () => {
    const path = join(dir, 'mala.key');
    writeFileSync(path, 'no-es-una-clave', { mode: 0o600 });
    expect(() => loadMasterKey(path)).toThrow(/32 bytes/);
    expect(() => loadMasterKey(join(dir, 'no-existe.key'))).toThrow(/No se pudo leer/);
  });
});

describe('generateDbPassword', () => {
  it('cumple las cuatro categorías de complejidad, sin caracteres que requieran escape', () => {
    for (let i = 0; i < 200; i++) {
      const p = generateDbPassword();
      expect(p).toHaveLength(40);
      expect(p).toMatch(/^[A-Za-z][A-Za-z0-9_-]+$/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[-_]/);
    }
  });
  it('no repite contraseñas', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateDbPassword()));
    expect(set.size).toBe(500);
  });
});
