// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Indicador de fortaleza de contraseña, **solo orientativo**. La política real la aplica la
 * API (`packages/identity/src/password.ts`: mínimo 12, máximo 128, sin contraseñas comunes
 * ni el correo). Aquí no se replica la lista de contraseñas comunes para no agregar una
 * dependencia ni enviar nada fuera del servidor; el mensaje lo deja claro.
 */

export const MIN_LENGTH = 12;
export const MAX_LENGTH = 128;

export interface StrengthResult {
  /** 0 = no cumple el mínimo; 1 a 4 = cada vez más robusta. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  /** Problemas que impedirían aceptar la contraseña (en español, accionables). */
  problems: string[];
}

const LABELS = ['No cumple', 'Aceptable', 'Buena', 'Muy buena', 'Excelente'] as const;

/** Cuenta Unicode (no unidades UTF-16), como el servidor. */
function length(value: string): number {
  return Array.from(value).length;
}

export function passwordStrength(password: string, email?: string): StrengthResult {
  const problems: string[] = [];
  const len = length(password);
  if (len < MIN_LENGTH) problems.push(`Use al menos ${String(MIN_LENGTH)} caracteres (lleva ${String(len)}).`);
  if (len > MAX_LENGTH) problems.push(`Use como máximo ${String(MAX_LENGTH)} caracteres.`);
  const local = email?.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && password.normalize('NFKC').toLowerCase().includes(local)) problems.push('No incluya su correo en la contraseña.');
  if (problems.length > 0) return { score: 0, label: LABELS[0], problems };
  const classes = [/[a-záéíóúñü]/, /[A-ZÁÉÍÓÚÑÜ]/, /\d/, /[^A-Za-z0-9áéíóúñüÁÉÍÓÚÑÜ]/].filter((r) => r.test(password)).length;
  const unique = new Set(Array.from(password)).size;
  let score = 1;
  if (len >= 16) score += 1;
  if (len >= 20) score += 1;
  if (classes >= 3 || password.includes(' ')) score += 1;
  // Repetir pocos caracteres (p. ej. "aaaaaaaaaaaa") no aporta fortaleza.
  if (unique < 6) score = 1;
  const bounded = Math.min(4, score) as 1 | 2 | 3 | 4;
  return { score: bounded, label: LABELS[bounded], problems };
}
