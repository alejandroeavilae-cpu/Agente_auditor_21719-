# Guía de verificación de integridad (versión inicial)

Objetivo (sección 15): que una organización compruebe **con sus propias herramientas** que el software instalado corresponde al publicado, sin confiar en lo que muestra la aplicación. Esta guía se completará en la Fase 11.

## 1. Verificar un paquete de versión (sin Internet)

Cada versión publica: el paquete offline (`auditor-21719-<versión>-offline.tar.gz`), `SHA256SUMS`, su firma `SHA256SUMS.sigstore.json`, la clave pública `release.pub` y los SBOM.

1. Obtenga la **clave pública del proyecto por un canal independiente** de la descarga (por ejemplo, el archivo `deploy/keys/` del repositorio en una versión etiquetada) y compare su huella publicada. *[PENDIENTE P-12: la clave del proyecto aún no existe; las versiones de prueba se firman con una clave efímera y lo indican en sus notas.]*
2. Verifique la firma de la lista de hashes (no requiere red):
   ```sh
   cosign verify-blob --key release.pub --bundle SHA256SUMS.sigstore.json --insecure-ignore-tlog SHA256SUMS
   ```
   `--insecure-ignore-tlog` omite la consulta al registro de transparencia público, imposible sin Internet; la confianza descansa en la clave pública obtenida en el paso 1.
3. Verifique los hashes de los archivos:
   ```sh
   sha256sum -c SHA256SUMS
   ```
4. Extraiga el paquete, cargue las imágenes y levante el perfil sin Internet (Docker no intentará descargar nada):
   ```sh
   tar -xzf auditor-21719-<versión>-offline.tar.gz && cd auditor-21719-<versión>-offline
   docker load -i images/imagenes.tar
   # Compruebe que cada imagen cargada tiene el ID registrado (IMAGE_IDS está cubierto por SHA256SUMS firmado)
   while read -r id img; do [ "$(docker image inspect --format '{{.Id}}' "$img")" = "$id" ] && echo "OK $img" || echo "DISTINTA $img"; done < IMAGE_IDS
   sh scripts/generate-secrets.sh
   docker compose -f deploy/compose/compose.yaml -f deploy/compose/compose.offline.yaml up -d --wait
   ```

Con conexión, puede verificar además la firma de las imágenes publicadas: `cosign verify --key release.pub ghcr.io/<propietario>/auditor-21719-api@<digest>`.

## 2. Verificar la versión en ejecución

1. `curl http://127.0.0.1:8080/api/v1/about` → anote `version` y `commit`.
2. Compare con las notas de la versión y con `docker image inspect auditor-21719-api:local --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`.
3. Revise el código exacto en el enlace `sourceForThisVersionUrl`.

## 3. Verificar una bitácora exportada

```sh
# Generar claves de anclaje (una vez; guarde la privada FUERA de la base de datos)
node packages/audit-log/dist/cli.js keygen --out-dir <carpeta-segura> --key-id <id>

# Anclar periódicamente el último hash
node packages/audit-log/dist/cli.js anchor --entries bitacora.jsonl --chain-id <tenant> --private-key <privada.pem> --key-id <id> --out anclajes.jsonl

# Verificar (código de salida 0 = íntegra, 1 = problemas, 2 = error de uso)
node packages/audit-log/dist/cli.js verify --entries bitacora.jsonl --chain-id <tenant> --anchors anclajes.jsonl --public-key <id>=<publica.pem>
```

Qué detecta y qué no:
- Detecta: entradas alteradas, eliminadas, reordenadas o duplicadas; cadenas de otro tenant; líneas no canónicas (contenido oculto o ambiguo); marcas de tiempo fuera de orden; reescrituras completas y truncamientos **anteriores** al último anclaje; anclajes falsificados.
- No detecta: la eliminación de entradas **posteriores al último anclaje** (ancle con frecuencia). Sin anclajes, tampoco detecta una reescritura completa y coherente (riesgo R-26, documentado y probado).

## 4. Verificación independiente del comportamiento (adelanto de Fase 11)

| Qué | Herramienta propia sugerida |
|---|---|
| Procesos en ejecución | `docker compose -f deploy/compose/compose.yaml top` |
| Puertos publicados | `docker compose -f deploy/compose/compose.yaml ps` (solo 127.0.0.1:8080) |
| Salida a Internet | La red `backend` es interna; compruébelo con `docker network inspect auditor-21719_backend` (`"Internal": true`) |
| Usuario de ejecución | `docker compose ... exec api id -u` (distinto de 0) |
