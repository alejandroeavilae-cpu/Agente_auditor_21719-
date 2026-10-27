// SPDX-License-Identifier: AGPL-3.0-or-later

export {
  CryptoError,
  encodeKeyForFile,
  generateKey,
  keyFromMaterial,
  loadMasterKey,
  open,
  seal,
  unwrapKey,
  wrapKey,
  type SymmetricKey,
} from './envelope.js';
export { generateDbPassword } from './passwords.js';
