// SPDX-License-Identifier: AGPL-3.0-or-later

export { AuditLogRepository } from './audit-log-repository.js';
export { defaultPort, loadPlatformDbConfig, type DbEngine, type DbServerConfig, type DbTlsMode, type PlatformDbConfig } from './config.js';
export { connect, serverAdminDatabase } from './connection.js';
export { migrateToLatest } from './migrate.js';
export { assertControlDatabaseName, assertTenantName, assertTenantSlug, newTenantResourceNames, tenantResourceNames, type TenantResourceNames } from './naming.js';
export { provisionerFor, type Provisioner } from './provisioner.js';
export type { ControlDatabase, TenantDatabase, TenantStatus } from './schema.js';
export {
  TenantManager,
  type OperationResult,
  type TenantHandle,
  type TenantInfo,
  type TenantManagerOptions,
  type TenantMigrationResult,
} from './tenant-manager.js';
