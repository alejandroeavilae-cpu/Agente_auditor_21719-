#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Entrega a la API los secretos de su organización (D-87 precisada por D-88) en el perfil
# Compose: datos de la organización, contraseña de su base y su DEK desenvuelta.
#
# Uso:
#   sh scripts/write-api-secrets.sh <organización>            escribe los secretos
#   sh scripts/write-api-secrets.sh <organización> --rotate   cambia la contraseña de la base
#                                                              y reescribe los secretos
# Después, (re)inicie la API:
#   docker compose -f deploy/compose/compose.yaml up -d --force-recreate --wait api
#
# La CLI (servicio "admin", el único con la clave maestra) escribe los archivos con permisos
# 0600, de forma atómica, en deploy/compose/secrets/api, que se monta SOLO para este comando.
set -eu
SLUG="${1:-}"
MODE="${2:-}"
[ -n "$SLUG" ] || { echo "Uso: sh scripts/write-api-secrets.sh <organización> [--rotate]" >&2; exit 2; }
case "$MODE" in ""|--rotate) ;; *) echo "Opción desconocida: $MODE" >&2; exit 2 ;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/deploy/compose/secrets/api"
COMPOSE="${COMPOSE:-docker compose -f $ROOT/deploy/compose/compose.yaml}"
umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"
# En Git Bash (Windows) se evita que la ruta /out del contenedor se convierta en una ruta de
# Windows, y se usa la ruta del anfitrión en formato que Docker Desktop entiende.
# [SUPUESTO: probado solo en Linux (CI); en Windows queda por verificar].
export MSYS_NO_PATHCONV=1
HOST_DIR="$(cd "$DIR" && (pwd -W 2>/dev/null || pwd))"
# Se ejecuta con el usuario del anfitrión para poder escribir en su directorio (700).
RUN="$COMPOSE run --rm -T --user $(id -u):$(id -g) -v $HOST_DIR:/out admin"
if [ "$MODE" = "--rotate" ]; then
  $RUN tenant rotate-password --slug "$SLUG" --api-secrets-out /out
else
  $RUN api-secrets write --tenant "$SLUG" --out /out
fi
# Igual que en generate-secrets.sh: el contenedor de la API lee con otro usuario, así que los
# archivos quedan legibles (644) y la protección está en el directorio (700).
chmod 644 "$DIR/organization.json" "$DIR/organization_db_password" "$DIR/organization_dek"
echo "Secretos de la API listos. (Re)inicie la API:"
echo "  docker compose -f deploy/compose/compose.yaml up -d --force-recreate --wait api"
