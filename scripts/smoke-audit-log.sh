#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Prueba de extremo a extremo de la CLI compilada de la bitácora:
# íntegra → código 0; reescrita frente a anclaje externo (PT-21) → código 1.
set -eu
CLI="packages/audit-log/dist/cli.js"
D="$(mktemp -d)"
trap 'rm -rf "$D"' EXIT

node --input-type=module -e "
import { createEntry, toJsonl } from './packages/audit-log/dist/index.js';
const e = [];
for (let i = 0; i < 5; i++) e.push(createEntry(e.at(-1) ?? null, 'tenant-sintetico', { actor: 'usuario-sintetico', action: 'smoke', object: 'o/' + i }));
process.stdout.write(toJsonl(e));" > "$D/bitacora.jsonl"

node "$CLI" keygen --out-dir "$D" --key-id smoke
node "$CLI" anchor --entries "$D/bitacora.jsonl" --private-key "$D/smoke.private.pem" --key-id smoke --out "$D/anclajes.jsonl"
node "$CLI" verify --entries "$D/bitacora.jsonl" --anchors "$D/anclajes.jsonl" --public-key "smoke=$D/smoke.public.pem"

# Reescritura completa y coherente: debe detectarse solo gracias al anclaje.
node --input-type=module -e "
import { createEntry, toJsonl } from './packages/audit-log/dist/index.js';
const e = [];
for (let i = 0; i < 5; i++) e.push(createEntry(e.at(-1) ?? null, 'tenant-sintetico', { actor: 'atacante', action: 'smoke', object: 'o/' + i }));
process.stdout.write(toJsonl(e));" > "$D/bitacora.jsonl"

if node "$CLI" verify --entries "$D/bitacora.jsonl" --anchors "$D/anclajes.jsonl" --public-key "smoke=$D/smoke.public.pem"; then
  echo "ERROR: la reescritura no fue detectada" >&2
  exit 1
fi
echo "OK: reescritura detectada por el anclaje externo."
