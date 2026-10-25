// SPDX-License-Identifier: AGPL-3.0-or-later
// Verifica que cada archivo fuente propio declare su licencia con una cabecera SPDX
// en las primeras líneas (convención D-26). Falla con código 1 si falta en alguno.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const HEADER = 'SPDX-License-Identifier: AGPL-3.0-or-later';
const EXTENSIONS = /\.(ts|tsx|js|mjs|cjs)$/;

// Solo archivos versionados en git: evita revisar dependencias o artefactos compilados.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => EXTENSIONS.test(f) && !f.includes('/dist/'));

const missing = files.filter((file) => {
  const head = readFileSync(file, 'utf8').split('\n').slice(0, 3).join('\n');
  return !head.includes(HEADER);
});

if (missing.length > 0) {
  console.error(`Archivos sin cabecera "${HEADER}":`);
  for (const file of missing) console.error(`  - ${file}`);
  process.exit(1);
}
console.log(`Cabeceras SPDX correctas en ${files.length} archivo(s).`);
