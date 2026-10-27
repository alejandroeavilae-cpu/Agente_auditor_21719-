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

if [ ! -f "$DIR/postgres_password" ]; then
  random > "$DIR/postgres_password"
  echo "Creado: postgres_password"
else
  echo "Ya existe: postgres_password (no se modifica)"
fi

if [ ! -f "$DIR/valkey.conf" ]; then
  printf 'requirepass %s\nprotected-mode yes\nappendonly yes\ndir /data\n' "$(random)" > "$DIR/valkey.conf"
  echo "Creado: valkey.conf"
else
  echo "Ya existe: valkey.conf (no se modifica)"
fi
if [ ! -f "$DIR/master.key" ]; then
  # Clave maestra de la instalación (D-12): 32 bytes aleatorios en base64. Protege las
  # credenciales de todas las organizaciones. RESPALDELA fuera del servidor: si se pierde,
  # no se pueden descifrar las credenciales de las bases de las organizaciones (R-24).
  head -c 32 /dev/urandom | base64 > "$DIR/master.key"
  echo "Creado: master.key  ← respáldela en un lugar seguro fuera de este servidor"
else
  echo "Ya existe: master.key (no se modifica)"
fi
# Los contenedores leen los secretos con un usuario distinto del anfitrión, por eso los
# archivos son legibles; la protección está en el directorio (700): ningún otro usuario
# del anfitrión puede entrar a él.
chmod 644 "$DIR/postgres_password" "$DIR/valkey.conf" "$DIR/master.key"
echo "Secretos listos en $DIR (excluidos de git por .gitignore)."
