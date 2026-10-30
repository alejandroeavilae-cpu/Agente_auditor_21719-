#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Recorrido del perfil institucional con HTTPS y la CA interna de Caddy (2C-1, D-37).
# Se ejecuta DESPUÉS de scripts/smoke-compose.sh, sobre la misma instalación efímera (usa su
# organización "muni-ficticia" y su administrador de prueba).
# Uso: sh scripts/smoke-institucional.sh [puerto-https]
set -eu
PORT="${1:-8443}"
SITE="auditor.prueba.internal"
export AUDITOR_SITE_ADDRESS="$SITE" AUDITOR_HTTPS_PORT="$PORT" AUDITOR_HTTPS_BIND=127.0.0.1 AUDITOR_TLS=internal
COMPOSE="docker compose -f deploy/compose/compose.yaml -f deploy/compose/compose.institucional.yaml"
BASE="https://$SITE:$PORT"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ROOT_CRT="$WORK/root.crt"
# --resolve: el nombre apunta al propio equipo sin tocar /etc/hosts.
CURL="curl -sS --resolve $SITE:$PORT:127.0.0.1"
# Frase aleatoria que generó smoke-compose.sh para su administrador de prueba.
PHRASE_FILE="deploy/compose/secrets/smoke_admin_phrase"
[ -s "$PHRASE_FILE" ] || { echo "FALLA: ejecute antes scripts/smoke-compose.sh (falta $PHRASE_FILE)" >&2; exit 1; }
ADMIN_PHRASE="frase-$(cat "$PHRASE_FILE")"
fail() { echo "::error title=smoke-institucional::FALLA: $*"; echo "FALLA: $*" >&2; exit 1; }

echo "I-1. Se levanta el perfil institucional (web en HTTPS, API con COOKIE_SECURE=true)"
$COMPOSE up -d --wait --wait-timeout 300 web api

echo "I-2. Se extrae el certificado raíz de la CA interna (como indica la guía)"
for i in $(seq 1 30); do
  if $COMPOSE exec -T web cat /data/caddy/pki/authorities/local/root.crt > "$ROOT_CRT" 2>/dev/null && grep -q 'BEGIN CERTIFICATE' "$ROOT_CRT"; then break; fi
  sleep 2
done
grep -q 'BEGIN CERTIFICATE' "$ROOT_CRT" || fail "no se encontró el certificado raíz de la CA interna"
SUM1="$(sha256sum "$ROOT_CRT" | cut -d' ' -f1)"

echo "I-3. HTTPS válido con la CA interna; sin ella, el certificado se rechaza"
for i in $(seq 1 30); do
  $CURL --cacert "$ROOT_CRT" "$BASE/health" 2>/dev/null | grep -q '"status":"ok"' && break
  sleep 2
done
$CURL --cacert "$ROOT_CRT" "$BASE/health" | grep -q '"status":"ok"' || fail "/health por HTTPS"
if $CURL -o /dev/null "$BASE/health" 2>/dev/null; then fail "el certificado no debería ser de confianza sin la CA interna"; fi

echo "I-4. Cabeceras de seguridad (las mismas del perfil local, más HSTS)"
HEADERS="$($CURL --cacert "$ROOT_CRT" -D - -o /dev/null "$BASE/")"
echo "$HEADERS" | grep -qi "^content-security-policy: default-src 'self'" || fail "CSP ausente"
echo "$HEADERS" | grep -qi "^strict-transport-security: max-age=" || fail "HSTS ausente"
echo "$HEADERS" | grep -qi "^x-content-type-options: nosniff" || fail "nosniff ausente"
echo "$HEADERS" | grep -qi "^server:" && fail "la cabecera Server no debe exponerse"

echo "I-5. Sin HTTP en claro: el puerto solo habla TLS y el 8080 local ya no se publica"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health" || true)"
[ "$CODE" != "200" ] || fail "el puerto HTTPS respondió 200 por HTTP en claro"
curl -s --max-time 3 -o /dev/null "http://127.0.0.1:8080/health" && fail "el perfil local (8080) sigue publicado"
WEB_BIND="$($COMPOSE port web 8443)"
[ "$WEB_BIND" = "127.0.0.1:$PORT" ] || fail "web debe publicarse en 127.0.0.1:$PORT en esta prueba (obtenido: $WEB_BIND)"

echo "I-6. La cookie de sesión lleva Secure, HttpOnly, SameSite=Strict y el prefijo __Host- (D-81)"
SET_COOKIE="$($CURL --cacert "$ROOT_CRT" -D - -o /dev/null -H 'content-type: application/json' \
  -d "{\"email\":\"admin@muni-ficticia.example\",\"password\":\"$ADMIN_PHRASE\"}" "$BASE/api/v1/auth/login" | grep -i '^set-cookie:' || true)"
echo "$SET_COOKIE" | sed 's/=[A-Za-z0-9_%-]\{20,\}/=<token>/'
echo "$SET_COOKIE" | grep -qi '__Host-auditor_session=' || fail "falta el prefijo __Host-"
for attr in Secure HttpOnly 'SameSite=Strict' 'Path=/'; do
  echo "$SET_COOKIE" | grep -qi "; $attr" || fail "la cookie no tiene $attr"
done
echo "$SET_COOKIE" | grep -qi 'domain=' && fail "una cookie __Host- no puede llevar Domain"

echo "I-7. La CA interna se conserva al reiniciar (no hay que reinstalar el certificado raíz)"
$COMPOSE restart web
sleep 3
for i in $(seq 1 30); do
  $COMPOSE exec -T web cat /data/caddy/pki/authorities/local/root.crt > "$ROOT_CRT" 2>/dev/null && break
  sleep 2
done
SUM2="$(sha256sum "$ROOT_CRT" | cut -d' ' -f1)"
[ "$SUM1" = "$SUM2" ] || fail "la CA interna cambió al reiniciar"
for i in $(seq 1 30); do
  $CURL --cacert "$ROOT_CRT" "$BASE/health" 2>/dev/null | grep -q '"status":"ok"' && break
  sleep 2
done
$CURL --cacert "$ROOT_CRT" "$BASE/health" | grep -q '"status":"ok"' || fail "/health tras reiniciar"

echo "Perfil institucional: todas las comprobaciones pasaron."
