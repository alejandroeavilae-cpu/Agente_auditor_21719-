// SPDX-License-Identifier: AGPL-3.0-or-later
// Interpreta el informe JSON de ZAP baseline (scripts/zap-baseline.sh).
//
// Regla (09-seguridad.md): falla ante cualquier alerta de riesgo ALTO (riskcode 3) que no
// esté ignorada en deploy/zap/baseline.conf. Todas las alertas se publican como anotaciones
// de GitHub (las altas como error, las medias y bajas como advertencia, las informativas
// como aviso) para que queden como evidencia sin tener que abrir los registros del job.
//
// Uso: node scripts/zap-report.mjs <zap-report.json> <baseline.conf>
import { readFileSync } from 'node:fs';

const [file, conf] = process.argv.slice(2);
if (!file || !conf) {
  console.error('Uso: node scripts/zap-report.mjs <zap-report.json> <baseline.conf>');
  process.exit(2);
}

/** Reglas ignoradas: líneas "<id>\tIGNORE\t(<justificación>)" del archivo de configuración. */
const ignored = new Set(
  readFileSync(conf, 'utf8')
    .split('\n')
    .filter((l) => !l.startsWith('#') && l.trim() !== '')
    .map((l) => l.split('\t'))
    .filter((cols) => cols[1] === 'IGNORE')
    .map((cols) => cols[0]),
);

const report = JSON.parse(readFileSync(file, 'utf8'));
const RISK = { 0: 'informativa', 1: 'baja', 2: 'media', 3: 'alta' };
let high = 0;
let total = 0;
for (const site of report.site ?? []) {
  for (const alert of site.alerts ?? []) {
    total += 1;
    const risk = Number(alert.riskcode);
    const id = String(alert.pluginid);
    const count = Number(alert.count ?? (alert.instances ?? []).length);
    const firstUri = alert.instances?.[0]?.uri ?? '';
    const text = `[${id}] ${alert.name} (riesgo ${RISK[risk] ?? risk}, ${count} instancia(s); p. ej. ${firstUri})${ignored.has(id) ? ' — IGNORADA por baseline.conf' : ''}`;
    if (risk >= 3 && !ignored.has(id)) {
      high += 1;
      console.log(`::error title=zap-alta::${text}`);
    } else if (risk >= 1) {
      console.log(`::warning title=zap::${text}`);
    } else {
      console.log(`::notice title=zap::${text}`);
    }
  }
}
console.log(`ZAP baseline: ${total} tipo(s) de alerta; ${high} de riesgo alto no ignoradas.`);
if (high > 0) process.exit(1);
