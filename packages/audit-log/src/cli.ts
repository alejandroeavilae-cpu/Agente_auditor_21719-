#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CLI de verificación independiente de la bitácora (sección 15.3).
 *
 * Diseñada para que una organización compruebe la integridad de su bitácora sin usar
 * la interfaz de la plataforma: solo necesita Node.js, el archivo exportado (JSONL)
 * y, para detectar reescrituras completas, sus anclajes y la clave pública.
 *
 * Códigos de salida: 0 = íntegra · 1 = problemas de integridad · 2 = error de uso o lectura.
 */

import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { closeSync, constants, existsSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createAnchor, loadPublicKey, verifyAnchorItems } from './anchor.js';
import { verifyChainItems, type ChainIssue } from './chain.js';
import { parseJsonlLines, toJsonl } from './jsonl.js';

const USAGE = `Uso:
  auditor-log verify --entries <bitacora.jsonl> --chain-id <id>
                     [--anchors <anclajes.jsonl> --public-key <keyId>=<clave.pem> ...]
  auditor-log keygen --out-dir <directorio> --key-id <id>
  auditor-log anchor --entries <bitacora.jsonl> --chain-id <id> --private-key <privada.pem> --key-id <id> --out <anclajes.jsonl>

<id> de clave: letras, dígitos, punto, guion o guion bajo (1 a 64 caracteres).
Códigos de salida: 0 íntegra, 1 problemas de integridad, 2 error de uso.`;

/** Identificadores de clave seguros para usarse como nombre de archivo (hallazgo QA H-06). */
const KEY_ID = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,64}$/;

class UsageError extends Error {}

function readText(path: string): string {
  if (!existsSync(path)) throw new UsageError(`No existe el archivo: ${path}`);
  return readFileSync(path, 'utf8');
}

function requireKeyId(value: string | undefined): string {
  if (value === undefined || !KEY_ID.test(value)) {
    throw new UsageError('--key-id inválido: use solo letras, dígitos, ".", "-" o "_" (máx. 64).');
  }
  return value;
}

/**
 * Escribe sin seguir enlaces simbólicos: quien tenga acceso a la carpeta no puede
 * redirigir la escritura a otro archivo del sistema (hallazgo QA H-06).
 *
 * @param mode "create" falla si el archivo existe; "append" agrega al final.
 */
function writeFileSafely(path: string, content: string, mode: 'append' | 'create', permissions: number): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new UsageError(`Se rechaza escribir en un enlace simbólico: ${path}`);
  }
  const flags =
    constants.O_WRONLY |
    constants.O_NOFOLLOW |
    constants.O_CREAT |
    (mode === 'append' ? constants.O_APPEND : constants.O_EXCL);
  const fd = openSync(path, flags, permissions);
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

function printIssues(title: string, issues: readonly ChainIssue[]): void {
  console.log(title);
  for (const issue of issues) {
    const where = issue.seq === null ? `línea ${issue.line}` : `seq ${issue.seq} (línea ${issue.line})`;
    console.log(`  - ${where}: ${issue.reason}`);
  }
}

function cmdVerify(args: string[]): number {
  const { values } = parseArgs({
    args,
    options: {
      entries: { type: 'string' },
      'chain-id': { type: 'string' },
      anchors: { type: 'string' },
      'public-key': { type: 'string', multiple: true },
    },
    strict: true,
  });
  if (values.entries === undefined) throw new UsageError('Falta --entries.');
  // Obligatorio: sin él, la bitácora completa de otro tenant pasaría como válida (H-05).
  const chainId = values['chain-id'];
  if (chainId === undefined || chainId === '') throw new UsageError('Falta --chain-id.');
  if ((values.anchors === undefined) !== (values['public-key'] === undefined)) {
    throw new UsageError('--anchors y --public-key deben usarse juntos.');
  }

  const result = verifyChainItems(parseJsonlLines(readText(values.entries)), chainId);
  console.log(`Cadena: ${chainId}`);
  console.log(`Entradas leídas: ${result.count}`);
  console.log(`Último seq: ${result.lastSeq ?? '(vacía)'} · Último hash: ${result.lastHash}`);

  let issues = [...result.issues];
  if (result.count === 0) {
    // Una bitácora vacía no es evidencia de integridad: pudo haber sido vaciada (H-04).
    issues.push({ seq: null, line: 0, reason: 'La bitácora está vacía: no hay nada que verificar' });
  }
  if (issues.length > 0) printIssues('Problemas de integridad interna:', issues);

  if (values.anchors !== undefined && values['public-key'] !== undefined) {
    // Formato "keyId=ruta.pem"; puede repetirse para cubrir rotaciones de clave.
    const keys = new Map(
      values['public-key'].map((pair) => {
        const sep = pair.indexOf('=');
        if (sep <= 0) throw new UsageError(`--public-key debe tener la forma keyId=ruta.pem (recibido: ${pair})`);
        return [requireKeyId(pair.slice(0, sep)), loadPublicKey(readText(pair.slice(sep + 1)))] as const;
      }),
    );
    const anchors = parseJsonlLines(readText(values.anchors));
    console.log(`Anclajes leídos: ${anchors.length}`);
    const anchorIssues = verifyAnchorItems(result.entries, anchors, keys);
    if (anchors.length === 0) {
      // Un archivo de anclajes vacío no protege contra reescrituras: no se informa "íntegra" (H-04).
      anchorIssues.push({ seq: null, line: 0, reason: 'El archivo de anclajes está vacío' });
    }
    if (anchorIssues.length > 0) printIssues('Problemas frente a los anclajes externos:', anchorIssues);
    issues = issues.concat(anchorIssues);
    console.log('Aviso: las entradas posteriores al último anclaje no están protegidas contra truncamiento (R-26).');
  } else {
    console.log('Aviso: sin anclajes externos no se puede detectar una reescritura completa de la bitácora (R-26).');
  }

  console.log(issues.length === 0 ? 'RESULTADO: bitácora íntegra.' : `RESULTADO: ${issues.length} problema(s) de integridad.`);
  return issues.length === 0 ? 0 : 1;
}

function cmdKeygen(args: string[]): number {
  const { values } = parseArgs({
    args,
    options: { 'out-dir': { type: 'string' }, 'key-id': { type: 'string' } },
    strict: true,
  });
  if (values['out-dir'] === undefined) throw new UsageError('Falta --out-dir.');
  const keyId = requireKeyId(values['key-id']);
  const dir = resolve(values['out-dir']);
  const privatePath = join(dir, `${keyId}.private.pem`);
  const publicPath = join(dir, `${keyId}.public.pem`);
  if (existsSync(privatePath) || existsSync(publicPath)) {
    // Nunca sobrescribimos claves: perder una clave privada impediría nuevos anclajes
    // verificables con la clave pública que la organización ya distribuyó.
    throw new UsageError('Ya existe una clave con ese key-id; no se sobrescribe.');
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSafely(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 'create', 0o600);
  writeFileSafely(publicPath, publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'create', 0o644);
  console.log(`Clave privada: ${privatePath} (permisos 600; guárdela fuera de la base de datos)`);
  console.log(`Clave pública: ${publicPath} (distribúyala a quien verifique)`);
  return 0;
}

function cmdAnchor(args: string[]): number {
  const { values } = parseArgs({
    args,
    options: {
      entries: { type: 'string' },
      'chain-id': { type: 'string' },
      'private-key': { type: 'string' },
      'key-id': { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (!values.entries || !values['chain-id'] || !values['private-key'] || !values.out) {
    throw new UsageError('Faltan --entries, --chain-id, --private-key o --out.');
  }
  const keyId = requireKeyId(values['key-id']);
  const result = verifyChainItems(parseJsonlLines(readText(values.entries)), values['chain-id']);
  if (!result.ok) {
    // No se ancla una cadena que ya está rota: el anclaje legitimaría la alteración.
    printIssues('No se ancla: la cadena tiene problemas de integridad:', result.issues);
    return 1;
  }
  const last = result.entries.at(-1);
  if (last === undefined) {
    console.log('No se ancla: la bitácora está vacía.');
    return 1;
  }
  const anchor = createAnchor(last, createPrivateKey(readText(values['private-key'])), keyId);
  writeFileSafely(values.out, toJsonl([anchor]), 'append', 0o644);
  console.log(`Anclaje agregado a ${values.out}: cadena ${anchor.chainId}, seq ${anchor.seq}, hash ${anchor.hash}`);
  return 0;
}

export function main(argv: string[]): number {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'verify':
        return cmdVerify(rest);
      case 'keygen':
        return cmdKeygen(rest);
      case 'anchor':
        return cmdAnchor(rest);
      default:
        console.log(USAGE);
        return command === undefined || command === '--help' ? 0 : 2;
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof UsageError) console.error(USAGE);
    return 2;
  }
}

// Solo se ejecuta como programa (incluido vía enlace simbólico de `bin`);
// al importarse desde pruebas no hace nada.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
