// SPDX-License-Identifier: AGPL-3.0-or-later

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';

/**
 * Cifrado de sobre (decisión D-12).
 *
 * - Una **clave maestra** por instalación, leída desde un archivo montado (nunca desde
 *   variables de entorno ni desde la base de datos).
 * - Una **clave de datos (DEK)** por organización, guardada solo envuelta (cifrada) con la
 *   clave maestra.
 * - Los secretos de cada organización (p. ej. la contraseña de su base de datos) se
 *   cifran con su DEK.
 *
 * Se usa AES-256-GCM: confidencialidad e integridad en una sola operación. Todo cifrado
 * lleva un **contexto** (datos asociados, AAD) que identifica a qué pertenece: un texto
 * cifrado copiado a otra organización o a otro campo no se descifra. Esto evita que un
 * atacante con acceso de escritura a la base de control intercambie secretos entre
 * organizaciones.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = 'v1';

/** Clave simétrica con identificador público derivado de su contenido. */
export interface SymmetricKey {
  /** Identificador corto (no secreto) para saber con qué clave se cifró. */
  readonly id: string;
  readonly material: Buffer;
}

/** Error de cifrado o descifrado. Nunca incluye material de claves ni texto plano. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

/** Identificador de clave: primeros 16 caracteres hexadecimales de SHA-256 del material. */
function keyIdOf(material: Buffer): string {
  return createHash('sha256').update(material).digest('hex').slice(0, 16);
}

/**
 * Construye una clave a partir de su material.
 * @throws {CryptoError} si el material no tiene exactamente 32 bytes.
 */
export function keyFromMaterial(material: Buffer): SymmetricKey {
  if (material.length !== KEY_BYTES) {
    throw new CryptoError(`La clave debe tener ${KEY_BYTES} bytes (tiene ${material.length}).`);
  }
  return { id: keyIdOf(material), material: Buffer.from(material) };
}

/** Genera una clave aleatoria nueva (para DEK de organizaciones y pruebas). */
export function generateKey(): SymmetricKey {
  return keyFromMaterial(randomBytes(KEY_BYTES));
}

/**
 * Carga la clave maestra desde un archivo que contiene 32 bytes codificados en base64.
 *
 * Por defecto rechaza archivos legibles por "otros" en el sistema: la clave maestra
 * protege los secretos de todas las organizaciones (riesgo R-27).
 *
 * `checkPermissions: false` existe solo para contenedores: Docker Compose monta el
 * archivo con los permisos del anfitrión y el usuario del contenedor es otro, así que el
 * archivo debe ser legible; la protección real está en el directorio del anfitrión
 * (`deploy/compose/secrets`, permisos 700, ver `scripts/generate-secrets.sh`).
 *
 * @throws {CryptoError} si el archivo no existe, tiene permisos inseguros o formato inválido.
 */
export function loadMasterKey(path: string, options: { checkPermissions?: boolean } = {}): SymmetricKey {
  const check = options.checkPermissions ?? true;
  let content: string;
  let fd: number | undefined;
  try {
    // Se abre UNA vez y todas las comprobaciones se hacen sobre el descriptor abierto
    // (fstat), no sobre la ruta: así el archivo comprobado es exactamente el que se lee y
    // no hay carrera entre comprobar y leer (alerta CodeQL js/file-system-race).
    // Con la comprobación activa, O_NOFOLLOW hace fallar la apertura de un enlace
    // simbólico (otro usuario podría redirigir la lectura, hallazgo QA B-09).
    try {
      // O_NONBLOCK evita que la apertura de una tubería con nombre (FIFO) quede esperando
      // indefinidamente; en archivos regulares no tiene efecto. Luego fstat la rechaza.
      const flags = constants.O_RDONLY | constants.O_NONBLOCK;
      fd = openSync(path, check ? flags | constants.O_NOFOLLOW : flags);
    } catch (error) {
      if (check && (error as NodeJS.ErrnoException).code === 'ELOOP') {
        throw new CryptoError(`El archivo de clave maestra no puede ser un enlace simbólico: ${path}`);
      }
      throw error;
    }
    const info = fstatSync(fd);
    if (!info.isFile()) throw new CryptoError(`La clave maestra debe ser un archivo regular: ${path}`);
    if (check && (info.mode & 0o077) !== 0) {
      throw new CryptoError(`Permisos inseguros en ${path}: la clave maestra solo debe ser legible por su dueño (chmod 600).`);
    }
    content = readFileSync(fd, 'utf8').trim();
  } catch (error) {
    if (error instanceof CryptoError) throw error;
    throw new CryptoError(`No se pudo leer el archivo de clave maestra: ${path}`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (!/^[A-Za-z0-9+/]{43}=$/.test(content)) {
    throw new CryptoError('La clave maestra debe ser 32 bytes en base64 (44 caracteres).');
  }
  return keyFromMaterial(Buffer.from(content, 'base64'));
}

/** Codifica una nueva clave maestra para guardarla en archivo. */
export function encodeKeyForFile(key: SymmetricKey): string {
  return key.material.toString('base64') + '\n';
}

/**
 * Cifra datos con una clave y un contexto obligatorio.
 *
 * Formato del resultado (texto): `v1.<idClave>.<iv>.<etiqueta>.<cifrado>` en base64url.
 *
 * @param key clave a usar.
 * @param plaintext datos a cifrar.
 * @param context identifica dueño y propósito, p. ej. `tenant:<id>:db-password`.
 */
export function seal(key: SymmetricKey, plaintext: Buffer, context: string): string {
  if (context.length === 0) throw new CryptoError('El contexto de cifrado es obligatorio.');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key.material, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(`${FORMAT}|${key.id}|${context}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [FORMAT, key.id, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Decodifica base64url sin relleno; devuelve null si el texto no es su forma canónica. */
function decodeBase64UrlStrict(text: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const bytes = Buffer.from(text, 'base64url');
  return bytes.toString('base64url') === text ? bytes : null;
}

/**
 * Descifra un sobre producido por `seal`.
 *
 * @param keys claves disponibles (permite rotación: se elige por identificador).
 * @throws {CryptoError} si el formato es inválido, la clave no está disponible, el
 *   contexto no coincide o el contenido fue alterado. El mensaje no distingue entre
 *   estas dos últimas causas a propósito.
 */
export function open(keys: readonly SymmetricKey[], sealed: string, context: string): Buffer {
  const parts = sealed.split('.');
  if (parts.length !== 5 || parts[0] !== FORMAT) throw new CryptoError('Formato de texto cifrado inválido.');
  const [, keyId, ivText, tagText, ctText] = parts as [string, string, string, string, string];
  const key = keys.find((k) => k.id === keyId);
  if (key === undefined) throw new CryptoError(`No está disponible la clave ${keyId} para descifrar.`);
  // Solo se acepta base64url canónico (hallazgo QA B-11): un mismo sobre tiene una única
  // representación textual.
  const iv = decodeBase64UrlStrict(ivText);
  const tag = decodeBase64UrlStrict(tagText);
  const ciphertext = decodeBase64UrlStrict(ctText);
  if (iv === null || tag === null || ciphertext === null || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new CryptoError('Formato de texto cifrado inválido.');
  try {
    const decipher = createDecipheriv(ALGORITHM, key.material, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(`${FORMAT}|${key.id}|${context}`, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new CryptoError('No se pudo descifrar: contexto incorrecto o contenido alterado.');
  }
}

/** Envuelve (cifra) una DEK con la clave maestra. */
export function wrapKey(masterKey: SymmetricKey, dek: SymmetricKey, context: string): string {
  return seal(masterKey, dek.material, `dek|${context}`);
}

/** Desenvuelve una DEK cifrada con `wrapKey`. */
export function unwrapKey(masterKeys: readonly SymmetricKey[], wrapped: string, context: string): SymmetricKey {
  return keyFromMaterial(open(masterKeys, wrapped, `dek|${context}`));
}
