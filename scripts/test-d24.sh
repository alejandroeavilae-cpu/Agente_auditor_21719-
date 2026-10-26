#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# PT-17: demuestra que la regla de bloqueo D-24 falla ante un hallazgo alto con
# corrección disponible y pasa sin hallazgos, usando informes Trivy sintéticos.
set -eu
if node scripts/ci-report-trivy.mjs scripts/fixtures/trivy-con-hallazgo.json prueba-d24 > /dev/null; then
  echo "ERROR: la regla D-24 no bloqueó un hallazgo HIGH con corrección" >&2
  exit 1
fi
node scripts/ci-report-trivy.mjs scripts/fixtures/trivy-sin-hallazgos.json prueba-d24 > /dev/null
echo "OK: D-24 bloquea con hallazgos y permite sin hallazgos."
