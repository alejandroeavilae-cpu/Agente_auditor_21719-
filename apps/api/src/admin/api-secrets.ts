// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomBytes } from 'node:crypto';
import { closeSync, constants, fsyncSync, lstatSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { encodeKeyForFile } from '@auditor-21719/crypto';
import type { ApiSecrets } from '@auditor-21719/persistence';

/**
 * Nombres de los archivos que la API lee (D-87 precisada por D-88). Coinciden con
 * `deploy/compose/compose.yaml` y con las variables `ORGANIZATION_*_FILE`.
 */
export const API_SECRET_FILES = {
  organization: 'organization.json',
  dbPassword: 'organization_db_password',
  dek: 'organization_dek',
} as const;

/**
 * Escribe un archivo con permisos 0600 sin carreras:
 * - se crea un temporal NUEVO en el mismo directorio con O_EXCL y O_NOFOLLOW (nunca se
 *   escribe a través de un enlace ni sobre un archivo que alguien haya preparado);
 * - se fuerza a disco y se RENOMBRA sobre el destino: el cambio es atómico, quien lee ve el
 *   archivo anterior completo o el nuevo completo, y si el destino era un enlace simbólico
 *   se reemplaza el enlace, no el archivo al que apuntaba.
 */
function writeAtomic(dir: string, name: string, content: string): void {
  const tmp = join(dir, `.${name}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try {
      writeSync(fd, content);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, join(dir, name));
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // El temporal ya no existe (p. ej. se renombró): nada que limpiar.
    }
    throw error;
  }
}

/**
 * Comprueba el directorio de destino: debe existir, no ser un enlace simbólico ni poder
 * modificarlo el grupo u otros usuarios. Se llama también ANTES de rotar una contraseña, para no
 * dejar la base con una contraseña nueva que no se pudo entregar a la API.
 */
export function checkSecretsDir(dir: string): void {
  let info;
  try {
    info = lstatSync(dir);
  } catch {
    throw new Error(`No existe el directorio de secretos: ${dir}`);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`El destino debe ser un directorio (no un enlace): ${dir}`);
  // Un directorio que el grupo u otros usuarios pueden escribir les permitiría reemplazar los
  // archivos después (p. ej. con una DEK o una contraseña propias) (QA 2C1-08).
  if ((info.mode & 0o022) !== 0) throw new Error(`El directorio ${dir} puede ser modificado por otros usuarios o por su grupo; use uno con permisos 700.`);
}

/**
 * Escribe los secretos de la API en `dir`: datos de la organización, contraseña de su base
 * y DEK desenvuelta, cada uno con permisos 0600. No devuelve nada a propósito: quien llama
 * informa solo los nombres constantes de `API_SECRET_FILES`, y así ningún dato que se
 * imprima deriva de los secretos (alerta CodeQL js/clear-text-logging).
 */
export function writeApiSecrets(dir: string, secrets: ApiSecrets): void {
  checkSecretsDir(dir);
  const files: [string, string][] = [
    [API_SECRET_FILES.organization, `${JSON.stringify(secrets.organization, null, 2)}\n`],
    [API_SECRET_FILES.dbPassword, `${secrets.dbPassword}\n`],
    [API_SECRET_FILES.dek, encodeKeyForFile(secrets.dek)],
  ];
  for (const [name, content] of files) writeAtomic(dir, name, content);
}
