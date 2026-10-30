// SPDX-License-Identifier: AGPL-3.0-or-later

import { loadMasterKey } from '@auditor-21719/crypto';
import { TenantManager } from '@auditor-21719/persistence';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config/app-config.js';
import { loadIdentityConfig } from './identity/identity-config.js';
import { IdentityService } from './identity/identity.service.js';

/** Punto de entrada del proceso de la API. */
async function main(): Promise<void> {
  const config = loadConfig();
  const identityConfig = loadIdentityConfig();
  let manager: TenantManager | undefined;
  let identity;
  if (identityConfig !== undefined) {
    const masterKey = loadMasterKey(identityConfig.masterKeyFile, { checkPermissions: identityConfig.checkMasterKeyPermissions });
    // Cuenta de solo lectura del registro de organizaciones (D-80): la API nunca usa la
    // cuenta de aprovisionamiento.
    manager = new TenantManager(identityConfig.db, [masterKey]);
    identity = {
      config: identityConfig,
      service: new IdentityService(manager, { defaultOrganization: identityConfig.defaultOrganization, accessLogRetentionDays: identityConfig.accessLogRetentionDays }),
    };
  }
  const app = await createApp(config, identity);
  const closeManager = manager;
  if (closeManager !== undefined) {
    process.once('beforeExit', () => void closeManager.close());
  }
  await app.listen(config.PORT, config.HOST);
}

main().catch((error: unknown) => {
  // Falla cerrada: si no se puede iniciar de forma segura, el proceso termina.
  console.error('No fue posible iniciar la API:', error instanceof Error ? error.message : error);
  process.exit(1);
});
