#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# ZAP baseline (escaneo pasivo de OWASP ZAP) contra el entorno efímero de Compose, con el
# proxy real (Caddy) delante de la SPA y la API (09-seguridad.md; 2C §2.5).
#
# Uso: sh scripts/zap-baseline.sh <url-objetivo> [directorio-de-salida]
#
# - Se usa la imagen oficial de ZAP. ZAP_IMAGE la fija por digest (P-13); ver la nota en
#   docs/fase-2/2c2-registro.md (parte frontend) sobre cómo se obtuvo.
# - El escaneo "baseline" es pasivo: recorre el sitio (araña clásica y araña AJAX, porque la
#   interfaz es una SPA) y revisa respuestas; no ataca.
# - Bloquea SOLO ante alertas de riesgo ALTO (regla de 09-seguridad.md): las demás se
#   informan como anotaciones. Las reglas ignoradas están en deploy/zap/baseline.conf, cada
#   una con su justificación.
set -eu
TARGET="${1:?Uso: sh scripts/zap-baseline.sh <url-objetivo> [directorio-de-salida]}"
OUT="${2:-zap-out}"
ZAP_IMAGE="${ZAP_IMAGE:-ghcr.io/zaproxy/zaproxy:stable}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$OUT"
# El contenedor de ZAP escribe con su propio usuario (zap, uid 1000).
chmod 777 "$OUT"
cp "$ROOT/deploy/zap/baseline.conf" "$OUT/baseline.conf"
chmod 644 "$OUT/baseline.conf"

docker pull -q "$ZAP_IMAGE" >/dev/null
echo "::notice title=zap-imagen::$ZAP_IMAGE -> $(docker image inspect --format '{{index .RepoDigests 0}}' "$ZAP_IMAGE" 2>/dev/null || echo 'sin digest')"

# --network host: el objetivo escucha solo en 127.0.0.1 del anfitrión (perfil local).
# -I: las advertencias no cambian el código de salida; el bloqueo lo decide el paso
# siguiente según el riesgo. Código 3 = error del propio ZAP (falla).
set +e
docker run --rm --network host -v "$(cd "$OUT" && pwd):/zap/wrk:rw" "$ZAP_IMAGE" \
  zap-baseline.py -t "$TARGET" -c baseline.conf -j -m 2 -I -J zap-report.json -w zap-report.md
RC=$?
set -e
if [ "$RC" -ne 0 ] && [ "$RC" -ne 2 ]; then
  echo "::error title=zap::zap-baseline.py terminó con código $RC (error del escaneo)"
  exit 1
fi
node "$ROOT/scripts/zap-report.mjs" "$OUT/zap-report.json" "$OUT/baseline.conf"
