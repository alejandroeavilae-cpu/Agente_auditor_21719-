// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Tokens de sesión, de activación y de CSRF, y códigos de recuperación de MFA.
 *
 * En la base de datos solo se guarda el **hash SHA-256** de cada token: quien lea la base
 * (p. ej. desde un respaldo) no puede reutilizar sesiones ni enlaces de activación. Como
 * los tokens son aleatorios de 256 bits, un hash rápido es suficiente (no son contraseñas).
 */

/** Token aleatorio de 32 bytes en base64url (43 caracteres). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Formato de un token emitido por `newToken`. */
export const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** Hash del token para guardarlo o buscarlo. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Códigos de recuperación de MFA: 10 códigos de 16 caracteres en grupos de 4
 * (p. ej. `ab3k-9mzq-...`), unos 79 bits cada uno. Se muestran una sola vez.
 */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 16 }, () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)] as string).join('');
    return chars.match(/.{4}/g)?.join('-') ?? chars;
  });
}

/** Normaliza un código de recuperación ingresado (sin guiones ni espacios, minúsculas). */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}
