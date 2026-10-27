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

Con los servicios levantados (paso 3), en la misma terminal:

1. Prepare la base de control (una vez, y después de cada actualización):
   ```sh
   docker compose -f deploy/compose/compose.yaml exec api node dist/admin/cli.js init
   ```
2. Cree una organización ficticia (identificador en minúsculas, dígitos y guiones):
   ```sh
   docker compose -f deploy/compose/compose.yaml exec api node dist/admin/cli.js tenant create --slug muni-demo --name "Municipalidad Demo"
   ```
3. Liste las organizaciones:
   ```sh
   docker compose -f deploy/compose/compose.yaml exec api node dist/admin/cli.js tenant list
   ```
4. Exporte la bitácora de una organización a un archivo de su equipo:
   ```sh
   docker compose -f deploy/compose/compose.yaml exec -T api node dist/admin/cli.js audit export --tenant muni-demo > bitacora-muni-demo.jsonl
   ```
   Ábrala con cualquier editor de texto: cada línea es una acción registrada.
5. Suspenda o reactive: `... cli.js tenant suspend --slug muni-demo` / `... cli.js tenant reactivate --slug muni-demo`.

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
