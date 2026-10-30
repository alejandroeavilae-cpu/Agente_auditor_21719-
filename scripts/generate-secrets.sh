#!/usr/bin/env sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Genera los secretos locales del perfil Compose en deploy/compose/secrets/.
# Nunca sobrescribe secretos existentes (perderlos impediría acceder a los datos).
set -eu
DIR="$(dirname "$0")/../deploy/compose/secrets"
mkdir -p "$DIR"
umask 077
chmod 700 "$DIR"

random() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# Los contenedores leen los secretos con un usuario distinto del anfitrión, por eso los
# archivos NUEVOS quedan legibles (644); la protección está en el directorio (700): ningún
# otro usuario del anfitrión puede entrar a él. Los permisos de secretos ya existentes NO se
# modifican (hallazgo QA B-09).
created() { chmod 644 "$1"; echo "Creado: $(basename "$1")${2:-}"; }

for name in postgres_password provisioner_password; do
  if [ ! -f "$DIR/$name" ]; then
    random > "$DIR/$name"
    created "$DIR/$name"
  else
    echo "Ya existe: $name (no se modifica)"
  fi
done

if [ ! -f "$DIR/valkey.conf" ]; then
  printf 'requirepass %s\nprotected-mode yes\nappendonly yes\ndir /data\n' "$(random)" > "$DIR/valkey.conf"
  created "$DIR/valkey.conf"
else
  echo "Ya existe: valkey.conf (no se modifica)"
fi
if [ ! -f "$DIR/master.key" ]; then
  # Clave maestra de la instalación (D-12): 32 bytes aleatorios en base64. Protege las
  # credenciales de todas las organizaciones. RESPALDELA fuera del servidor: si se pierde,
  # no se pueden descifrar las credenciales de las bases de las organizaciones (R-24).
  head -c 32 /dev/urandom | base64 > "$DIR/master.key"
  created "$DIR/master.key" "  ← respáldela en un lugar seguro fuera de este servidor"
else
  echo "Ya existe: master.key (no se modifica)"
fi
# Secretos de la API (D-87) y certificado propio del perfil institucional: se crean VACÍOS
# para que Docker Compose encuentre los archivos. La API se niega a arrancar con ellos
# vacíos; los llena `sh scripts/write-api-secrets.sh <organización>` después de crear la
# organización (ver docs/fase-1/ejecucion-local.md).
for sub in api tls; do
  mkdir -p "$DIR/$sub"
  chmod 700 "$DIR/$sub"
done
for name in api/organization.json api/organization_db_password api/organization_dek tls/sin-certificado.pem tls/sin-llave.pem; do
  if [ ! -f "$DIR/$name" ]; then
    : > "$DIR/$name"
    chmod 644 "$DIR/$name"
    echo "Creado vacío: $name"
  fi
done
if [ -f "$DIR/api_db_password" ]; then
  echo "Aviso: api_db_password ya no se usa desde 2C-1 (la API no tiene cuenta propia, D-87). Puede borrarlo."
fi
echo "Secretos listos en $DIR (excluidos de git por .gitignore)."
echo "Siguiente paso: cree la organización y ejecute sh scripts/write-api-secrets.sh <organización> antes de levantar la API."

