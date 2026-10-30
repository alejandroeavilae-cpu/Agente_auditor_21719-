// SPDX-License-Identifier: AGPL-3.0-or-later

import { OrganizationDirectory } from '@auditor-21719/persistence';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config/app-config.js';
import { loadIdentityConfig } from './identity/identity-config.js';
import { IdentityService } from './identity/identity.service.js';

/** Punto de entrada del proceso de la API. */
async function main(): Promise<void> {
  const config = loadConfig();
  const identityConfig = loadIdentityConfig();
  let directory: OrganizationDirectory | undefined;
  let identity;
  if (identityConfig !== undefined) {
    // Solo las credenciales de SU organización y su DEK: sin clave maestra, sin cuenta de
    // aprovisionamiento y sin acceso a la base de control (D-87 precisada por D-88).
    directory = new OrganizationDirectory(identityConfig.server, identityConfig.organization, identityConfig.dbPassword, identityConfig.dek);
    identity = {
      config: identityConfig,
      service: new IdentityService(directory, { accessLogRetentionDays: identityConfig.accessLogRetentionDays, attackAlertThreshold: identityConfig.attackAlertThreshold }),
    };
  }
  const app = await createApp(config, identity);
  const closeDirectory = directory;
  if (closeDirectory !== undefined) {
    process.once('beforeExit', () => void closeDirectory.close());
  }
  await app.listen(config.PORT, config.HOST);
}

main().catch((error: unknown) => {
  // Falla cerrada: si no se puede iniciar de forma segura, el proceso termina.
  console.error('No fue posible iniciar la API:', error instanceof Error ? error.message : error);
  process.exit(1);
});
