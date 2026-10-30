// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { totpForStep, totpStep } from '@auditor-21719/identity';

/**
 * Códigos TOTP para las pruebas, calculados con el mismo código de la plataforma
 * (`packages/identity`). La API rechaza reutilizar un paso ya aceptado (protección contra
 * reuso) y acepta ±1 paso, así que se usa el siguiente paso libre y, si no queda ninguno en
 * la ventana, se espera al próximo. Los pasos usados se guardan en el directorio temporal
 * de la ejecución para que sobrevivan a un reinicio del proceso de pruebas.
 */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error(`Carácter base32 inválido: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function stepsFile(): string {
  const dir = process.env.E2E_STATE_DIR;
  if (dir === undefined) throw new Error('E2E_STATE_DIR no está definido (¿se ejecutó el global setup?)');
  return join(dir, 'totp-steps.json');
}

function readSteps(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(stepsFile(), 'utf8')) as Record<string, number>;
  } catch {
    return {};
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Siguiente código válido y no usado para el secreto (base32). Puede esperar hasta ~30 s. */
export async function nextTotp(secretBase32: string): Promise<string> {
  const key = base32Decode(secretBase32);
  const id = createHash('sha256').update(secretBase32).digest('hex').slice(0, 16);
  for (;;) {
    const steps = readSteps();
    const last = steps[id] ?? -1;
    const current = totpStep(Math.floor(Date.now() / 1000));
    // current+1 también lo acepta la API (desfase de reloj), pero solo si faltan menos de
    // 20 s para que empiece, para no rozar el borde de la ventana.
    const secondsIntoStep = Math.floor(Date.now() / 1000) % 30;
    const candidates = secondsIntoStep >= 10 ? [current, current + 1] : [current];
    const step = candidates.find((s) => s > last);
    if (step !== undefined) {
      steps[id] = step;
      writeFileSync(stepsFile(), JSON.stringify(steps));
      return totpForStep(key, step);
    }
    await sleep(1000);
  }
}

/** Código deliberadamente incorrecto (para provocar bloqueos), distinto de los válidos cercanos. */
export function wrongTotp(secretBase32: string): string {
  const key = base32Decode(secretBase32);
  const current = totpStep(Math.floor(Date.now() / 1000));
  const valid = new Set([current - 1, current, current + 1].map((s) => totpForStep(key, s)));
  for (let n = 0; n < 1_000_000; n += 1) {
    const code = String(n).padStart(6, '0');
    if (!valid.has(code)) return code;
  }
  throw new Error('inalcanzable');
}
