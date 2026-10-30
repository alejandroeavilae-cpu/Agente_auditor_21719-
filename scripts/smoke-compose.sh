#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Instalación y comprobaciones del perfil Compose local.
# Requiere una instalación NUEVA con postgres y valkey levantados:
#   sh scripts/generate-secrets.sh
#   docker compose -f deploy/compose/compose.yaml up -d --build --wait postgres valkey
# Uso: sh scripts/smoke-compose.sh <commit-esperado> [puerto-local]
set -eu
EXPECTED_COMMIT="${1:-desarrollo}"
PORT="${2:-8080}"
BASE="http://127.0.0.1:$PORT"
COMPOSE="docker compose -f deploy/compose/compose.yaml"
ADMIN="$COMPOSE run --rm -T admin"
fail() { echo "::error title=smoke-compose::FALLA: $*"; echo "FALLA: $*" >&2; exit 1; }
# Contraseña sintética del administrador de prueba (solo existe en esta instalación efímera).
ADMIN_PASSWORD="frase-sintetica-de-prueba-2026"

echo "0. Instalación (2C-1): base de control, organización y secretos de la API ANTES de arrancarla (D-87)"
$ADMIN init
$ADMIN tenant create --slug muni-ficticia --name "Municipalidad Ficticia"
sh scripts/write-api-secrets.sh muni-ficticia
for f in organization.json organization_db_password organization_dek; do
  [ -s "deploy/compose/secrets/api/$f" ] || fail "api-secrets write no escribió $f"
done
$COMPOSE up -d --wait --wait-timeout 300

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

echo "9. La API solo tiene los secretos de su organización: sin clave maestra ni aprovisionamiento (A-02, D-87)"
API_SECRETS="$($COMPOSE exec -T api sh -c 'ls -A /run/secrets 2>/dev/null | sort | tr "\n" " "')"
echo "secretos de api: $API_SECRETS"
[ "$(echo "$API_SECRETS" | tr -d '\r' | sed 's/ *$//')" = "organization.json organization_db_password organization_dek" ] || fail "el contenedor api debe montar solo los secretos de su organización"
$COMPOSE exec -T api sh -c 'env | grep -q -E "^(DB_ADMIN|MASTER_KEY|DB_API|DB_CONTROL)"' && fail "el contenedor api recibe variables de aprovisionamiento, de la clave maestra o de la base de control"
ROLES="$($COMPOSE exec -T postgres psql -U auditor -d postgres -tAc "select rolname || ':' || rolsuper::int || rolcreatedb::int || rolcreaterole::int from pg_roles where rolname in ('auditor_provisioner','auditor_api') order by 1" | tr -d '\r' | tr '\n' ' ')"
echo "$ROLES"
[ "$ROLES" = "auditor_provisioner:011 " ] || fail "cuentas inesperadas (esperado solo auditor_provisioner sin superusuario; auditor_api ya no existe): $ROLES"
TDB0="$($COMPOSE exec -T postgres psql -U auditor -d auditor_control -tAc "select db_user from tenants where slug = 'muni-ficticia'" | tr -d '\r ')"
API_DB_USER="$($COMPOSE exec -T postgres psql -U auditor -d postgres -tAc "select string_agg(distinct usename, ',') from pg_stat_activity where application_name = 'auditor-21719' and usename <> 'auditor_provisioner'" | tr -d '\r ')"
echo "usuarios de BD con sesiones de la plataforma: $API_DB_USER"
case "$API_DB_USER" in ""|"$TDB0") ;; *) fail "la API se conecta con un usuario distinto del de su organización: $API_DB_USER" ;; esac

echo "10. Organizaciones (entrega 2A): alta de una segunda organización con base propia y nombre opaco"
$ADMIN tenant create --slug empresa-ficticia --name "Empresa Ficticia"
LIST="$($ADMIN tenant list)"
echo "$LIST"
[ "$(echo "$LIST" | grep -c ' active ')" = "2" ] || fail "se esperaban 2 organizaciones activas"
DBS="$($COMPOSE exec -T postgres psql -U auditor -d postgres -tAc "select datname from pg_database where datname ~ '^auditor_t_[0-9a-f]{12}$'" | tr -d '\r')"
echo "$DBS"
[ "$(echo "$DBS" | grep -c .)" = "2" ] || fail "se esperaban 2 bases de organización con nombre opaco"
$ADMIN tenant check || fail "las organizaciones no pueden abrirse con sus credenciales"

echo "11. La bitácora de cada organización se exporta y verifica con la CLI independiente (también suspendida)"
$ADMIN tenant suspend --slug empresa-ficticia
for t in muni-ficticia empresa-ficticia; do
  $COMPOSE run --rm -T --entrypoint sh admin -c "node dist/admin/cli.js audit export --tenant $t --out /tmp/$t.jsonl && node node_modules/@auditor-21719/audit-log/dist/cli.js verify --entries /tmp/$t.jsonl --chain-id $t" \
    || fail "la bitácora de $t no verificó"
done
$ADMIN tenant reactivate --slug empresa-ficticia

echo "12. Identidad (2B, 2C-1): invitación por CLI, activación por HTTP sin organización y MFA obligatoria"
INVITE="$($ADMIN user invite-admin --tenant muni-ficticia --email admin@muni-ficticia.example --name "Administración Ficticia")"
TOKEN="$(echo "$INVITE" | tr -d '\r' | grep -E '^[A-Za-z0-9_-]{43}$' | head -1)"
[ -n "$TOKEN" ] || fail "invite-admin no imprimió un token de activación"
ME="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/auth/me")"
[ "$ME" = "401" ] || fail "/api/v1/auth/me sin sesión debe responder 401 (obtenido $ME)"
BAD="$(curl -s -H 'content-type: application/json' -d '{"email":"admin@muni-ficticia.example","password":"incorrecta-sintetica"}' "$BASE/api/v1/auth/login")"
echo "$BAD" | grep -q '"error":"invalid_credentials"' || fail "inicio de sesión inválido: respuesta inesperada ($BAD)"
echo "$BAD" | grep -q 'Correo o contraseña incorrectos' || fail "mensaje de error inesperado ($BAD)"
ORGF="$(curl -s -H 'content-type: application/json' -d '{"organization":"muni-ficticia","email":"admin@muni-ficticia.example","password":"incorrecta-sintetica"}' "$BASE/api/v1/auth/login")"
echo "$ORGF" | grep -q '"error":"invalid_request"' || fail "el campo organization debe rechazarse (D-75 ajustada): $ORGF"
JAR="$(mktemp)"
ACT="$(curl -s -c "$JAR" -H 'content-type: application/json' -d "{\"token\":\"$TOKEN\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/v1/auth/activate")"
echo "$ACT" | grep -q '"stage":"mfa_enroll"' || fail "la activación debe exigir configurar MFA ($ACT)"
grep -q 'auditor_session' "$JAR" || fail "la activación no entregó la cookie de sesión"
grep -i 'auditor_session' "$JAR" | grep -q '#HttpOnly_' || fail "la cookie de sesión debe ser HttpOnly"
USERS="$(curl -s -b "$JAR" "$BASE/api/v1/users")"
echo "$USERS" | grep -q '"error":"mfa_enrollment_required"' || fail "sin MFA no debe poder listar usuarios ($USERS)"
rm -f "$JAR"

echo "13. Una X-Forwarded-For enviada por el cliente no falsifica la IP registrada (QA 2B-05)"
curl -s -o /dev/null -H 'X-Forwarded-For: 203.0.113.77' -H 'content-type: application/json' \
  -d '{"email":"nadie@muni-ficticia.example","password":"incorrecta-sintetica"}' "$BASE/api/v1/auth/login"
TDB="$($COMPOSE exec -T postgres psql -U auditor -d auditor_control -tAc "select db_name from tenants where slug = 'muni-ficticia'" | tr -d '\r ')"
LASTIP="$($COMPOSE exec -T postgres psql -U auditor -d "$TDB" -tAc "select coalesce(ip, '') from access_log order by ts desc limit 1" | tr -d '\r ')"
echo "última IP registrada: $LASTIP"
[ -n "$LASTIP" ] || fail "el registro de accesos no guardó la IP"
[ "$LASTIP" != "203.0.113.77" ] || fail "la IP registrada es la que envió el cliente en X-Forwarded-For"

login_stage() {
  curl -s -H 'content-type: application/json' -d "{\"email\":\"admin@muni-ficticia.example\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/v1/auth/login"
}

echo "14. Cambio de contraseña de la base (D-87): se reescriben los secretos y se reinicia la API"
sh scripts/write-api-secrets.sh muni-ficticia --rotate
START="$(date +%s)"
$COMPOSE up -d --force-recreate --wait --wait-timeout 120 api
echo "La API volvió a estar sana en $(( $(date +%s) - START )) s (medición de esta ejecución; ver [SUPUESTO] de 2c-diseno.md §1.3)"
# Caddy puede tardar un momento en volver a resolver la API recreada.
for i in $(seq 1 15); do
  R="$(login_stage)"
  echo "$R" | grep -q '"stage":"mfa_enroll"' && break
  sleep 2
done
echo "$R" | grep -q '"stage":"mfa_enroll"' || fail "tras rotar la contraseña la API no permite iniciar sesión ($R)"

echo "15. Suspender la organización cierra las conexiones de la API, que falla de forma segura (D-87)"
$ADMIN tenant suspend --slug muni-ficticia || fail "la suspensión terminó con advertencias"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' -d "{\"email\":\"admin@muni-ficticia.example\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/v1/auth/login")"
[ "$CODE" = "503" ] || fail "con la organización suspendida el inicio de sesión debe responder 503 (obtenido $CODE)"
$ADMIN tenant reactivate --slug muni-ficticia
for i in $(seq 1 5); do
  R="$(login_stage)"
  echo "$R" | grep -q '"stage":"mfa_enroll"' && break
  sleep 2
done
echo "$R" | grep -q '"stage":"mfa_enroll"' || fail "tras reactivar, la API no se recuperó ($R)"

# El aislamiento entre organizaciones (credenciales de A contra la base de B y la de control)
# se prueba con las contraseñas reales en packages/persistence/test (job de integración de CI).

echo "Todas las comprobaciones pasaron."
