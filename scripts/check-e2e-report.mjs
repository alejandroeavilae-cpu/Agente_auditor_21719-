// SPDX-License-Identifier: AGPL-3.0-or-later
// Revisa el informe JSON de Playwright de las pruebas E2E de 2C-2.
//
// Igual que check-integration-report.mjs para las de integración (hallazgo QA B-13): una
// prueba omitida, inestable o un archivo que no se ejecutó no deben pasar por "aprobado".
// Falla si hay pruebas fallidas, omitidas o inestables, o si se aprobaron menos de
// MIN_E2E_TESTS (por defecto el valor del segundo argumento).
//
// Uso: node scripts/check-e2e-report.mjs <informe.json> [mínimo]
import { readFileSync } from 'node:fs';

const [file, minArg] = process.argv.slice(2);
if (!file) {
  console.error('Uso: node scripts/check-e2e-report.mjs <informe.json> [mínimo]');
  process.exit(2);
}
const min = Number(process.env.MIN_E2E_TESTS ?? minArg ?? 1);
const report = JSON.parse(readFileSync(file, 'utf8'));
const stats = report.stats ?? {};
const passed = Number(stats.expected ?? 0);
const failed = Number(stats.unexpected ?? 0);
const skipped = Number(stats.skipped ?? 0);
const flaky = Number(stats.flaky ?? 0);
const errors = (report.errors ?? []).length;

console.log(`E2E: ${passed} aprobadas, ${failed} fallidas, ${skipped} omitidas, ${flaky} inestables, ${errors} errores globales (mínimo exigido: ${min}).`);
const problems = [];
if (failed > 0) problems.push(`${failed} prueba(s) fallida(s)`);
if (skipped > 0) problems.push(`${skipped} prueba(s) omitida(s): omitir no cuenta como aprobado`);
if (flaky > 0) problems.push(`${flaky} prueba(s) inestable(s)`);
if (errors > 0) problems.push(`${errors} error(es) fuera de las pruebas (p. ej. en el global setup)`);
if (passed < min) problems.push(`solo ${passed} aprobadas; se exigen al menos ${min}`);
if (problems.length > 0) {
  for (const p of problems) console.log(`::error title=e2e::${p}`);
  process.exit(1);
}
