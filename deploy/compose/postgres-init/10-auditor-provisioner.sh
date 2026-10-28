#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Preparación del servidor PostgreSQL del perfil Compose (entrega 2A, hallazgos QA A-02 y M-03).
# La imagen oficial ejecuta este script UNA sola vez, al crear el volumen de datos vacío.
# Para un servidor ya existente, ejecute a mano lo indicado en
# docs/fase-2/servidor-de-base-de-datos.md.
#
# Crea la cuenta de aprovisionamiento SIN superusuario que usa `auditor-admin` y quita
# accesos públicos que PostgreSQL concede por defecto.
set -eu
PROV_PW="$(cat /run/secrets/provisioner_password)"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v prov_pw="$PROV_PW" <<'SQL'
-- Cuenta de aprovisionamiento: crea bases y usuarios de organizaciones, sin superusuario.
CREATE ROLE auditor_provisioner LOGIN CREATEDB CREATEROLE NOSUPERUSER NOREPLICATION NOBYPASSRLS PASSWORD :'prov_pw';
-- Permite cerrar las sesiones de una organización al suspenderla.
GRANT pg_signal_backend TO auditor_provisioner;
-- Por defecto cualquier usuario puede conectarse a "postgres" y "template1": se revoca.
REVOKE CONNECT, TEMPORARY ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT, TEMPORARY ON DATABASE template1 FROM PUBLIC;
GRANT CONNECT ON DATABASE postgres TO auditor_provisioner;
-- Las bases nuevas se copian de template1: sin objetos grandes para usuarios comunes.
\connect template1
REVOKE EXECUTE ON FUNCTION lo_creat(integer), lo_create(oid), lo_from_bytea(oid, bytea), lo_import(text), lo_import(text, oid) FROM PUBLIC;
SQL
echo "auditor-21719: cuenta auditor_provisioner creada y servidor endurecido."
