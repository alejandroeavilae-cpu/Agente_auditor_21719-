// SPDX-License-Identifier: AGPL-3.0-or-later

import { createApp } from './bootstrap.js';
import { loadConfig } from './config/app-config.js';

/** Punto de entrada del proceso de la API. */
async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.PORT, config.HOST);
}

main().catch((error: unknown) => {
  // Falla cerrada: si no se puede iniciar de forma segura, el proceso termina.
  console.error('No fue posible iniciar la API:', error instanceof Error ? error.message : error);
  process.exit(1);
});
