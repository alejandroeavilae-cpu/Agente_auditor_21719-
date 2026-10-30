// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ageMfaVerification } from './support/db.js';
import { expect, expectAccessible, loginUi, test } from './support/fixtures.js';
import { nextTotp } from './support/totp.js';

/**
 * Flujo 5 de 2C §2.5: exportación de la bitácora desde la interfaz y verificación de su
 * integridad con la CLI independiente REAL (`packages/audit-log/dist/cli.js`).
 */
test('exportar la bitácora (con reautenticación) y verificarla con auditor-log verify', async ({ page, state }, testInfo) => {
  await loginUi(page, state.admin);
  await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Exportar bitácora' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Exportar bitácora' })).toBeVisible();
  await expectAccessible(page, 'Exportar bitácora');

  await ageMfaVerification(state.admin.email, 10);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar bitácora' }).click();
  const reauth = page.getByRole('dialog', { name: 'Confirme su código de verificación' });
  await reauth.getByLabel('Código de verificación').fill(await nextTotp(state.admin.secret));
  await reauth.getByRole('button', { name: 'Confirmar' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^bitacora-muni-e2e-\d{8}T\d{6}Z\.jsonl$/);
  await expect(page.getByText(`Se descargó ${file.suggestedFilename()}`)).toBeVisible();
  await expect(page.getByText('muni-e2e', { exact: true })).toBeVisible();
  await expect(page.getByText(`auditor-log verify --entries ${file.suggestedFilename()} --chain-id muni-e2e`)).toBeVisible();
  await expectAccessible(page, 'Exportar bitácora (resultado)');

  const saved = testInfo.outputPath(file.suggestedFilename());
  copyFileSync(await file.path(), saved);
  const lines = readFileSync(saved, 'utf8').trim().split('\n');
  expect(JSON.parse(lines[lines.length - 1] ?? '{}')).toMatchObject({ action: 'audit_log.exported' });
  // Sin IP en claro: solo HMAC.
  expect(readFileSync(saved, 'utf8')).not.toContain('127.0.0.1');

  const cli = join(state.repoRoot, 'packages/audit-log/dist/cli.js');
  const ok = spawnSync(process.execPath, [cli, 'verify', '--entries', saved, '--chain-id', 'muni-e2e'], { encoding: 'utf8' });
  expect(ok.status, ok.stdout + ok.stderr).toBe(0);
  expect(ok.stdout).toContain('RESULTADO: bitácora íntegra.');

  // Control negativo: una línea alterada se detecta.
  const tampered = testInfo.outputPath('alterada.jsonl');
  const altered = [...lines];
  altered[1] = (altered[1] ?? '').replace(/"action":"[^"]+"/, '"action":"alterada"');
  writeFileSync(tampered, `${altered.join('\n')}\n`);
  const bad = spawnSync(process.execPath, [cli, 'verify', '--entries', tampered, '--chain-id', 'muni-e2e'], { encoding: 'utf8' });
  expect(bad.status).toBe(1);
});
