#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Comprobaciones del perfil Compose local una vez levantado.
# Uso: sh scripts/smoke-compose.sh <commit-esperado> [puerto-local]
set -eu
EXPECTED_COMMIT="${1:-desarrollo}"
PORT="${2:-8080}"
BASE="http://127.0.0.1:$PORT"
COMPOSE="docker compose -f deploy/compose/compose.yaml"
fail() { echo "::error title=smoke-compose::FALLA: $*"; echo "FALLA: $*" >&2; exit 1; }

echo "1. La sonda de salud responde a través del proxy"
curl -fsS "$BASE/health" | grep -q '"status":"ok"' || fail "/health"

echo "2. /api/v1/about informa el commit exacto y el código fuente (AGPL §13)"
ABOUT="$(curl -fsS "$BASE/api/v1/about")"
echo "$ABOUT"
echo "$ABOUT" | grep -q "\"commit\":\"$EXPECTED_COMMIT\"" || fail "commit inesperado"
echo "$ABOUT" | grep -q '"license":"AGPL-3.0-or-later"' || fail "licencia"

echo "3. La interfaz web se sirve con cabeceras de seguridad"
HEADERS="$(curl -fsS -D - -o /dev/null "$BASE/")"
echo "$HEADERS" | grep -qi "^content-security-policy: default-src 'self'" || fail "CSP ausente"
echo "$HEADERS" | grep -qi "^x-content-type-options: nosniff" || fail "nosniff ausente"
echo "$HEADERS" | grep -qi "^server:" && fail "la cabecera Server no debe exponerse"

echo "4. Solo web publica un puerto, y únicamente en 127.0.0.1"
WEB_BIND="$($COMPOSE port web 8080)"
echo "web 8080 -> $WEB_BIND"
[ "$WEB_BIND" = "127.0.0.1:$PORT" ] || fail "web debe publicarse solo en 127.0.0.1:$PORT (obtenido: $WEB_BIND)"
for pair in api:3000 postgres:5432 valkey:6379; do
  svc="${pair%%:*}"; p="${pair#*:}"
  if out="$($COMPOSE port "$svc" "$p" 2>/dev/null)" && [ -n "$out" ] && [ "$out" != ":0" ]; then
    fail "$svc publica el puerto $p ($out)"
  fi
done
curl -s --max-time 3 "http://127.0.0.1:3000/health" >/dev/null 2>&1 && fail "la API es accesible directamente"

echo "5. La red interna no tiene salida a Internet (sin telemetría posible)"
if $COMPOSE exec -T api node -e "fetch('https://example.com',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(0)).catch(()=>process.exit(1))"; then
  fail "la API pudo salir a Internet"
fi

echo "6. Los procesos principales no se ejecutan como root (api, web, valkey)"
for svc in api web valkey; do
  uid="$($COMPOSE exec -T "$svc" id -u)"
  [ "$uid" != "0" ] || fail "$svc se ejecuta como root"
done

echo "7. Valkey exige contraseña"
$COMPOSE exec -T valkey valkey-cli ping 2>&1 | grep -q NOAUTH || fail "Valkey acepta conexiones sin autenticación"

echo "8. El proceso principal de PostgreSQL no se ejecuta como root"
PG_UID="$($COMPOSE exec -T postgres awk '/^Uid:/{print $2}' /proc/1/status)"
[ -n "$PG_UID" ] && [ "$PG_UID" != "0" ] || fail "el proceso principal de postgres se ejecuta como root"

echo "Todas las comprobaciones pasaron."
