// SPDX-License-Identifier: AGPL-3.0-or-later

export { AuditLogRepository } from './audit-log-repository.js';
export { defaultPort, loadPlatformDbConfig, type DbEngine, type DbServerConfig, type DbTlsMode, type PlatformDbConfig } from './config.js';
export { connect, serverAdminDatabase } from './connection.js';
export { migrateToLatest } from './migrate.js';
export { assertTenantSlug, tenantDatabaseName, tenantLoginName } from './naming.js';
export type { ControlDatabase, TenantDatabase, TenantStatus } from './schema.js';
export { TenantManager, type TenantHandle, type TenantInfo } from './tenant-manager.js';
