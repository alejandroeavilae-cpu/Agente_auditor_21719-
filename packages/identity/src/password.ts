// SPDX-License-Identifier: AGPL-3.0-or-later

import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { dictionary } from '@zxcvbn-ts/language-common';

/**
 * Contraseñas de usuarios de la plataforma (decisiones D-18 y D-79).
 *
 * - Hash con **argon2id** usando la función incorporada de Node.js 24 (`crypto.argon2`,
 *   disponible desde v24.7.0): sin dependencias nativas adicionales.
 * - Parámetros por defecto = una de las configuraciones mínimas que recomienda OWASP para
 *   argon2id: m=19456 (19 MiB), t=2, p=1 [VERIFICADO: OWASP Password Storage Cheat Sheet,
 *   consultado el 29-10-2026]. Se guardan en el propio hash para poder subirlos después
 *   sin invalidar contraseñas existentes (`needsRehash`).
 * - Formato PHC: `$argon2id$v=19$m=19456,t=2,p=1$<sal>$<hash>` (base64 sin relleno).
 */

/** Parámetros de argon2id. `memory` en bloques de 1 KiB. */
export interface Argon2Params {
  memory: number;
  passes: number;
  parallelism: number;
}

export const DEFAULT_ARGON2_PARAMS: Readonly<Argon2Params> = Object.freeze({ memory: 19456, passes: 2, parallelism: 1 });

const SALT_BYTES = 16;
const TAG_BYTES = 32;
/** Límites de lectura: un hash manipulado no puede pedir memoria o tiempo excesivos. */
const MAX_MEMORY = 1024 * 1024; // 1 GiB
const MAX_PASSES = 20;
const MAX_PARALLELISM = 16;

/** Longitud mínima y máxima en caracteres Unicode (D-79). */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Normaliza a NFKC antes de medir y de calcular el hash: la misma contraseña escrita con
 * distintas formas Unicode (p. ej. "é" compuesta o descompuesta) debe coincidir.
 */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

function derive(password: string, salt: Buffer, params: Argon2Params): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      { message: Buffer.from(normalize(password), 'utf8'), nonce: salt, parallelism: params.parallelism, tagLength: TAG_BYTES, memory: params.memory, passes: params.passes },
      (error, derived) => {
        if (error !== null) reject(error);
        else resolve(derived);
      },
    );
  });
}

const b64 = (b: Buffer): string => b.toString('base64').replace(/=+$/, '');

/** Calcula el hash de una contraseña. No valida la política: use `checkPasswordPolicy`. */
export async function hashPassword(password: string, params: Argon2Params = DEFAULT_ARGON2_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, params);
  return `$argon2id$v=19$m=${String(params.memory)},t=${String(params.passes)},p=${String(params.parallelism)}$${b64(salt)}$${b64(tag)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d{1,7}),t=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/;

/** Resultado de verificar una contraseña. */
export interface VerifyResult {
  ok: boolean;
  /** El hash usa parámetros más débiles que los actuales: conviene recalcularlo. */
  needsRehash: boolean;
}

/**
 * Verifica una contraseña contra un hash guardado, en tiempo constante respecto del
 * contenido. Un hash con formato inválido o parámetros fuera de rango devuelve `ok: false`
 * (nunca lanza): un registro dañado no debe abrir la puerta.
 */
export async function verifyPassword(password: string, stored: string, current: Argon2Params = DEFAULT_ARGON2_PARAMS): Promise<VerifyResult> {
  const m = PHC.exec(stored);
  if (m === null) return { ok: false, needsRehash: false };
  const params: Argon2Params = { memory: Number(m[1]), passes: Number(m[2]), parallelism: Number(m[3]) };
  if (params.memory < 8 * params.parallelism || params.memory > MAX_MEMORY || params.passes < 1 || params.passes > MAX_PASSES || params.parallelism < 1 || params.parallelism > MAX_PARALLELISM) {
    return { ok: false, needsRehash: false };
  }
  const salt = Buffer.from(m[4] as string, 'base64');
  const expected = Buffer.from(m[5] as string, 'base64');
  const actual = await derive(password, salt, params);
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
  const needsRehash = params.memory < current.memory || params.passes < current.passes || params.parallelism < current.parallelism;
  return { ok, needsRehash: ok && needsRehash };
}

let dummyHash: Promise<string> | undefined;

/**
 * Hace el mismo trabajo que una verificación real contra un hash desechable. Se usa
 * cuando el usuario no existe, para que el tiempo de respuesta no revele qué correos
 * están registrados.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64'));
  await verifyPassword(password, await dummyHash);
}

/**
 * Lista de contraseñas comunes empaquetada, sin consultas externas (D-79).
 * Fuente: `@zxcvbn-ts/language-common` 4.1.3, licencia MIT [VERIFICADO: campo `license`
 * en npm y archivo LICENSE.txt del paquete]. Contiene 49 233 contraseñas.
 */
const COMMON = new Set(dictionary['passwords-common'].map((p) => p.toLowerCase()));

/** Motivos por los que una contraseña no cumple la política. */
export type PasswordIssue = 'too_short' | 'too_long' | 'common' | 'contains_email';

/**
 * Política de contraseñas (D-79): longitud entre 12 y 128 caracteres, no figurar en la
 * lista de contraseñas comunes y no contener el correo ni su parte local. Sin reglas de
 * composición forzada (mayúsculas, símbolos): favorecen contraseñas predecibles.
 */
export function checkPasswordPolicy(password: string, context: { email?: string } = {}): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const normalized = normalize(password);
  // Se cuentan puntos de código Unicode (no unidades UTF-16): "ñ" cuenta 1.
  const length = Array.from(normalized).length;
  if (length < PASSWORD_MIN_LENGTH) issues.push('too_short');
  if (length > PASSWORD_MAX_LENGTH) issues.push('too_long');
  const lower = normalized.toLowerCase();
  if (COMMON.has(lower) || COMMON.has(lower.trim())) issues.push('common');
  if (context.email !== undefined) {
    const email = context.email.toLowerCase();
    const local = email.split('@')[0] ?? '';
    if (lower.includes(email) || (local.length >= 4 && lower.includes(local))) issues.push('contains_email');
  }
  return issues;
}
