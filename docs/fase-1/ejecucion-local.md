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

1. Asegúrese de que Docker Desktop esté **abierto y en ejecución** (ícono de la ballena sin advertencias).
2. Genere los secretos locales (contraseñas aleatorias; nunca se suben a Git):
   ```sh
   sh scripts/generate-secrets.sh
   ```
   Debe ver `Creado: postgres_password`, `Creado: valkey.conf` y `Creado: master.key`.
   **Respalde `deploy/compose/secrets/master.key` fuera del equipo**: sin ella no se pueden abrir las bases de las organizaciones.
3. Construya y levante los servicios (la primera vez tarda varios minutos):
   ```sh
   docker compose -f deploy/compose/compose.yaml up -d --build --wait
   ```
   Termina cuando todos los servicios aparecen como `Healthy` o `Started`.
4. Abra en el navegador: **http://127.0.0.1:8080**
   Debe ver "Auditor 21719", el estado de la Fase 1 y el enlace "Código fuente de esta versión".
5. (Opcional) Ejecute las comprobaciones automáticas de seguridad del despliegue **sobre una instalación recién creada** (crea dos organizaciones ficticias; si ya existen, falla):
   ```sh
   sh scripts/smoke-compose.sh desarrollo
   ```
   Debe terminar con `Todas las comprobaciones pasaron.`
6. Para detener todo:
   ```sh
   docker compose -f deploy/compose/compose.yaml down
   ```
   Para detener **y borrar los datos** (bases de datos de prueba): agregue `-v` al final.

### Administrar organizaciones (entrega 2A)

La administración se hace con el servicio `admin`. No queda corriendo: cada comando lo inicia, lo ejecuta y lo elimina (`run --rm`). Es el **único** contenedor que recibe la contraseña de aprovisionamiento y la clave maestra; la API que atiende la web no las tiene.

Con los servicios levantados (paso 3), en la misma terminal:

1. Si su volumen de PostgreSQL se creó **antes** de esta versión, bórrelo para que se cree la cuenta de aprovisionamiento. Esto elimina todos los datos locales (que solo deben ser ficticios):
   ```sh
   sh scripts/generate-secrets.sh
   docker compose -f deploy/compose/compose.yaml down -v
   docker compose -f deploy/compose/compose.yaml up -d --build --wait
   ```
   Si no puede borrar los datos, siga `docs/fase-2/servidor-de-base-de-datos.md`, sección 1.
2. Prepare la base de control (una vez, y después de cada actualización):
   ```sh
   docker compose -f deploy/compose/compose.yaml run --rm admin init
   ```
   Si aparece una línea que empieza con `Aviso:`, léala: indica un ajuste de seguridad pendiente del servidor.
3. Cree una organización ficticia (identificador en minúsculas, dígitos y guiones):
   ```sh
   docker compose -f deploy/compose/compose.yaml run --rm admin tenant create --slug muni-demo --name "Municipalidad Demo"
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
   La suspensión la aplica el propio motor: el usuario de esa organización ya no puede iniciar sesión, y sus sesiones abiertas se cierran. Si el comando termina con `CON ADVERTENCIAS` (código 1), lea el aviso: por ejemplo, puede quedar una sesión abierta. La reactivación se rechaza si no puede registrarse en la bitácora.
8. Otras operaciones:

   | Comando | Para qué sirve |
   |---|---|
   | `tenant check` | Comprueba cada organización activa: que abre con sus credenciales, que su usuario no se fijó parámetros de sesión propios y que no puede crear objetos grandes. Sale con código 1 si encuentra algo |
   | `tenant rotate-password --slug <id>` | Fija una contraseña nueva para el usuario de la organización (p. ej. si `tenant check` falla porque alguien la cambió) |
   | `tenant cleanup-provisioning --slug <id>` | Limpia un alta que quedó a medias (p. ej. si se cortó la luz durante `tenant create`). `init` avisa cuando hay una |
   | `user invite-admin --tenant <id> --email <correo> --name <nombre>` | Invita al **primer administrador** de una organización (entrega 2B). Imprime un token de activación de un solo uso, válido 24 h |
   | `user unlock --tenant <id> --email <correo>` | Desbloquea una cuenta bloqueada por intentos fallidos (por ejemplo, si alguien la bloquea a propósito) |

9. Active al primer administrador (entrega 2B; las pantallas llegan en 2C, por ahora se usa la API):
   - Invítelo y copie el token que se imprime (se muestra **una sola vez**):
     ```sh
     docker compose -f deploy/compose/compose.yaml run --rm admin user invite-admin --tenant muni-demo --email admin@muni-demo.example --name "Administración Demo"
     ```
   - Fije la contraseña (mínimo 12 caracteres, que no sea común ni contenga su correo). Reemplace `<TOKEN>`:
     ```sh
     curl -c cookies.txt -H "content-type: application/json" -d '{"organization":"muni-demo","token":"<TOKEN>","password":"una frase larga y propia"}' http://127.0.0.1:8080/api/v1/auth/activate
     ```
     Debe responder `"stage":"mfa_enroll"`: un administrador **debe** configurar la verificación en dos pasos (app autenticadora) antes de usar la plataforma. Ese paso se hará con la pantalla de 2C.
   - Borre `cookies.txt` al terminar: contiene su sesión.

**Notas**
- Solo el puerto 8080 queda abierto y únicamente en su propio equipo (127.0.0.1); nadie más en la red puede acceder.
- La API, PostgreSQL y Valkey no tienen salida a Internet.

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
| `port is already allocated` (8080) | Otro programa usa el puerto | Cierre ese programa o cambie `127.0.0.1:8080:8080` a `127.0.0.1:8081:8080` en `deploy/compose/compose.yaml`; luego use `sh scripts/smoke-compose.sh desarrollo 8081` |
| `ERR_PNPM_OUTDATED_LOCKFILE` | Cambió `package.json` sin actualizar el lockfile | Ejecute `pnpm install` (sin `--frozen-lockfile`) y versione `pnpm-lock.yaml` |
| `Unsupported engine` / `ERR_PNPM_UNSUPPORTED_ENGINE` | Node.js distinto de 24 (el proyecto lo exige) | Instale Node.js 24 LTS |
