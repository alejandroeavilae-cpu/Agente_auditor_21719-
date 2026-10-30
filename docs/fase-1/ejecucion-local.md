# Ejecución local paso a paso (Fase 1)

Hay dos formas de ejecutar el proyecto. Elija **una**:

- **Opción A — Docker Compose**: levanta todo (web, API, PostgreSQL, Valkey) como lo haría una institución. Recomendada para ver el sistema funcionando.
- **Opción B — Desarrollo**: ejecuta pruebas y servidores de desarrollo con Node.js, sin contenedores.

> Las instrucciones usan una terminal. En Windows use **Git Bash** (se instala con Git para Windows) para que los comandos funcionen igual que en Linux o macOS.

---

## Requisitos

| Herramienta | Para | Cómo comprobar |
|---|---|---|
| Git | Ambas opciones | `git --version` |
| Docker Desktop (Windows/macOS) o Docker Engine (Linux), con Docker Compose v2 | Opción A | `docker compose version` |
| Node.js **24** | Opción B | `node -v` → debe empezar con `v24` |
| pnpm **10.28.0** (vía corepack) | Opción B | `pnpm -v` |

---

## Paso 1 — Obtener el código

1. Abra la terminal (en Windows: clic derecho en el escritorio → **Open Git Bash here**).
2. Clone el repositorio:
   ```sh
   git clone https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-.git
   ```
3. Entre a la carpeta:
   ```sh
   cd Agente_auditor_21719-
   ```
4. Mientras la Fase 1 no esté fusionada en `main`, cambie a su rama:
   ```sh
   git checkout fase-1
   ```

---

## Opción A — Docker Compose

> **Cambio en 2C-1 (D-87):** la API ya **no** recibe la clave maestra. Antes de arrancarla hay que crear la organización y entregarle sus propios secretos. Por eso el orden es: base de datos → organización → secretos de la API → API y web.

1. Asegúrese de que Docker Desktop esté **abierto y en ejecución** (ícono de la ballena sin advertencias).
2. Genere los secretos locales (contraseñas aleatorias; nunca se suben a Git):
   ```sh
   sh scripts/generate-secrets.sh
   ```
   Debe ver `Creado: postgres_password`, `Creado: valkey.conf`, `Creado: master.key` y varias líneas `Creado vacío: ...` (los secretos de la API, que se llenan en el paso 6).
   **Respalde `deploy/compose/secrets/master.key` fuera del equipo**: sin ella no se pueden abrir las bases de las organizaciones.
3. Construya las imágenes y levante **solo** la base de datos y la caché (la primera vez tarda varios minutos):
   ```sh
   docker compose -f deploy/compose/compose.yaml build
   docker compose -f deploy/compose/compose.yaml up -d --wait postgres valkey
   ```
4. Prepare la base de control:
   ```sh
   docker compose -f deploy/compose/compose.yaml run --rm admin init
   ```
5. Cree **la** organización de esta instalación (una sola por instalación, D-84). Identificador en minúsculas, dígitos y guiones:
   ```sh
   docker compose -f deploy/compose/compose.yaml run --rm admin tenant create --slug muni-demo --name "Municipalidad Demo"
   ```
6. Entregue a la API los secretos de esa organización (datos de la organización, contraseña de su base y su llave). Use el **mismo** identificador del paso 5:
   ```sh
   sh scripts/write-api-secrets.sh muni-demo
   ```
   Debe terminar con `Secretos de la API listos.` Los archivos quedan en `deploy/compose/secrets/api/` (excluidos de Git). **No los copie fuera del servidor.**
7. Levante todo:
   ```sh
   docker compose -f deploy/compose/compose.yaml up -d --wait
   ```
   Termina cuando todos los servicios aparecen como `Healthy` o `Started`. Si la API no arranca, revise `docker compose -f deploy/compose/compose.yaml logs api`: el mensaje indica qué archivo falta.
8. Abra en el navegador: **http://127.0.0.1:8080**
   Desde 2C-2 debe ver la pantalla **"Iniciar sesión"** y, al pie, la versión y el enlace "Código fuente de esta versión". Para entrar por primera vez, active al primer administrador (paso 9 de "Administrar organizaciones").
9. (Opcional) Ejecute las comprobaciones automáticas **sobre una instalación nueva** con solo la base y la caché levantadas (pasos 2 y 3, sin los pasos 4 a 7). El script crea sus propias organizaciones ficticias y falla si ya existen:
   ```sh
   sh scripts/smoke-compose.sh desarrollo
   ```
   Debe terminar con `Todas las comprobaciones pasaron.`
10. Para detener todo:
    ```sh
    docker compose -f deploy/compose/compose.yaml down
    ```
    Para detener **y borrar los datos** (bases de datos de prueba): agregue `-v` al final.

> **Uso en la red de la institución:** este perfil solo atiende en `127.0.0.1` y sin HTTPS. Para que otros equipos accedan, use el perfil institucional con HTTPS: `docs/fase-2/instalacion-institucional.md`. **No publique este perfil en la red** (riesgo R-35: las contraseñas viajarían sin cifrar).

### Administrar organizaciones (entrega 2A)

La administración se hace con el servicio `admin`. No queda corriendo: cada comando lo inicia, lo ejecuta y lo elimina (`run --rm`). Es el **único** contenedor que recibe la contraseña de aprovisionamiento y la clave maestra; la API que atiende la web no las tiene.

Con los servicios levantados (pasos 1 a 7 de la Opción A), en la misma terminal:

1. Si su volumen de PostgreSQL se creó **antes** de 2C-1, bórrelo: así desaparece la cuenta `auditor_api`, que ya no se usa. Esto elimina todos los datos locales (que solo deben ser ficticios); luego repita los pasos 2 a 7 de la Opción A:
   ```sh
   docker compose -f deploy/compose/compose.yaml down -v
   ```
   Si no puede borrar los datos, siga `docs/fase-2/servidor-de-base-de-datos.md`, sección "Actualizar desde 2B".
2. Después de cada actualización de la plataforma, migre las bases:
   ```sh
   docker compose -f deploy/compose/compose.yaml run --rm admin init
   ```
   Si aparece una línea que empieza con `Aviso:`, léala: indica un ajuste de seguridad pendiente del servidor.
3. (Solo para probar la administración) puede crear otras organizaciones ficticias. La API atiende **solo** la del paso 5 de la Opción A:
   ```sh
   docker compose -f deploy/compose/compose.yaml run --rm admin tenant create --slug empresa-demo --name "Empresa Demo"
   ```
4. Liste las organizaciones:
   ```sh
   docker compose -f deploy/compose/compose.yaml run --rm admin tenant list
   ```
   La columna de la base muestra un nombre aleatorio (p. ej. `auditor_t_836cec1cff81`). Es intencional: así el usuario de una organización no ve los identificadores de las otras. En PostgreSQL sí puede ver **cuántas** bases hay (riesgo residual R-32).
5. Exporte la bitácora de una organización a un archivo de su equipo. Funciona **también si la organización está suspendida**:
   ```sh
   docker compose -f deploy/compose/compose.yaml run --rm -T admin audit export --tenant muni-demo > bitacora-muni-demo.jsonl
   ```
   Ábrala con cualquier editor de texto: cada línea es una acción registrada.
6. Verifique la integridad de esa exportación con la herramienta independiente (requiere la Opción B instalada: `pnpm install` y `pnpm run build`):
   ```sh
   node packages/audit-log/dist/cli.js verify --entries bitacora-muni-demo.jsonl --chain-id muni-demo
   ```
   Debe terminar con `RESULTADO: bitácora íntegra.` Sin anclajes externos no se detecta una reescritura completa de la bitácora; ver `docs/fase-1/verificacion-de-integridad.md`.
7. Suspenda o reactive una organización:
   ```sh
   docker compose -f deploy/compose/compose.yaml run --rm admin tenant suspend --slug muni-demo
   docker compose -f deploy/compose/compose.yaml run --rm admin tenant reactivate --slug muni-demo
   ```
   La suspensión la aplica el propio motor: el usuario de esa organización ya no puede iniciar sesión, y sus sesiones abiertas se cierran. Mientras tanto la API responde `503` ("El servicio no está disponible") sin mostrar datos; al reactivar se recupera sola. Si el comando termina con `CON ADVERTENCIAS` (código 1), lea el aviso: por ejemplo, puede quedar una sesión abierta. La reactivación se rechaza si no puede registrarse en la bitácora.
8. Otras operaciones:

   | Comando | Para qué sirve |
   |---|---|
   | `tenant check` | Comprueba cada organización activa: que abre con sus credenciales, que su usuario no se fijó parámetros de sesión propios y que no puede crear objetos grandes. Sale con código 1 si encuentra algo |
   | `tenant rotate-password --slug <id>` | Fija una contraseña nueva para el usuario de la organización (p. ej. si `tenant check` falla porque alguien la cambió). **Para la organización de la API use en su lugar** `sh scripts/write-api-secrets.sh <id> --rotate` y luego `docker compose -f deploy/compose/compose.yaml up -d --force-recreate --wait api`: la API tiene su propia copia de la contraseña y debe reiniciarse (las sesiones no se pierden) |
   | `api-secrets write --tenant <id> --out <dir>` | Escribe los secretos de la API (permisos 0600). En Compose se usa a través de `scripts/write-api-secrets.sh` |
   | `tenant cleanup-provisioning --slug <id>` | Limpia un alta que quedó a medias (p. ej. si se cortó la luz durante `tenant create`). `init` avisa cuando hay una |
   | `user invite-admin --tenant <id> --email <correo> --name <nombre>` | Invita al **primer administrador** de una organización (entrega 2B). Imprime un token de activación de un solo uso, válido 24 h |
   | `user unlock --tenant <id> --email <correo>` | Desbloquea una cuenta bloqueada por intentos fallidos, desde **todos** los orígenes (equipos) |

9. Active al primer administrador (desde 2C-2, con las pantallas):
   - Invítelo y copie el token que se imprime (se muestra **una sola vez**):
     ```sh
     docker compose -f deploy/compose/compose.yaml run --rm admin user invite-admin --tenant muni-demo --email admin@muni-demo.example --name "Administración Demo"
     ```
   - En el navegador, abra esta dirección reemplazando `<TOKEN>` por el token copiado (va **después de `#`**, así no viaja al servidor ni queda en registros):
     ```
     http://127.0.0.1:8080/activar#<TOKEN>
     ```
   - Elija la contraseña (mínimo 12 caracteres, que no sea común ni contenga su correo) y pulse **Activar cuenta**.
   - Configure la verificación en dos pasos: escanee el código QR con una app autenticadora de su teléfono (o escriba la clave que aparece debajo), escriba el código de 6 dígitos y pulse **Confirmar y activar**. **Toda** persona debe hacerlo (D-86).
   - Guarde los **códigos de recuperación** (se muestran una sola vez): pulse **Descargar como archivo .txt**, guárdelo en un lugar seguro, marque la casilla "Guardé mis códigos…" y pulse **Continuar**.
   - Desde el menú **Usuarios** puede invitar al resto de las personas; cada invitación muestra un enlace de activación una sola vez, con botón para copiarlo.
   - Si prefiere hacerlo sin navegador (como en 2B), la API sigue disponible: `curl -c cookies.txt -H "content-type: application/json" -d '{"token":"<TOKEN>","password":"una frase larga y propia"}' http://127.0.0.1:8080/api/v1/auth/activate` (borre `cookies.txt` al terminar: contiene su sesión).

**Notas**
- Solo el puerto 8080 queda abierto y únicamente en su propio equipo (127.0.0.1); nadie más en la red puede acceder.
- La API, PostgreSQL y Valkey no tienen salida a Internet.
- La API confía en la cabecera `X-Forwarded-For` de un proxy (`TRUST_PROXY=true`), porque Caddy (servicio `web`) es el **único** proxy delante de ella y la API **no** publica puertos. No publique la API directamente ni agregue otro proxy delante: un cliente podría inventar su IP y eludir el límite de intentos y el bloqueo por equipo (R-34). La API lo advierte en su registro al arrancar (`docker compose -f deploy/compose/compose.yaml logs api`).

---

## Opción B — Desarrollo con Node.js

1. Active pnpm con la versión exacta del proyecto:
   ```sh
   corepack enable
   ```
2. Instale dependencias respetando el archivo de bloqueo:
   ```sh
   pnpm install --frozen-lockfile
   ```
3. (Solo Windows) Si clonó antes de que existiera `.gitattributes`, renormalice los finales de línea: `git rm --cached -r -q . && git reset --hard`.
4. Ejecute la verificación completa (cabeceras de licencia, lint, tipos, pruebas, compilación y política de licencias):
   ```sh
   pnpm run verify
   ```
   Debe terminar sin errores.
5. Para ver la aplicación en modo desarrollo use **dos terminales**:
   - Terminal 1 — API (backend):
     ```sh
     pnpm --filter @auditor-21719/api build
     pnpm --filter @auditor-21719/api start
     ```
     Espere el mensaje `Nest application successfully started`.
   - Terminal 2 — Web (frontend):
     ```sh
     pnpm --filter @auditor-21719/web dev
     ```
     Abra la URL que muestra Vite (normalmente **http://localhost:5173**).
6. Detenga cada terminal con `Ctrl + C`.
7. (Opcional) Ejecute las pruebas de integración contra un PostgreSQL de pruebas. Sin estas variables, esas pruebas se omiten.
   - **Use un servidor desechable**, nunca uno con datos reales. Las pruebas crean y eliminan bases y roles, y endurecen el servidor: quitan el acceso público a `postgres` y `template1`, y los objetos grandes en `template1`.
   - La cuenta indicada debe ser superusuario. Las pruebas la usan solo para crear una cuenta de aprovisionamiento temporal **sin** superusuario, y operan con esa cuenta.
   ```sh
   export TEST_PG_HOST=127.0.0.1 TEST_PG_PORT=5432 TEST_PG_USER=postgres TEST_PG_PASSWORD='<contraseña de su servidor de pruebas>' TEST_PG_TLS=disable
   export REQUIRE_DB_ENGINES=postgresql   # hace fallar (en vez de omitir) si falta el motor
   pnpm --filter @auditor-21719/persistence exec vitest run
   ```
   Para SQL Server use las variables equivalentes `TEST_MSSQL_HOST`, `TEST_MSSQL_PORT`, `TEST_MSSQL_USER`, `TEST_MSSQL_PASSWORD` y `TEST_MSSQL_TLS` (`trust-server-certificate` solo para contenedores de prueba). En Windows (PowerShell) use `$env:TEST_PG_HOST="127.0.0.1"`, etc.

---

## Pruebas de extremo a extremo de las pantallas (2C-2)

Prueban las pantallas en un navegador real (Chromium) contra la API real y un PostgreSQL, con axe-core (accesibilidad) en cada pantalla y con la CSP de Caddy aplicada. Requieren la Opción B instalada (pasos 1–4) y un **PostgreSQL desechable** (el mismo de las pruebas de integración del paso 7: nunca uno con datos reales). No requieren Docker.

1. Compile todo (la API, los paquetes y la web):
   ```sh
   pnpm run build
   ```
2. Instale el navegador de pruebas **una sola vez** (descarga Chromium; en Linux, `--with-deps` instala además las bibliotecas del sistema y pide permisos de administrador):
   ```sh
   pnpm --filter @auditor-21719/web exec playwright install --with-deps chromium
   ```
3. Defina las variables del PostgreSQL de pruebas (cuenta de superusuario de ese servidor desechable):
   ```sh
   export TEST_PG_HOST=127.0.0.1 TEST_PG_PORT=5432 TEST_PG_USER=postgres TEST_PG_PASSWORD='<contraseña de su servidor de pruebas>' TEST_PG_TLS=disable
   ```
   En Windows (PowerShell) use `$env:TEST_PG_HOST="127.0.0.1"`, etc.
4. Ejecute las pruebas (tardan unos 10 minutos: algunas esperan el siguiente código de la app autenticadora):
   ```sh
   pnpm --filter @auditor-21719/web e2e
   ```
   Debe terminar con `15 passed`. Si algo falla, las capturas y trazas quedan en `apps/web/test-results/` (excluido de Git); ábralas con `pnpm --filter @auditor-21719/web exec playwright show-trace <ruta del trace.zip>`.

Qué hacen por dentro (para saber qué toca en su servidor de pruebas): crean una cuenta de aprovisionamiento sin superusuario, una base de control y una organización ficticia con nombres aleatorios, arrancan la API en `127.0.0.1:3187` y la web en `127.0.0.1:4187`, y al terminar **borran** todo lo que crearon. Para conservarlo e inspeccionarlo, agregue `E2E_KEEP=1` antes del comando. Los puertos se cambian con `E2E_API_PORT` y `E2E_WEB_PORT`.

## Probar la verificación independiente de la bitácora

Requiere haber hecho los pasos 1–4 de la Opción B.

```sh
pnpm --filter @auditor-21719/audit-log build
sh scripts/smoke-audit-log.sh
```

Debe terminar con `OK: reescritura detectada por el anclaje externo.` La guía completa de la CLI está en `verificacion-de-integridad.md`.

## Problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop cerrado | Ábralo y espere a que termine de iniciar |
| La API se reinicia una y otra vez; el registro dice `ORGANIZATION_... está vacío` o `No se pudo leer ORGANIZATION_...` | No se entregaron los secretos de la API | Ejecute los pasos 5 y 6 de la Opción A y luego `docker compose -f deploy/compose/compose.yaml up -d --force-recreate --wait api` |
| La API responde `503` ("El servicio no está disponible") | La organización está suspendida, o se cambió la contraseña de su base sin reescribir los secretos | `tenant reactivate`, o `sh scripts/write-api-secrets.sh <id>` y reinicie la API |
| `port is already allocated` (8080) | Otro programa usa el puerto | Cierre ese programa o cambie `127.0.0.1:8080:8080` a `127.0.0.1:8081:8080` en `deploy/compose/compose.yaml`; luego use `sh scripts/smoke-compose.sh desarrollo 8081` |
| `ERR_PNPM_OUTDATED_LOCKFILE` | Cambió `package.json` sin actualizar el lockfile | Ejecute `pnpm install` (sin `--frozen-lockfile`) y versione `pnpm-lock.yaml` |
| `Unsupported engine` / `ERR_PNPM_UNSUPPORTED_ENGINE` | Node.js distinto de 24 (el proyecto lo exige) | Instale Node.js 24 LTS |
