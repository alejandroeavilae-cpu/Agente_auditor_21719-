# Instalación institucional con HTTPS (perfil institucional, 2C-1)

**Estado:** Implementado en 2C-1 (D-37, D-88). La prueba automática del perfil con la CA interna (`scripts/smoke-institucional.sh`) corre solo en CI. `[PENDIENTE: resultado de CI y verificación QA]`. Esta guía **no** se ha probado aún en un servidor real de una institución.

Esta guía es para la persona que instala la plataforma en un servidor de la institución, para que la usen otros equipos de la **red interna**. Está escrita paso a paso. Si no tiene experiencia con servidores, pida apoyo al área de informática para los pasos marcados con **[Informática]**.

---

## Advertencia importante (riesgo R-35)

> **Si la plataforma se usa desde otros equipos (fuera de `127.0.0.1`), debe usar HTTPS, es decir, este perfil.**
>
> El perfil local (`http://127.0.0.1:8080`) no cifra la conexión. Si lo publica en la red, **las contraseñas y las sesiones viajarían sin cifrar** y cualquiera con acceso a la red podría leerlas. La plataforma no lo impide automáticamente (decisión D-81): es responsabilidad de quien instala.

---

## 1. Qué necesita

| Requisito | Cómo comprobarlo |
|---|---|
| Un servidor Linux de la institución, encendido de forma permanente | — |
| Docker Engine con Docker Compose v2 | `docker compose version`. `[PENDIENTE: confirmar versión mínima]`: el perfil usa la etiqueta `!override` de Compose, que según su documentación existe desde la versión 2.24.4 `[FUENTE SECUNDARIA, no verificado en esta entrega]` |
| Un **nombre** para el servidor en la red interna (p. ej. `auditor.municipio.local`), o su dirección IP fija | **[Informática]** Lo define el área de informática (DNS interno) |
| El puerto **443** libre en el servidor, o otro puerto que elija | **[Informática]** `sudo ss -ltnp \| grep ':443 '` no debe mostrar nada |
| Elegir cómo obtener el certificado HTTPS (sección 3) | — |

---

## 2. Obtener el código y preparar los secretos

1. Abra una terminal en el servidor y clone el repositorio:
   ```sh
   git clone https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-.git
   cd Agente_auditor_21719-
   ```
2. Genere los secretos locales:
   ```sh
   sh scripts/generate-secrets.sh
   ```
3. **Respalde** `deploy/compose/secrets/master.key` en un lugar seguro **fuera del servidor**, por ejemplo un pendrive cifrado guardado bajo llave. Sin ese archivo no se pueden abrir los datos.

---

## 3. Elegir el certificado HTTPS

Hay dos formas. Elija **una**.

| | **A. Certificado propio de la institución** | **B. CA interna de Caddy** |
|---|---|---|
| Cuándo usarla | La institución ya emite certificados (tiene su propia autoridad certificadora o compra certificados) | La institución no tiene certificados; no se necesita Internet |
| Qué hay que hacer en los equipos de los usuarios | Nada, si ya confían en la autoridad de la institución | Instalar **una vez** el certificado raíz de la plataforma (sección 6) |

### 3.A. Certificado propio

1. **[Informática]** Pida al área de informática dos archivos en formato PEM para el nombre del servidor:
   - el certificado (incluida la cadena intermedia);
   - su llave privada.
2. Cópielos al servidor, dentro de la carpeta protegida de secretos:
   ```sh
   cp certificado.pem deploy/compose/secrets/tls/certificado.pem
   cp llave.pem deploy/compose/secrets/tls/llave.pem
   # El certificado es público: puede leerlo cualquiera.
   chmod 644 deploy/compose/secrets/tls/certificado.pem
   # La llave privada es SECRETA: solo debe poder leerla el usuario con que corre Caddy en el
   # contenedor (identificador 65532). Requiere permisos de administrador (sudo).
   sudo chown 65532:65532 deploy/compose/secrets/tls/llave.pem
   sudo chmod 400 deploy/compose/secrets/tls/llave.pem
   ```
   **Por qué así:** Caddy no se ejecuta como administrador sino con el usuario 65532, y Docker le entrega el archivo con el mismo dueño y los mismos permisos que tiene en el servidor. Con dueño 65532 y permisos `400`, solo ese usuario puede leer la llave. Ninguna otra cuenta del servidor puede, salvo el administrador del sistema.
   - **No** use `chmod 644` en la llave: cualquier cuenta del servidor que pudiera entrar a la carpeta podría leerla. En ese caso la única protección sería la carpeta `deploy/compose/secrets` (permisos 700, solo su dueño), y basta un error de permisos en esa carpeta para exponer la llave.
   - Para reemplazar la llave más adelante, repita los dos comandos `sudo`.
   - `[PENDIENTE]` La prueba automática de CI usa la CA interna, no un certificado propio: este modo de permisos no se ha probado en CI.
3. Borre las copias que hayan quedado fuera de esa carpeta (descargas, correo, etc.).

### 3.B. CA interna de Caddy

No hay que preparar nada ahora. Caddy crea su propia autoridad certificadora la primera vez que arranca y la conserva en un volumen de Docker (`caddy-data`).

---

## 4. Configurar el perfil

Cree el archivo `deploy/compose/.env` (está excluido de Git) con un editor de texto, por ejemplo `nano deploy/compose/.env`, y escriba:

**Con la CA interna (3.B):**
```ini
AUDITOR_SITE_ADDRESS=auditor.municipio.local
AUDITOR_HTTPS_PORT=443
AUDITOR_TLS=internal
```

**Con certificado propio (3.A):**
```ini
AUDITOR_SITE_ADDRESS=auditor.municipio.local
AUDITOR_HTTPS_PORT=443
AUDITOR_TLS=/run/secrets/tls_cert /run/secrets/tls_key
AUDITOR_TLS_CERT_FILE=./secrets/tls/certificado.pem
AUDITOR_TLS_KEY_FILE=./secrets/tls/llave.pem
```

- Reemplace `auditor.municipio.local` por el nombre real del servidor. Si los usuarios entrarán por IP, escriba la IP (p. ej. `10.0.0.25`). Puede poner varios separados por coma: `auditor.municipio.local, 10.0.0.25`.
- `AUDITOR_HTTPS_PORT` puede ser otro puerto si el 443 está ocupado (entonces los usuarios escribirán `https://nombre:PUERTO`).
- Opcional: `AUDITOR_HTTPS_BIND=10.0.0.25` publica solo en esa interfaz de red del servidor, en vez de en todas (`0.0.0.0`).
- **No cambie la forma de publicar la API.** El perfil deja `TRUST_PROXY=true` en la API: la API toma la IP de cada usuario de la cabecera `X-Forwarded-For` que agrega Caddy. Esto solo es seguro porque **la API está detrás de exactamente un proxy (Caddy) y no se publica directamente**. Si la API se publicara (por ejemplo, agregando `ports` al servicio `api`) o se pusiera otro proxy delante de Caddy, cualquiera podría inventar su IP y eludir el límite de intentos y el bloqueo por equipo (R-34). La API lo advierte en su registro al arrancar. Si la institución tiene otro proxy o balanceador delante del servidor, consulte antes de instalar `[PENDIENTE: soporte de más de un salto]`.

Para no repetir los dos archivos en cada comando, defina en la terminal:
```sh
export COMPOSE_FILE=deploy/compose/compose.yaml:deploy/compose/compose.institucional.yaml
```
(`COMPOSE_FILE` es una variable estándar de Docker Compose. Si cierra la terminal, vuelva a definirla.)

---

## 5. Instalar y levantar

Los pasos son los mismos del perfil local. La API **no** recibe la clave maestra (D-87), así que antes de arrancarla hay que crear la organización y entregarle sus secretos.

1. Construya las imágenes y levante la base de datos y la caché:
   ```sh
   docker compose build
   docker compose up -d --wait postgres valkey
   ```
2. Prepare la base de control:
   ```sh
   docker compose run --rm admin init
   ```
3. Cree la organización (una por instalación):
   ```sh
   docker compose run --rm admin tenant create --slug muni-demo --name "Municipalidad Demo"
   ```
4. Entregue a la API sus secretos:
   ```sh
   sh scripts/write-api-secrets.sh muni-demo
   ```
5. Levante todo:
   ```sh
   docker compose up -d --wait
   ```
6. **[Informática]** Abra el puerto en el cortafuegos del servidor **solo para la red interna** (nunca hacia Internet). Ejemplo con `ufw` y la red `10.0.0.0/24`:
   ```sh
   sudo ufw allow from 10.0.0.0/24 to any port 443 proto tcp
   ```
7. Invite al primer administrador, como en `docs/fase-1/ejecucion-local.md` (sección "Administrar organizaciones", paso 9), usando ahora `https://<su-nombre>` en vez de `http://127.0.0.1:8080`.

---

## 6. Instalar el certificado raíz en los equipos (solo con la CA interna, 3.B)

Los navegadores no confían por defecto en la CA interna. Hay que instalar su **certificado raíz** una vez en cada equipo que use la plataforma. Es un archivo **público**: no contiene la llave privada.

### 6.1. Obtener el certificado raíz (en el servidor)

```sh
docker compose exec -T web cat /data/caddy/pki/authorities/local/root.crt > auditor-21719-raiz.crt
```

Anote su **huella digital**. Sirve para comprobar en cada equipo que el archivo no fue cambiado en el camino:
```sh
openssl x509 -in auditor-21719-raiz.crt -noout -fingerprint -sha256
```

Distribuya `auditor-21719-raiz.crt` por un canal interno de confianza (carpeta compartida de informática, por ejemplo). **No** lo envíe por canales externos ni acepte copias de origen desconocido: quien logre instalar un certificado raíz falso en un equipo puede espiar sus conexiones.

### 6.2. Instalarlo

- **Windows** (como administrador). Opción gráfica: doble clic en el archivo → **Instalar certificado** → **Equipo local** → **Colocar todos los certificados en el siguiente almacén** → **Examinar** → **Entidades de certificación raíz de confianza** → **Aceptar** → **Finalizar**. Opción con comandos (PowerShell como administrador):
  ```powershell
  Import-Certificate -FilePath .\auditor-21719-raiz.crt -CertStoreLocation Cert:\LocalMachine\Root
  ```
  **[Informática]** Para muchos equipos, el área de informática puede distribuirlo con una directiva de grupo (GPO) de Active Directory.
- **macOS** (Terminal):
  ```sh
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain auditor-21719-raiz.crt
  ```
- **Linux (Debian/Ubuntu)**:
  ```sh
  sudo cp auditor-21719-raiz.crt /usr/local/share/ca-certificates/auditor-21719-raiz.crt
  sudo update-ca-certificates
  ```
- **Firefox** puede usar su propio almacén. Si después de lo anterior Firefox sigue mostrando una advertencia: **Configuración → Privacidad y seguridad → Certificados → Ver certificados → Autoridades → Importar**, elija el archivo y marque **Confiar en esta CA para identificar sitios web**.

Antes de instalarlo en cada equipo, compare la huella digital con la anotada en 6.1 (en Windows: doble clic en el archivo → **Detalles** → **Huella digital**; el algoritmo que muestra puede ser SHA-1: en ese caso compare con `openssl x509 -in auditor-21719-raiz.crt -noout -fingerprint -sha1`).

### 6.3. Comprobar

Abra `https://<su-nombre>` en el navegador del equipo. Debe ver el candado, sin advertencias. **Nunca** acepte una advertencia de certificado de la plataforma: si aparece, avise a informática.

---

## 7. Comprobaciones finales

Desde el servidor (con la CA interna):
```sh
curl --cacert auditor-21719-raiz.crt https://auditor.municipio.local/health
```
Debe responder `{"status":"ok"}`. Con certificado propio, omita `--cacert`.

---

## 8. Operación

| Tarea | Cómo |
|---|---|
| Cambiar la contraseña de la base de la organización | `sh scripts/write-api-secrets.sh muni-demo --rotate` y luego `docker compose up -d --force-recreate --wait api`. Las sesiones no se pierden; las peticiones en curso durante el reinicio pueden fallar `[SUPUESTO: unos segundos; la prueba de humo de CI registra la duración medida]` |
| Renovar el certificado propio | Reemplace los archivos de la sección 3.A y ejecute `docker compose up -d --force-recreate web` |
| Certificados de la CA interna | Caddy renueva solo los certificados del servidor. El certificado raíz se conserva en el volumen `caddy-data`: **no borre ese volumen** (`down -v` lo borra), o tendrá que reinstalar el certificado raíz en todos los equipos `[PENDIENTE: documentar la vigencia del certificado raíz según la versión de Caddy usada]` |
| Suspender la organización | `docker compose run --rm admin tenant suspend --slug muni-demo`. La API responde "servicio no disponible" (503) hasta reactivarla |

---

## 9. Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `required variable AUDITOR_SITE_ADDRESS is missing a value` | Falta `deploy/compose/.env` o la variable | Sección 4 |
| `bind: address already in use` | Otro programa usa el puerto 443 | Cambie `AUDITOR_HTTPS_PORT` |
| El navegador advierte que el certificado no es de confianza | No se instaló el certificado raíz (3.B), o el nombre usado no está en `AUDITOR_SITE_ADDRESS` | Sección 6, o agregue el nombre y ejecute `docker compose up -d --force-recreate web` |
| La API se reinicia una y otra vez | Faltan los secretos de la API | Paso 5.4 y `docker compose up -d --force-recreate --wait api` |
| `!override` no reconocido | Docker Compose antiguo | Actualice Docker Compose (sección 1) |
