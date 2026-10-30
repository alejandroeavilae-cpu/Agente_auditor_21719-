// SPDX-License-Identifier: AGPL-3.0-or-later

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, serverAdminDatabase, type DbServerConfig } from '@auditor-21719/persistence';
import { sql } from 'kysely';
import { ApiClient } from './api-client.js';
import type { E2EState } from './state.js';
import { syntheticPassword } from './state.js';

/**
 * Entorno efímero de las pruebas E2E (2C §2.5), con la API REAL y PostgreSQL:
 *
 * 1. con la cuenta de superusuario de un PostgreSQL DESECHABLE (variables TEST_PG_*, las
 *    mismas de las pruebas de integración) crea una cuenta de aprovisionamiento sin
 *    superusuario, como `deploy/compose/postgres-init`;
 * 2. con la CLI real (`auditor-admin`) inicializa una base de control propia de la
 *    ejecución, crea la organización y escribe los secretos de la API (D-87);
 * 3. arranca la API compilada (`apps/api/dist/main.js`) y el servidor de la SPA con las
 *    cabeceras y la CSP del Caddyfile (`web-server.mjs`);
 * 4. invita y activa al primer administrador con la CLI y la API (datos sintéticos).
 *
 * Al terminar detiene los procesos y borra bases, cuentas y archivos temporales (salvo
 * `E2E_KEEP=1`, para inspeccionar).
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function superServerFromEnv(): DbServerConfig {
  const host = process.env.TEST_PG_HOST;
  if (host === undefined || host === '') {
    throw new Error('Las pruebas E2E necesitan un PostgreSQL desechable: defina TEST_PG_HOST, TEST_PG_PORT, TEST_PG_USER, TEST_PG_PASSWORD y TEST_PG_TLS (ver docs/fase-1/ejecucion-local.md).');
  }
  return {
    engine: 'postgresql',
    host,
    port: Number(process.env.TEST_PG_PORT ?? 5432),
    user: process.env.TEST_PG_USER ?? 'postgres',
    password: process.env.TEST_PG_PASSWORD ?? '',
    tls: (process.env.TEST_PG_TLS ?? 'disable') as DbServerConfig['tls'],
  };
}

function runCli(script: string, args: string[], env: NodeJS.ProcessEnv): string {
  const res = spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`${script} ${args.join(' ')} falló (${String(res.status)}): ${res.stderr}${res.stdout}`);
  return res.stdout;
}

async function waitFor(url: string, what: string, child: ChildProcess): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    if (child.exitCode !== null) throw new Error(`${what} terminó al arrancar (código ${String(child.exitCode)})`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Todavía no escucha.
    }
    await sleep(250);
  }
  throw new Error(`${what} no respondió en ${url}`);
}

function startProcess(args: string[], env: NodeJS.ProcessEnv, logFile: string): ChildProcess {
  const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks: string[] = [];
  child.stdout.on('data', (d: Buffer) => chunks.push(d.toString()));
  child.stderr.on('data', (d: Buffer) => chunks.push(d.toString()));
  child.on('exit', () => {
    writeFileSync(logFile, chunks.join(''));
  });
  return child;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const apiMain = join(repoRoot, 'apps/api/dist/main.js');
  const adminCli = join(repoRoot, 'apps/api/dist/admin/cli.js');
  const webDist = join(repoRoot, 'apps/web/dist/index.html');
  for (const f of [apiMain, adminCli, webDist]) {
    if (!existsSync(f)) throw new Error(`Falta ${f}. Compile antes: pnpm run build`);
  }
  const superServer = superServerFromEnv();
  const run = randomBytes(4).toString('hex');
  const stateDir = mkdtempSync(join(tmpdir(), 'auditor-e2e-'));
  const secretsDir = join(stateDir, 'secrets');
  mkdirSync(join(secretsDir, 'api'), { recursive: true, mode: 0o700 });
  process.env.E2E_STATE_DIR = stateDir;

  // 1. Cuenta de aprovisionamiento sin superusuario (como postgres-init del perfil Compose).
  const provUser = `auditor_prov_e2e_${run}`;
  const provPassword = randomBytes(24).toString('hex');
  const admin = connect<unknown>(superServer, serverAdminDatabase(superServer), 1);
  try {
    await sql`CREATE ROLE ${sql.id(provUser)} LOGIN CREATEDB CREATEROLE NOSUPERUSER PASSWORD ${sql.lit(provPassword)}`.execute(admin);
    await sql`GRANT pg_signal_backend TO ${sql.id(provUser)}`.execute(admin);
    await sql`GRANT CONNECT ON DATABASE postgres TO ${sql.id(provUser)}`.execute(admin);
  } finally {
    await admin.destroy();
  }
  writeFileSync(join(secretsDir, 'provisioner_password'), provPassword, { mode: 0o600 });
  writeFileSync(join(secretsDir, 'master.key'), `${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });

  // 2. Base de control, organización y secretos de la API con la CLI real.
  const controlDb = `auditor_e2e_${run}`;
  const slug = 'muni-e2e';
  const organizationName = 'Municipalidad Sintética E2E';
  const adminEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    DB_ENGINE: 'postgresql',
    DB_HOST: superServer.host,
    DB_PORT: String(superServer.port),
    DB_ADMIN_USER: provUser,
    DB_ADMIN_PASSWORD_FILE: join(secretsDir, 'provisioner_password'),
    DB_CONTROL_DATABASE: controlDb,
    DB_TLS: superServer.tls,
    MASTER_KEY_FILE: join(secretsDir, 'master.key'),
  };
  runCli(adminCli, ['init'], adminEnv);
  runCli(adminCli, ['tenant', 'create', '--slug', slug, '--name', organizationName], adminEnv);
  runCli(adminCli, ['api-secrets', 'write', '--tenant', slug, '--out', join(secretsDir, 'api')], adminEnv);

  // 3. API y web.
  const apiPort = Number(process.env.E2E_API_PORT ?? 3187);
  const webPort = Number(process.env.E2E_WEB_PORT ?? 4187);
  const apiUrl = `http://127.0.0.1:${String(apiPort)}`;
  const webUrl = `http://127.0.0.1:${String(webPort)}`;
  const api = startProcess(
    [apiMain],
    {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(apiPort),
      DB_ENGINE: 'postgresql',
      DB_HOST: superServer.host,
      DB_PORT: String(superServer.port),
      DB_TLS: superServer.tls,
      ORGANIZATION_FILE: join(secretsDir, 'api/organization.json'),
      ORGANIZATION_DB_PASSWORD_FILE: join(secretsDir, 'api/organization_db_password'),
      ORGANIZATION_DEK_FILE: join(secretsDir, 'api/organization_dek'),
      // Perfil local sin HTTPS (como Compose local): la cookie no puede ser Secure.
      COOKIE_SECURE: 'false',
      // Todas las peticiones de las pruebas salen de 127.0.0.1: sin esto, el límite de 20
      // intentos sensibles cada 5 min por IP cortaría la suite. Los bloqueos por cuenta y por
      // origen (D-88, D-89) NO dependen de este límite y se prueban igual.
      SENSITIVE_RATE_LIMIT: '100000',
    },
    join(stateDir, 'api.log'),
  );
  const web = startProcess(
    [join(repoRoot, 'apps/web/e2e/support/web-server.mjs'), String(webPort), apiUrl, join(repoRoot, 'apps/web/dist'), join(repoRoot, 'deploy/docker/Caddyfile')],
    { PATH: process.env.PATH },
    join(stateDir, 'web.log'),
  );
  await waitFor(`${apiUrl}/health`, 'La API', api);
  await waitFor(`${webUrl}/`, 'El servidor web', web);

  // 4. Primer administrador: invitación por CLI y activación con MFA por la API.
  const adminEmail = 'admin@muni-e2e.example';
  const adminName = 'Administración Sintética';
  const out = runCli(adminCli, ['user', 'invite-admin', '--tenant', slug, '--email', adminEmail, '--name', adminName], adminEnv);
  const token = out.split('\n').map((l) => l.trim()).find((l) => /^[A-Za-z0-9_-]{43}$/.test(l));
  if (token === undefined) throw new Error('invite-admin no imprimió un token');
  const adminPassword = syntheticPassword();
  const tenantDb = await (async () => {
    const control = connect<unknown>(superServer, controlDb, 1);
    try {
      const rows = await sql<{ db_name: string }>`SELECT db_name FROM tenants WHERE slug = ${slug}`.execute(control);
      const name = rows.rows[0]?.db_name;
      if (name === undefined) throw new Error('No se encontró la organización en la base de control');
      return name;
    } finally {
      await control.destroy();
    }
  })();
  const state: E2EState = {
    webUrl,
    apiUrl,
    slug,
    organizationName,
    tenantDb,
    controlDb,
    superServer,
    admin: { email: adminEmail, password: adminPassword, secret: '', name: adminName },
    stateDir,
    repoRoot,
  };
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify(state), { mode: 0o600 });
  const { secret } = await new ApiClient(apiUrl).activateWithMfa(token, adminPassword);
  state.admin.secret = secret;
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify(state), { mode: 0o600 });

  return async () => {
    for (const child of [web, api]) {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((r) => {
          const t = setTimeout(() => {
            child.kill('SIGKILL');
            r();
          }, 5000);
          child.once('exit', () => {
            clearTimeout(t);
            r();
          });
        });
      }
    }
    // Registros de la API y del servidor web para diagnosticar fallas (sin secretos: la API
    // no registra cuerpos de petición). Quedan en test-results/, excluido de Git.
    const logs = join(repoRoot, 'apps/web/test-results/entorno');
    mkdirSync(logs, { recursive: true });
    for (const f of ['api.log', 'web.log']) {
      if (existsSync(join(stateDir, f))) copyFileSync(join(stateDir, f), join(logs, f));
    }
    if (process.env.E2E_KEEP === '1') {
      console.log(`E2E_KEEP=1: se conservan ${stateDir}, la base ${controlDb} y la de la organización.`);
      return;
    }
    const db = connect<unknown>(superServer, serverAdminDatabase(superServer), 1);
    try {
      const tenantUsers = await (async () => {
        const control = connect<unknown>(superServer, controlDb, 1);
        try {
          return (await sql<{ db_name: string; db_user: string }>`SELECT db_name, db_user FROM tenants`.execute(control)).rows;
        } finally {
          await control.destroy();
        }
      })();
      for (const t of tenantUsers) {
        await sql`DROP DATABASE IF EXISTS ${sql.id(t.db_name)} WITH (FORCE)`.execute(db);
        await sql`DROP ROLE IF EXISTS ${sql.id(t.db_user)}`.execute(db);
      }
      await sql`DROP DATABASE IF EXISTS ${sql.id(controlDb)} WITH (FORCE)`.execute(db);
      await sql`REVOKE CONNECT ON DATABASE postgres FROM ${sql.id(provUser)}`.execute(db);
      await sql`DROP ROLE IF EXISTS ${sql.id(provUser)}`.execute(db);
    } finally {
      await db.destroy();
    }
    rmSync(stateDir, { recursive: true, force: true });
  };
}
