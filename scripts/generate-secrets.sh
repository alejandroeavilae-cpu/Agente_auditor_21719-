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
# Los contenedores leen los secretos con su propio usuario; se permite lectura sin escritura.
chmod 644 "$DIR/postgres_password" "$DIR/valkey.conf"
echo "Secretos listos en $DIR (excluidos de git por .gitignore)."
