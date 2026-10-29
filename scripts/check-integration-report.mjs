#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Valida el informe JSON de Vitest del job de integración (hallazgo QA B-13):
//  - ninguna prueba fallida ni omitida;
//  - cada motor exigido (REQUIRE_DB_ENGINES) tiene al menos MIN_TESTS_PER_ENGINE pruebas
//    aprobadas, contadas por el bloque "<SUITE_PREFIX> <motor>" (por defecto
//    "organizaciones en"; la suite de identidad usa "identidad en").
// Uso: node scripts/check-integration-report.mjs <informe.json>

import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('Uso: check-integration-report.mjs <informe.json>');
  process.exit(2);
}
const report = JSON.parse(readFileSync(file, 'utf8'));
const engines = (process.env.REQUIRE_DB_ENGINES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const min = Number(process.env.MIN_TESTS_PER_ENGINE ?? '1');
const prefix = process.env.SUITE_PREFIX ?? 'organizaciones en';
// Valores no numéricos nunca deben convertirse en "aprobado" (hallazgo QA N-05).
if (!Number.isInteger(min) || min < 1) {
  console.log(`::error title=integración::MIN_TESTS_PER_ENGINE inválido: ${process.env.MIN_TESTS_PER_ENGINE}`);
  process.exit(2);
}
/** Contador del informe: ausente cuenta como 0; cualquier otro valor no entero es un error. */
function count(name) {
  const v = report[name] ?? 0;
  if (!Number.isInteger(v) || v < 0) {
    console.log(`::error title=integración::Informe inválido: ${name}=${String(v)}`);
    process.exit(2);
  }
  return v;
}
const passed = count('numPassedTests');
const failed = count('numFailedTests');
const skipped = count('numPendingTests') + count('numTodoTests');

const passedByEngine = Object.fromEntries(engines.map((e) => [e, 0]));
for (const suite of report.testResults ?? []) {
  for (const t of suite.assertionResults ?? []) {
    if (t.status !== 'passed') continue;
    for (const e of engines) {
      if ((t.ancestorTitles ?? []).includes(`${prefix} ${e}`)) passedByEngine[e] += 1;
    }
  }
}

const summary = `${passed} aprobadas, ${failed} fallidas, ${skipped} omitidas · por motor: ${engines.map((e) => `${e}=${passedByEngine[e]}`).join(', ')}`;
console.log(`Pruebas: ${summary}`);
console.log(`::notice title=integración::${summary}`);

const errors = [];
if (failed > 0) errors.push('hay pruebas fallidas');
if (passed === 0) errors.push('no se aprobó ninguna prueba');
if (skipped > 0) errors.push('hay pruebas omitidas: no se acepta como aprobado');
if (engines.length === 0) errors.push('REQUIRE_DB_ENGINES está vacío');
for (const e of engines) {
  if (passedByEngine[e] < min) errors.push(`${e}: ${passedByEngine[e]} pruebas aprobadas, mínimo ${min}`);
}
for (const e of errors) console.log(`::error title=integración::${e}`);
process.exit(errors.length > 0 ? 1 : 0);
