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

for name in postgres_password provisioner_password api_db_password; do
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
echo "Secretos listos en $DIR (excluidos de git por .gitignore)."
