// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHmac, hkdfSync } from 'node:crypto';
import { open, seal, type SymmetricKey } from '@auditor-21719/crypto';
import type { Kysely } from 'kysely';
import { AuditLogRepository } from './audit-log-repository.js';
import type { DbServerConfig } from './config.js';
import { connect } from './connection.js';
import { assertTenantName, assertTenantSlug } from './naming.js';
import type { TenantDatabase, TenantStatus } from './schema.js';

/** Datos públicos de una organización (nunca incluye secretos). */
export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  dbName: string;
  createdAt: string;
}

/**
 * Cifrado con la DEK de una organización, sin exponer la clave (2B). Los contextos se
 * prefijan con el identificador de la organización: un dato cifrado para una organización
 * no se descifra en otra.
 */
export interface TenantCrypto {
  seal(purpose: string, data: Buffer): string;
  open(purpose: string, sealed: string): Buffer;
  /** HMAC-SHA256 (hex) con una clave derivada de la DEK para `purpose` (p. ej. IP, D-78). */
  hmac(purpose: string, data: string): string;
}

/** Acceso a la base de una organización con SUS credenciales de aplicación. */
export interface TenantHandle {
  info: TenantInfo;
  db: Kysely<TenantDatabase>;
  audit: AuditLogRepository;
  crypto: TenantCrypto;
}

/**
 * Cifrado y HMAC con la DEK de la organización. La derivación es la MISMA que en 2B: con la
 * DEK ya desenvuelta (D-87 precisada por D-88) la API abre los secretos MFA cifrados antes
 * y calcula los mismos HMAC, sin que nadie reconfigure su MFA.
 */
export function tenantCrypto(tenantId: string, dek: SymmetricKey): TenantCrypto {
  const ctx = (purpose: string): string => `tenant:${tenantId}:app:${purpose}`;
  const hmacKeys = new Map<string, Buffer>();
  return {
    seal: (purpose, data) => seal(dek, data, ctx(purpose)),
    open: (purpose, sealed) => open([dek], sealed, ctx(purpose)),
    hmac: (purpose, data) => {
      let key = hmacKeys.get(purpose);
      if (key === undefined) {
        key = Buffer.from(hkdfSync('sha256', dek.material, Buffer.alloc(0), `hmac|${ctx(purpose)}`, 32));
        hmacKeys.set(purpose, key);
      }
      return createHmac('sha256', key).update(data, 'utf8').digest('hex');
    },
  };
}

/**
 * Abre la base de una organización con las credenciales indicadas y comprueba que la base
 * se declare como ESA organización (defensa contra enrutamiento erróneo o archivos de
 * secretos de otra instalación).
 */
export async function openTenantHandle(server: DbServerConfig, info: TenantInfo, dek: SymmetricKey, maxConnections?: number): Promise<TenantHandle> {
  const db = connect<TenantDatabase>(server, info.dbName, maxConnections);
  try {
    const org = await db.selectFrom('organization').select(['id', 'slug']).executeTakeFirst();
    if (org?.id !== info.id || org.slug !== info.slug) {
      throw new Error(`La base ${info.dbName} no corresponde a la organización "${info.slug}".`);
    }
  } catch (error) {
    await db.destroy();
    throw error;
  }
  return { info, db, audit: new AuditLogRepository(db, server.engine, info.slug), crypto: tenantCrypto(info.id, dek) };
}

/** Datos no secretos de la organización que la API recibe por configuración (D-87). */
export interface OrganizationDescriptor {
  id: string;
  slug: string;
  name: string;
  dbName: string;
  dbUser: string;
  /** Identificador de la DEK (no secreto): permite detectar un archivo de DEK equivocado. */
  dekId: string;
}

/**
 * Acceso de la API a SU organización (una por instalación, D-84), sin clave maestra ni base
 * de control (D-87 precisada por D-88). Recibe la contraseña de la base de la organización
 * y la DEK ya desenvuelta, que escribe `auditor-admin api-secrets write`.
 *
 * La conexión se abre una vez y se reutiliza. Si la organización se suspende, el motor
 * rechaza las conexiones de su usuario y cierra las abiertas: las consultas fallan y la API
 * responde con un error, sin datos (falla segura).
 */
export class OrganizationDirectory {
  private handle: Promise<TenantHandle> | undefined;

  constructor(
    private readonly server: Omit<DbServerConfig, 'user' | 'password'>,
    private readonly organization: OrganizationDescriptor,
    private readonly password: string,
    private readonly dek: SymmetricKey,
  ) {
    assertTenantSlug(organization.slug);
    assertTenantName(organization.name);
    if (dek.id !== organization.dekId) {
      throw new Error('La DEK recibida no corresponde a la organización configurada (dekId distinto). Vuelva a ejecutar: auditor-admin api-secrets write.');
    }
  }

  /** Datos públicos de la organización configurada. */
  get info(): TenantInfo {
    const o = this.organization;
    return { id: o.id, slug: o.slug, name: o.name, status: 'active', dbName: o.dbName, createdAt: '' };
  }

  /** Abre (o reutiliza) la conexión. Si la apertura falla, el siguiente llamado reintenta. */
  open(): Promise<TenantHandle> {
    this.handle ??= openTenantHandle({ ...this.server, user: this.organization.dbUser, password: this.password }, this.info, this.dek).catch((error: unknown) => {
      this.handle = undefined;
      throw error;
    });
    return this.handle;
  }

  async close(): Promise<void> {
    const pending = this.handle;
    this.handle = undefined;
    if (pending !== undefined) await (await pending.catch(() => undefined))?.db.destroy();
  }
}
