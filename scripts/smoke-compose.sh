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
  # "docker compose port" devuelve "IP:puerto" si está publicado; si no, falla o devuelve
  # algo como ":0" o "invalid IP:0". Solo una dirección válida con puerto > 0 cuenta.
  out="$($COMPOSE port "$svc" "$p" 2>/dev/null || true)"
  if echo "$out" | grep -Eq '^([0-9]{1,3}(\.[0-9]{1,3}){3}|\[[0-9a-fA-F:]+\]):[1-9][0-9]*$'; then
    fail "$svc publica el puerto $p ($out)"
  fi
  echo "$svc:$p no publicado ($out)"
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

echo "9. Organizaciones (entrega 2A): alta de dos organizaciones con base propia"
ADMIN="$COMPOSE exec -T api node dist/admin/cli.js"
$ADMIN init
$ADMIN tenant create --slug muni-ficticia --name "Municipalidad Ficticia"
$ADMIN tenant create --slug empresa-ficticia --name "Empresa Ficticia"
LIST="$($ADMIN tenant list)"
echo "$LIST"
[ "$(echo "$LIST" | grep -c ' active ')" = "2" ] || fail "se esperaban 2 organizaciones activas"
DBS="$($COMPOSE exec -T postgres psql -U auditor -d postgres -tAc "select datname from pg_database where datname like 'auditor_t_%' order by 1")"
echo "$DBS"
[ "$(echo "$DBS" | tr -d '\r')" = "$(printf 'auditor_t_empresa_ficticia\nauditor_t_muni_ficticia')" ] || fail "bases por organización inesperadas"

echo "10. La bitácora de cada organización se exporta y verifica con la CLI independiente"
for t in muni-ficticia empresa-ficticia; do
  $COMPOSE exec -T api sh -c "node dist/admin/cli.js audit export --tenant $t --out /tmp/$t.jsonl && node node_modules/@auditor-21719/audit-log/dist/cli.js verify --entries /tmp/$t.jsonl --chain-id $t" \
    || fail "la bitácora de $t no verificó"
done

# El aislamiento entre organizaciones (credenciales de A contra la base de B y la de control)
# se prueba con las contraseñas reales en packages/persistence/test (job de integración de CI).

echo "Todas las comprobaciones pasaron."
