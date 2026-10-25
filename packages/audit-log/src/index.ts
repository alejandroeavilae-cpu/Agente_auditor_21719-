// SPDX-License-Identifier: AGPL-3.0-or-later

export { canonicalJson, type JsonValue } from './canonical-json.js';
export {
  GENESIS_HASH,
  auditEntrySchema,
  computeEntryHash,
  createEntry,
  verifyChain,
  type AuditEntry,
  type AuditEntryInput,
  type ChainIssue,
  type ChainVerification,
} from './chain.js';
export {
  anchorSchema,
  createAnchor,
  loadPublicKey,
  verifyAgainstAnchors,
  verifyAnchorSignature,
  type Anchor,
} from './anchor.js';
export { JsonlParseError, parseJsonl, toJsonl } from './jsonl.js';
