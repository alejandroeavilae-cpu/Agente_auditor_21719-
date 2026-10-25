// SPDX-License-Identifier: AGPL-3.0-or-later
// Convierte un informe JSON de Trivy en anotaciones de GitHub Actions y aplica la
// regla de bloqueo D-24: falla si hay hallazgos (el informe ya viene filtrado a
// severidad HIGH/CRITICAL y, para vulnerabilidades, solo las que tienen corrección).
// Uso: node scripts/ci-report-trivy.mjs <informe.json> <etiqueta>
import { readFileSync } from 'node:fs';

const [file, label = 'trivy'] = process.argv.slice(2);
if (!file) {
  console.error('Uso: node scripts/ci-report-trivy.mjs <informe.json> <etiqueta>');
  process.exit(2);
}
const report = JSON.parse(readFileSync(file, 'utf8'));
// Las anotaciones no admiten saltos de línea ni "::" sin escapar.
const esc = (s) => String(s ?? '').replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, ' ');

const findings = [];
for (const result of report.Results ?? []) {
  for (const v of result.Vulnerabilities ?? []) {
    findings.push(`[${label}] ${v.Severity} ${v.VulnerabilityID} en ${v.PkgName}@${v.InstalledVersion} (corregido en ${v.FixedVersion || 'sin versión'}) — ${result.Target}`);
  }
  for (const m of result.Misconfigurations ?? []) {
    if (m.Status === 'FAIL') findings.push(`[${label}] ${m.Severity} ${m.ID} ${m.Title} — ${result.Target}: ${m.Message}`);
  }
  for (const s of result.Secrets ?? []) {
    findings.push(`[${label}] ${s.Severity} secreto ${s.RuleID} — ${result.Target}:${s.StartLine}`);
  }
}

for (const f of findings) console.log(`::error title=${esc(label)}::${esc(f)}`);
console.log(`${label}: ${findings.length} hallazgo(s) que bloquean (D-24).`);
process.exit(findings.length > 0 ? 1 : 0);
