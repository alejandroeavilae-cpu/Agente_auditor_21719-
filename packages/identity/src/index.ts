// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  checkPasswordPolicy,
  DEFAULT_ARGON2_PARAMS,
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyAgainstDummy,
  verifyPassword,
  type Argon2Params,
  type PasswordIssue,
  type VerifyResult,
} from './password.js';
export {
  FORBIDDEN_ROLE_PAIRS,
  isRole,
  MFA_REQUIRED_ROLES,
  PERMISSIONS,
  permissionsOf,
  requiresMfa,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
  validateRoleSet,
  type Permission,
  type Role,
} from './rbac.js';
export { hashToken, newRecoveryCodes, newToken, normalizeRecoveryCode, TOKEN_FORMAT } from './tokens.js';
export { base32Encode, generateTotpSecret, otpauthUri, totpAt, totpForStep, totpStep, verifyTotp, type TotpAlgorithm, type TotpOptions } from './totp.js';
