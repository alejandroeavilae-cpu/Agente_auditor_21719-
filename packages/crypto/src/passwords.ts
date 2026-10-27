// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomInt } from 'node:crypto';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '-_';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

/**
 * Genera una contraseña aleatoria para el usuario de base de datos de una organización.
 *
 * Requisitos de diseño:
 * - Cumple la política de complejidad de SQL Server (mayúsculas, minúsculas, dígitos y
 *   símbolos), que rechaza contraseñas con menos de tres categorías.
 * - Solo usa caracteres que no requieren escape en SQL ni en cadenas de conexión
 *   (sin comillas, punto y coma, espacios ni barras), porque `CREATE LOGIN`/`CREATE ROLE`
 *   no admiten la contraseña como parámetro.
 * - Longitud 40: unas 230 bits de entropía.
 */
export function generateDbPassword(length = 40): string {
  if (length < 16) throw new Error('La contraseña debe tener al menos 16 caracteres.');
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  // Mezcla de Fisher-Yates con aleatoriedad criptográfica.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  // La primera posición es siempre una letra: algunos motores tratan mal un guion inicial.
  const firstLetter = chars.findIndex((c) => /[A-Za-z]/.test(c));
  [chars[0], chars[firstLetter]] = [chars[firstLetter] as string, chars[0] as string];
  return chars.join('');
}

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)] as string;
}
