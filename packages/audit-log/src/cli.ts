#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CLI de verificación independiente de la bitácora (sección 15.3).
 *
 * Diseñada para que una organización pueda comprobar la integridad de su
 * bitácora sin usar la interfaz de la plataforma: solo necesita Node.js,
 * el archivo exportado (JSONL) y, opcionalmente, sus anclajes y la clave pública.
 *
 * Códigos de salida: 0 = íntegra · 1 = problemas de integridad · 2 = error de uso o lectura.
 */

import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createAnchor, loadPublicKey, verifyAgainstAnchors } from './anchor.js';
import { auditEntrySchema, verifyChain, type ChainIssue } from './chain.js';
import { parseJsonl, toJsonl } from './jsonl.js';

const USAGE = `Uso:
  auditor-log verify --entries <bitacora.jsonl> [--chain-id <id>]
                     [--anchors <anclajes.jsonl> --public-key <keyId>=<clave.pem> ...]
  auditor-log keygen --out-dir <directorio> --key-id <id>
  auditor-log anchor --entries <bitacora.jsonl> --private-key <privada.pem> --key-id <id> --out <anclajes.jsonl>

Códigos de salida: 0 íntegra, 1 problemas de integridad, 2 error de uso.`;

class UsageError extends Error {}

function readText(path: string): string {
  if (!existsSync(path)) throw new UsageError(`No existe el archivo: ${path}`);
  return readFileSync(path, 'utf8');
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
  if ((values.anchors === undefined) !== (values['public-key'] === undefined)) {
    throw new UsageError('--anchors y --public-key deben usarse juntos.');
  }

  const raw = parseJsonl(readText(values.entries));
  const result = verifyChain(raw, values['chain-id']);
  console.log(`Entradas leídas: ${result.count}`);
  console.log(`Último seq: ${result.lastSeq ?? '(vacía)'} · Último hash: ${result.lastHash}`);

  let issues = [...result.issues];
  if (issues.length > 0) printIssues('Problemas de integridad interna:', issues);

  if (values.anchors !== undefined && values['public-key'] !== undefined) {
    // Formato "keyId=ruta.pem"; puede repetirse para cubrir rotaciones de clave.
    const keys = new Map(
      values['public-key'].map((pair) => {
        const sep = pair.indexOf('=');
        if (sep <= 0) throw new UsageError(`--public-key debe tener la forma keyId=ruta.pem (recibido: ${pair})`);
        return [pair.slice(0, sep), loadPublicKey(readText(pair.slice(sep + 1)))] as const;
      }),
    );
    const anchors = parseJsonl(readText(values.anchors));
    const entries = raw.flatMap((r) => {
      const p = auditEntrySchema.safeParse(r);
      return p.success ? [p.data] : [];
    });
    const anchorIssues = verifyAgainstAnchors(entries, anchors, keys);
    console.log(`Anclajes leídos: ${anchors.length}`);
    if (anchorIssues.length > 0) printIssues('Problemas frente a los anclajes externos:', anchorIssues);
    issues = issues.concat(anchorIssues);
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
  if (values['out-dir'] === undefined || values['key-id'] === undefined) {
    throw new UsageError('Faltan --out-dir o --key-id.');
  }
  const privatePath = join(values['out-dir'], `${values['key-id']}.private.pem`);
  const publicPath = join(values['out-dir'], `${values['key-id']}.public.pem`);
  if (existsSync(privatePath) || existsSync(publicPath)) {
    // Nunca sobrescribimos claves: perder una clave privada impediría nuevos anclajes
    // verificables con la clave pública que la organización ya distribuyó.
    throw new UsageError('Ya existe una clave con ese key-id; no se sobrescribe.');
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
  writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
  console.log(`Clave privada: ${privatePath} (permisos 600; guárdela fuera de la base de datos)`);
  console.log(`Clave pública: ${publicPath} (distribúyala a quien verifique)`);
  return 0;
}

function cmdAnchor(args: string[]): number {
  const { values } = parseArgs({
    args,
    options: {
      entries: { type: 'string' },
      'private-key': { type: 'string' },
      'key-id': { type: 'string' },
      out: { type: 'string' },
    },
    strict: true,
  });
  if (!values.entries || !values['private-key'] || !values['key-id'] || !values.out) {
    throw new UsageError('Faltan --entries, --private-key, --key-id o --out.');
  }
  const raw = parseJsonl(readText(values.entries));
  const result = verifyChain(raw);
  if (!result.ok) {
    // No se ancla una cadena que ya está rota: el anclaje legitimaría la alteración.
    printIssues('No se ancla: la cadena tiene problemas de integridad:', result.issues);
    return 1;
  }
  const last = auditEntrySchema.parse(raw.at(-1));
  const anchor = createAnchor(last, createPrivateKey(readText(values['private-key'])), values['key-id']);
  writeFileSync(values.out, toJsonl([anchor]), { flag: 'a' });
  console.log(`Anclaje agregado a ${values.out}: seq ${anchor.seq}, hash ${anchor.hash}`);
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
