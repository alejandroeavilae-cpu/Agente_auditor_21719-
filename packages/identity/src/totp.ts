// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Códigos de un solo uso basados en tiempo (TOTP, RFC 6238), implementados con
 * `node:crypto` (sin dependencias).
 *
 * Configuración compatible con las aplicaciones autenticadoras habituales [DECISIÓN]:
 * HMAC-SHA1, 6 dígitos, paso de 30 s y secreto de 20 bytes. Se acepta ±1 paso de
 * desfase de reloj. Un mismo paso no se acepta dos veces (protección contra reuso).
 */

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export interface TotpOptions {
  digits?: number;
  stepSeconds?: number;
  algorithm?: TotpAlgorithm;
}

const DEFAULTS = { digits: 6, stepSeconds: 30, algorithm: 'sha1' as TotpAlgorithm };

/** Número de paso para un instante (segundos desde la época Unix). */
export function totpStep(unixSeconds: number, stepSeconds = DEFAULTS.stepSeconds): number {
  return Math.floor(unixSeconds / stepSeconds);
}

/** Código TOTP de un paso concreto (RFC 4226 §5.3, truncamiento dinámico). */
export function totpForStep(key: Buffer, step: number, options: TotpOptions = {}): string {
  const digits = options.digits ?? DEFAULTS.digits;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac(options.algorithm ?? DEFAULTS.algorithm, key).update(counter).digest();
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const binary =
    (((mac[offset] as number) & 0x7f) << 24) | ((mac[offset + 1] as number) << 16) | ((mac[offset + 2] as number) << 8) | (mac[offset + 3] as number);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** Código TOTP para un instante. */
export function totpAt(key: Buffer, unixSeconds: number, options: TotpOptions = {}): string {
  return totpForStep(key, totpStep(unixSeconds, options.stepSeconds ?? DEFAULTS.stepSeconds), options);
}

/**
 * Verifica un código. Devuelve el paso aceptado (para registrarlo y rechazar su reuso) o
 * `null`. Compara en tiempo constante.
 *
 * @param lastUsedStep último paso ya aceptado para este usuario; ese paso y los
 *   anteriores se rechazan.
 */
export function verifyTotp(key: Buffer, code: string, unixSeconds: number, lastUsedStep: number | null, options: TotpOptions = {}): number | null {
  const digits = options.digits ?? DEFAULTS.digits;
  if (!new RegExp(`^\\d{${String(digits)}}$`).test(code)) return null;
  const current = totpStep(unixSeconds, options.stepSeconds ?? DEFAULTS.stepSeconds);
  for (const step of [current - 1, current, current + 1]) {
    if (lastUsedStep !== null && step <= lastUsedStep) continue;
    const expected = Buffer.from(totpForStep(key, step, options));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Codifica en base32 (RFC 4648) sin relleno, el formato que leen las apps autenticadoras. */
export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31);
  return out;
}

/** Genera un secreto TOTP nuevo (20 bytes, recomendado por RFC 4226 §4 para SHA-1). */
export function generateTotpSecret(): Buffer {
  return randomBytes(20);
}

/**
 * URI `otpauth://` para registrar el secreto en una app autenticadora (normalmente como
 * código QR, que generará la pantalla de 2C).
 */
export function otpauthUri(secret: Buffer, issuer: string, account: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret: base32Encode(secret), issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}
