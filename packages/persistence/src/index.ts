// SPDX-License-Identifier: AGPL-3.0-or-later

export { AuditLogRepository } from './audit-log-repository.js';
export { defaultPort, loadPlatformDbConfig, type DbEngine, type DbServerConfig, type DbTlsMode, type PlatformDbConfig } from './config.js';
export { connect, serverAdminDatabase } from './connection.js';
export { migrateToLatest } from './migrate.js';
export { assertControlDatabaseName, assertTenantName, assertTenantSlug, newTenantResourceNames, tenantResourceNames, type TenantResourceNames } from './naming.js';
export { provisionerFor, type Provisioner } from './provisioner.js';
export { ATTACK_ALERT_ORIGIN, IDENTITY_TABLES, type AccessLogTable, type LoginThrottleTable, type ThrottleKind, type ActivationTokenTable, type AppUserTable, type ControlDatabase, type RecoveryCodeTable, type SessionStage, type TenantDatabase, type TenantStatus, type UserRoleTable, type UserSessionTable, type UserStatus } from './schema.js';
export { OrganizationDirectory, openTenantHandle, tenantCrypto, type OrganizationDescriptor, type TenantCrypto, type TenantHandle, type TenantInfo } from './tenant-handle.js';
export { TenantManager, type ApiSecrets, type OperationResult, type TenantManagerOptions, type TenantMigrationResult } from './tenant-manager.js';
