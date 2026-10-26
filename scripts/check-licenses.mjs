// SPDX-License-Identifier: AGPL-3.0-or-later
// Política de licencias de dependencias (decisión D-01, sección 4 de la especificación).
//
// Recorre TODAS las dependencias instaladas (incluidas las de desarrollo y transitivas)
// mediante `pnpm licenses list --json` y falla si alguna tiene una licencia fuera de la
// lista permitida. La lista contiene licencias libres que, según el criterio adoptado en
// la Fase 0, son compatibles con AGPL-3.0-or-later. [SUPUESTO pendiente de revisión
// jurídica P-01]. Una licencia nueva requiere decisión registrada, no un cambio silencioso.
//
// Con `--write` regenera THIRD_PARTY_LICENSES.md (sección 4: "Documentar licencias de
// terceros"). El inventario versionado se genera en CI (Linux): en otros sistemas
// operativos pueden aparecer binarios opcionales distintos, por eso la verificación
// local no lo reescribe (hallazgo QA H-25).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const ALLOWED = new Set([
  'MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0',
  'BlueOak-1.0.0', 'CC0-1.0', 'Unlicense', 'Python-2.0', 'CC-BY-4.0',
  'MPL-2.0', 'LGPL-3.0-or-later', 'GPL-3.0-or-later', 'AGPL-3.0-or-later',
]);

/**
 * Evalúa expresiones SPDX: "A OR B" basta con que una esté permitida; "A AND B" exige
 * ambas. Con paréntesis la precedencia podría alterarse, así que se aplica el criterio
 * conservador: TODAS las licencias mencionadas deben estar permitidas (hallazgo QA H-25).
 */
function isAllowed(expression) {
  const expr = expression.trim();
  if (expr.includes('(')) {
    return expr
      .replace(/[()]/g, ' ')
      .split(/\s+(?:OR|AND|WITH)\s+|\s+/)
      .filter(Boolean)
      .every((id) => ALLOWED.has(id));
  }
  if (expr.includes(' OR ')) return expr.split(' OR ').some((p) => isAllowed(p));
  if (expr.includes(' AND ')) return expr.split(' AND ').every((p) => isAllowed(p));
  return ALLOWED.has(expr);
}

const raw = execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const byLicense = JSON.parse(raw);

const rows = [];
const violations = [];
for (const [license, packages] of Object.entries(byLicense)) {
  for (const pkg of packages) {
    const versions = Array.isArray(pkg.versions) ? pkg.versions.join(', ') : String(pkg.version ?? '');
    rows.push({ name: pkg.name, versions, license });
    if (!isAllowed(license)) violations.push(`${pkg.name}@${versions}: ${license}`);
  }
}
rows.sort((a, b) => a.name.localeCompare(b.name));

const table = rows.map((r) => `| ${r.name} | ${r.versions} | ${r.license} |`).join('\n');
if (process.argv.includes('--write')) writeFileSync(
  'THIRD_PARTY_LICENSES.md',
  `# Licencias de terceros\n\nGenerado automáticamente por \`scripts/check-licenses.mjs\` a partir de las dependencias instaladas (incluye dependencias de desarrollo y transitivas). No editar a mano.\n\nTotal de paquetes: ${rows.length}\n\n| Paquete | Versión(es) | Licencia (SPDX) |\n|---|---|---|\n${table}\n`,
);

if (violations.length > 0) {
  console.error('Dependencias con licencias fuera de la política:');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`Política de licencias: ${rows.length} paquete(s) revisado(s), todos permitidos.`);
