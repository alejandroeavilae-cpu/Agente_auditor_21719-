# Fase 2 · Entrega 2C-1: Ajustes de identidad y despliegue. Registro

- **Base:** diseño aprobado por el responsable el 29-10-2026 23:31 (D-88, `2c-diseno.md` §1).
- **Rama:** `fase-2c`.
- **Estado:** **Implementado.** Probado localmente con PostgreSQL 16.15. **Verificado en CI** (`6500602`: identidad 29 y persistencia 24 por motor en PostgreSQL 18 y SQL Server; prueba de humo local e institucional; escaneos en verde) y por **QA independiente en dos revisiones** (aprobado con observaciones; evidencia `qa-*` y `qa2-*`). `[PENDIENTE: aprobación del responsable]`. Quien implementó **no** aprueba su propio trabajo (regla 5).

## 1. Qué se implementó

| # | Punto | Implementación | Archivos principales |
|---|---|---|---|
| 1 | **D-75 ajustada** | `POST /auth/login` recibe `{ email, password }` y `POST /auth/activate` recibe `{ token, password }`. Si llega `organization`, la petición se rechaza con `invalid_request` (`z.strictObject`). La organización es la de la instalación. La cookie contiene solo el token (43 caracteres): una cookie con el formato antiguo `<slug>.<token>` se rechaza. Mensaje: "Correo o contraseña incorrectos." Se mantienen los 300 ms mínimos | `apps/api/src/identity/auth.controller.ts`, `identity.service.ts`, `errors.ts` |
| 2 | **D-86** | `MFA_REQUIRED_ROLES` = los 6 roles. Quien no tiene MFA entra en `mfa_enroll` | `packages/identity/src/rbac.ts` |
| 3 | **D-87 precisada por D-88** | La API **no** recibe la clave maestra, no usa `auditor_api` y no lee la base de control. Lee tres archivos: `ORGANIZATION_FILE` (JSON con id, slug, nombre, base, usuario e id de la DEK), `ORGANIZATION_DB_PASSWORD_FILE` y `ORGANIZATION_DEK_FILE` (mismo formato que `encodeKeyForFile`). Los secretos MFA y el HMAC de IP siguen usando `tenantCrypto(id, dek)`, con la misma derivación: no cambia nada cifrado (lo prueba la rotación, §2). `OrganizationDirectory` abre la base con esas credenciales y comprueba que la base se declare como esa organización | `apps/api/src/identity/identity-config.ts`, `apps/api/src/main.ts`, `packages/persistence/src/tenant-handle.ts` |
| 3 | CLI | `auditor-admin api-secrets write --tenant <id> --out <dir>` escribe los tres archivos con permisos 0600. Cada uno se escribe en un temporal nuevo (`O_CREAT\|O_EXCL\|O_NOFOLLOW`, `fsync`) y luego se renombra sobre el destino. El directorio no puede ser un enlace ni modificable por cualquiera. `tenant rotate-password --slug <id> --api-secrets-out <dir>` revisa el directorio **antes** de cambiar la contraseña y luego reescribe los secretos. Sin la opción, avisa que la API quedará con la contraseña anterior. `init` ya no concede lectura a `auditor_api`. Se eliminan `grantControlRead` y `initControl({ apiReader })`. La bitácora registra `tenant.api_secrets_written` | `apps/api/src/admin/cli.ts`, `apps/api/src/admin/api-secrets.ts`, `packages/persistence/src/tenant-manager.ts`, `provisioner.ts` |
| 3 | Suspensión | Sigue haciendo `NOLOGIN` / `ALTER LOGIN … DISABLE` y cierra las sesiones (`pg_terminate_backend` / `KILL`), como en 2A. **Nuevo:** si la base de la organización falla (conexión cerrada o rechazada), la API responde `503 unavailable` sin detalles en login, activación y toda ruta con sesión. Al reactivar se recupera sola | `identity.service.ts` (`entry`) |
| 3 | Compose | La API monta solo `organization.json`, `organization_db_password` y `organization_dek`. Sin `master.key` ni `api_db_password`. `postgres-init` ya no crea `auditor_api`. `generate-secrets.sh` crea marcadores vacíos (la API se niega a arrancar con ellos). `scripts/write-api-secrets.sh <id> [--rotate]` ejecuta la CLI en el servicio `admin` con el usuario del anfitrión y monta solo `secrets/api` | `deploy/compose/compose.yaml`, `deploy/compose/postgres-init/…`, `scripts/*.sh` |
| 4 | **Mitigación de R-34** | Bloqueo progresivo por **cuenta + origen** (IP como HMAC con la DEK, propósito `login-origin`), con contadores separados de contraseña y MFA, en la tabla nueva `login_throttle` (migración `0003_login_throttle`; `0002` no se modifica). Privilegios por `IDENTITY_TABLES` y `grantAppPrivileges`, que `init` reaplica a organizaciones existentes. La limpieza usa la retención del registro de accesos (D-78) y nunca borra un bloqueo vigente. Detección de ataque distribuido: con al menos `ATTACK_ALERT_THRESHOLD` fallos verificados en 1 hora (20 por defecto `[ESTIMACIÓN]`) desde al menos 2 orígenes, se registra `account.attack_suspected` **una vez por ventana**, sin IP y sin bloquear. El desbloqueo (API y CLI) borra los pares de contraseña y MFA de todos los orígenes | `packages/persistence/src/schema.ts`, `identity.service.ts` |
| 5 | Observaciones QA 2B §7 | Los tokens de sesión emitidos (todas las cookies vistas por los clientes de prueba), la contraseña de la base de la organización y la DEK entran en la prueba de valores centinela. Nueva prueba de `Set-Cookie`: `HttpOnly`, `SameSite=Strict` y `Path=/`; con `COOKIE_SECURE=true`, además `Secure`, el prefijo `__Host-` y sin `Domain` | `apps/api/test/identity.int.test.ts` |
| 6 | Perfil institucional HTTPS | `compose.institucional.yaml` (override): Caddy en `${AUDITOR_HTTPS_BIND:-0.0.0.0}:${AUDITOR_HTTPS_PORT:-443}` → 8443 del contenedor, con `ports: !override` (desaparece `127.0.0.1:8080`). `Caddyfile.institucional` con las mismas cabeceras y CSP, más HSTS. Dos modos de certificado mediante `AUDITOR_TLS`: `internal` (CA interna de Caddy) o las rutas de los secretos `tls_cert` y `tls_key` (certificado propio). La CA se guarda en el volumen `caddy-data` (dueño 65532 en la imagen). `COOKIE_SECURE=true`. Guía para personas no expertas: `instalacion-institucional.md`, con la advertencia de R-35 y la instalación del certificado raíz en Windows, macOS, Linux y Firefox. Recorrido automático: `scripts/smoke-institucional.sh` (curl con `--cacert` del certificado raíz extraído del contenedor) | `deploy/compose/compose.institucional.yaml`, `deploy/docker/Caddyfile.institucional`, `deploy/docker/Dockerfile` |
| 7 | CI y documentación | En la prueba de humo se levantan primero `postgres` y `valkey`. `smoke-compose.sh` instala (init, organización, `write-api-secrets.sh`) y recién entonces levanta la API. Nuevo paso de CI con el perfil institucional. Mínimo de pruebas de identidad por motor: 21 → **25**. Persistencia sigue en 24. `ejecucion-local.md` y `servidor-de-base-de-datos.md` actualizados, este último con cómo quitar `auditor_api` de una instalación 2B | `.github/workflows/ci.yml`, `docs/…` |

## 2. Pruebas

### 2.1 Ejecutadas localmente (30-10-2026, Node 24.22.1, pnpm 10.28.0, PostgreSQL 16.15)

| Comando | Resultado real |
|---|---|
| `pnpm run verify` (sin motores, igual que el job `verify` de CI) | Código 0. SPDX, build, lint y tipos OK. Pruebas: web 4, crypto 15, audit-log 44, identity 19, persistence 23 + 1 omitida (integración sin motor), api 28 + 1 omitida (integración sin motor). Licencias: 314 paquetes, todos permitidos |
| `pnpm exec vitest run` en `apps/api` con `TEST_PG_*` | **53 aprobadas, 0 fallidas, 0 omitidas** |
| Identidad (`test/identity.int.test.ts`) + `check-integration-report.mjs` con `MIN_TESTS_PER_ENGINE=25` | **25 aprobadas, 0 fallidas, 0 omitidas · postgresql=25**. Informe: `evidencia-2c1/identidad-pg.json` |
| `pnpm exec vitest run` en `packages/persistence` + `check-integration-report.mjs` con `MIN_TESTS_PER_ENGINE=24` | **47 aprobadas, 0 fallidas, 0 omitidas · postgresql=24**. Informe: `evidencia-2c1/organizaciones-pg.json` |
| `docker compose -f deploy/compose/compose.yaml config -q`, y la combinación con `compose.institucional.yaml` (con `AUDITOR_SITE_ADDRESS` definido) | Ambas configuraciones válidas. La combinada publica solo `127.0.0.1:8443→8443` (desaparece 8080), `COOKIE_SECURE: "true"` en la API y el volumen `caddy-data`. Sin `AUDITOR_SITE_ADDRESS`, Compose falla con el mensaje que remite a la guía |
| `sh -n` de los scripts nuevos o modificados | Sin errores de sintaxis |

### 2.2 Pruebas de integración nuevas o cambiadas (identidad, por motor)

- La API recibe solo los secretos de su organización, con permisos 0600 (escritos con la CLI real `api-secrets write`).
- D-75: el campo `organization` se rechaza en el login y la activación. Fallo con respuesta idéntica y al menos 300 ms. La cookie es solo el token. Una sesión de A no sirve en la API de B, ni con el formato antiguo.
- D-86: un `auditor` debe configurar la MFA y luego pasa por `mfa_pending`.
- R-34 (1): el atacante desde el origen A bloquea solo A. 30 intentos en paralelo durante el bloqueo no cuentan. Ni la contraseña correcta entra desde A. La víctima entra desde B. Al vencer la espera, de 20 intentos en paralelo cuenta **uno** (`failed_attempts` = 6). El desbloqueo por CLI limpia todos los pares.
- R-34 (2): 5 orígenes × 4 fallos generan **una** alerta `account.attack_suspected` con `{ failures: 20, origins: 5, windowMinutes: 60, threshold: 20 }`, sin IP. Más fallos en la ventana no la repiten. La cuenta no se bloquea. En la ventana siguiente se vuelve a alertar.
- 2B-01 y 2B-11 adaptados al par cuenta + origen. Con 30 intentos en paralelo el contador queda **exactamente** en 5.
- Valores centinela con tokens de sesión, contraseña de la base y DEK. Cabecera `Set-Cookie` con y sin `COOKIE_SECURE`.
- D-87: `rotate-password --api-secrets-out` produce una contraseña nueva con la **misma DEK**. Una API nueva con esos secretos inicia sesión con MFA, lo que comprueba que los secretos MFA cifrados antes siguen abriendo.
- D-87: tras `tenant suspend` no quedan sesiones del usuario de la organización (sin advertencias). `/me` y el login responden `503 unavailable` con solo `error` y `message`, y sin cookie. Al reactivar, la sesión existente vuelve a funcionar.

Pruebas unitarias nuevas: configuración (DEK de otra organización, slug distinto, permisos 0644, archivo vacío, JSON con campos extra, variables de 2B sin efecto), `writeApiSecrets` (0600, sin temporales, reemplaza un enlace sin escribir en su destino, rechaza un directorio enlace o con permisos 777) y códigos de salida de la CLI para `api-secrets`.

### 2.3 Solo verificable en CI `[PENDIENTE]`

- **SQL Server**: identidad (25 pruebas esperadas, mismo archivo) y organizaciones (24). En particular, `KILL` y `ALTER LOGIN DISABLE` con la API conectada (prueba de suspensión), la violación de unicidad 2627/2601 en `login_throttle` y `COUNT(DISTINCT ip)`.
- **Prueba de humo de Compose** (`smoke-compose.sh`), con los pasos nuevos:
  - 0: instalación antes de la API;
  - 9: montajes de la API y ausencia de `auditor_api`;
  - 14: rotación y reinicio, con medición del tiempo de reinicio para el `[SUPUESTO]` de `2c-diseno.md` §1.3;
  - 15: suspensión con 503.
- **Perfil institucional** (`smoke-institucional.sh`): HTTPS con `--cacert` del certificado raíz, rechazo sin él, cabeceras con HSTS, sin HTTP en claro, cookie `__Host-` con `Secure`, CA conservada al reiniciar. **La sintaxis de `Caddyfile.institucional` no se validó localmente**: no hay imágenes ni binario de Caddy, y el proxy de la sesión bloqueó la descarga de Docker Hub y de `proxy.golang.org`.
- Construcción de las imágenes con el cambio del `Dockerfile` (`/data` para Caddy).

## 3. Decisiones técnicas tomadas en la implementación (para registrar) `[DECISIÓN técnica, pendiente de registro en 21-decisiones.md]`

1. **Reserva del intento con comparar y reemplazar.** Leer la fila y aplicar una actualización condicional (`failed_attempts` y `locked_until` iguales a lo leído) en lugar del incremento atómico seguido del reclamo del bloqueo de 2B. Conserva D-82 y D-83: ningún fallo se pierde en paralelo antes del umbral, entra un intento al vencer cada ventana y los intentos durante un bloqueo no cuentan. Además corrige un efecto que existía con el bloqueo por cuenta: una ráfaga al vencer la espera **contaba todos** sus intentos y llevaba la espera directo al tope de 15 min (descrito en R-34). Tras 50 vueltas sin resolver la contención se niega el intento (falla segura).
2. **Bloqueos de contraseña y MFA independientes.** Con el bloqueo de MFA vigente, la contraseña correcta igual da una sesión `mfa_pending`, pero la verificación MFA se rechaza. En 2B, `locked_until` era compartido.
3. **Detección de ataque distribuido:**
   - cuenta solo fallos **verificados** (`auth.login.failed`, `auth.mfa.failed`, `auth.reauth.failed`, `auth.password.change_failed`) del registro de accesos;
   - exige al menos **2 orígenes distintos**;
   - la marca "ya alertado" es una fila `kind = 'attack_alert'` con origen de 64 ceros en `login_throttle`;
   - actor `sistema:deteccion-ataques`;
   - nuevos eventos de solo registro de accesos `auth.reauth.blocked` y `auth.password.change_blocked`, para separar lo rechazado por bloqueo de lo verificado;
   - índice nuevo `access_log(user_id, ts)`.
4. **Columnas de bloqueo de `app_user`** (`failed_attempts`, `mfa_failed_attempts`, `locked_until`): se conservan sin uso, porque `0002` está publicada. Su eliminación queda para una migración futura.
5. **Datos de la organización en un archivo** (`organization.json`, que escribe la CLI) y no en variables. `ORGANIZATION_SLUG` queda como comprobación **opcional**. El diseño (§1.1) la describía como obligatoria; se hizo opcional para que la instalación no exija editar variables, ya que el archivo contiene el slug. Requiere confirmación del responsable.
6. **`dekId` en el archivo de la organización**: la API se niega a arrancar si la DEK no corresponde. Es el identificador público de la clave, el mismo que va en cada dato cifrado.
7. **Error de la base de la organización → 503 `unavailable`** (en 2B, una organización suspendida daba 401).
8. **Permisos de los archivos de secretos:** `SECRETS_CHECK_PERMISSIONS=true` por defecto, y `false` en Compose, igual que `MASTER_KEY_CHECK_PERMISSIONS`. `write-api-secrets.sh` deja los archivos en 644 dentro de `secrets/api` (700), porque el contenedor lee con otro usuario.
9. **La API no recarga la contraseña en caliente:** tras rotarla hay que reiniciarla, como indica el diseño.
10. **Certificado propio como secretos de Compose** (`tls_cert`, `tls_key`), no como carpeta montada: una carpeta 700 del anfitrión no sería legible para el usuario 65532.
11. **Cookies con el formato de 2B** (`<slug>.<token>`): dejan de ser válidas y hay que volver a iniciar sesión. No hay usuarios reales.

## 4. Riesgos y pendientes

- **R-33**: la API ya no tiene la clave maestra ni acceso a la base de control. Comprometerla expone solo la organización de la instalación. `[PENDIENTE: reevaluación por QA y el responsable]`.
- **R-34**: mitigado por el bloqueo por cuenta + origen, la MFA obligatoria y la alerta. **Riesgo residual:**
  - un atacante con **muchas IP** puede sumar 4 intentos por origen sin bloquearse. Solo queda la alerta y, como defensa principal, la MFA;
  - detrás de un NAT o proxy común, todos comparten el origen. `[PENDIENTE: reevaluación por QA]`.
- **R-35**: advertencia incluida en la guía institucional y en `ejecucion-local.md`.
- `[PENDIENTE]` `write-api-secrets.sh` en Windows/Git Bash (rutas de Docker Desktop): `[SUPUESTO]`, probado solo en Linux.
- `[PENDIENTE]` Versión mínima de Docker Compose para `!override` (la guía la marca como fuente secundaria).
- `[PENDIENTE]` Vigencia del certificado raíz de la CA interna según la versión de Caddy usada.
- Instalaciones con la base de 2B: quitar `auditor_api` a mano (`servidor-de-base-de-datos.md`, "Actualizar desde 2B").

## 5. Correcciones tras la primera ejecución de CI (PR #5, commit `8d247e5`)

| Fallo en CI | Causa | Corrección |
|---|---|---|
| **SQL Server:** `D-87: al suspender…` excedió 30 s (sqlserver=24 de 25) | Con el login deshabilitado, el pool `tarn` de tedious **reintenta** crear la conexión cada 200 ms hasta su espera por defecto de 30 s (`acquireTimeoutMillis`), en vez de fallar. `pg.Pool` falla al primer error de autenticación | `connect()`: `propagateCreateError: true`, `acquireTimeoutMillis` y `createTimeoutMillis` de 20 s, y `requestTimeout` de 30 s explícito en tedious. La prueba registra los tiempos (PostgreSQL local: 503 en 3 ms y 6 ms; 200 al reactivar en 7 ms), exige fallar en menos de 10 s y tiene su propio plazo de 90 s. `[PENDIENTE: resultado en SQL Server en CI]` |
| **CodeQL** `js/clear-text-logging` en `cli.ts` | El mensaje de `api-secrets write` imprimía rutas devueltas por `writeApiSecrets`, que recibe los secretos | `writeApiSecrets` ya no devuelve nada. La CLI imprime solo los nombres constantes de `API_SECRET_FILES` y el directorio indicado por quien ejecuta. Si la escritura falla en `rotate-password`, se imprime un aviso sin datos del error y el error de archivos se propaga |
| **Gitleaks** `generic-api-key` en `smoke-compose.sh:16` (`5e31731`) y `smoke-institucional.sh:18` (`4d307cf`) | Frase de acceso sintética literal del administrador de una instalación efímera de prueba | Falso positivo: no es credencial de ningún sistema. Huellas agregadas a `.gitleaksignore` con su justificación. Los scripts ahora generan una frase aleatoria por ejecución (`deploy/compose/secrets/smoke_admin_phrase`, excluido de git) |

## 6. Correcciones de la verificación QA de 2C-1 (veredicto "aprobado con observaciones" sobre `bccb96f`)

`2C1-04` (bloqueo de MFA por cuenta + origen) **no se modificó** en esta ronda: quedó pendiente de decisión del responsable. Se resolvió con D-89 (§7).

| Hallazgo | Corrección | Prueba |
|---|---|---|
| **2C1-05** `TRUST_PROXY` | Se documenta en `identity-config.ts`, `compose.yaml`, la guía institucional y `ejecucion-local.md` que `TRUST_PROXY=true` solo es válido con **exactamente un** proxy delante y la API sin publicar. Si no, un cliente fija su IP con `X-Forwarded-For` y elude el límite por IP y el bloqueo por origen. La API emite un aviso (`warn`) al arrancar con `TRUST_PROXY=true` | La prueba de humo ya comprueba que la API no publica puertos (paso 4) y que una `X-Forwarded-For` del cliente no falsifica la IP (paso 13) `[PENDIENTE: CI]` |
| **2C1-06** MFA sin depender de los roles | `requiresMfa()` devuelve siempre `true`. Inicio de sesión y activación ya no consultan los roles para decidir la etapa | Unitaria: `requiresMfa()` es `true`. Integración: un usuario con un rol no reconocido, y luego sin ninguna fila de rol, queda en `mfa_enroll` |
| **2C1-07** Rotación y conexiones abiertas | `rotatePassword` cierra las sesiones del usuario de la organización después de `resetPassword`, con el mismo mecanismo de la suspensión (`terminateSessions`: `pg_terminate_backend` / `KILL`), y espera a que se cierren. Devuelve `{ secrets, warnings }`, con los avisos separados de los secretos para no mezclarlos en lo que se imprime. La CLI termina con código 1 si quedan sesiones abiertas | Integración: la API con la contraseña anterior responde `503 unavailable`; la reiniciada con la nueva funciona, y la sesión anterior sigue valiendo en ella (vive en la base) |
| **2C1-08** Directorio de secretos | `checkSecretsDir` rechaza cualquier directorio con escritura para el grupo o para otros (`mode & 0o022`) | Unitaria: se rechazan `777`, `770` y `702`; se acepta `750` |
| **2C1-09** Valores centinela | La prueba se movió **al final** de la suite y ahora revisa las bases de **ambas** organizaciones | Es la última prueba del bloque |
| **2C1-10** Bitácora y bloqueos | `auth.account.locked` va a la bitácora inmutable **una vez por cuenta, contador (contraseña o MFA) y ventana de 1 hora**. La ventana se reclama con la misma marca condicional de la alerta de ataque (`kind` `lock_logged_pw` o `lock_logged_mfa`, origen fijo). El registro de accesos sigue anotando cada bloqueo con su IP | Integración: 6 orígenes bloqueados dejan 6 bloqueos en el registro de accesos y 1 en la bitácora. En la ventana siguiente, 2 bloqueos más dejan 8 y 2. La prueba R-34 (dos bloqueos del mismo origen) espera 1 en la bitácora y 2 en el registro de accesos |
| **2C1-12** Llave privada TLS | La guía ya no indica `chmod 644` para la llave: `sudo chown 65532:65532` y `chmod 400`, para que solo pueda leerla el usuario de Caddy en el contenedor. Docker conserva dueño y permisos en el montaje. Explica por qué `644` dejaría la protección solo en la carpeta 700. El certificado sigue en 644, porque es público | `[PENDIENTE]` CI prueba la CA interna, no el certificado propio |

### Ejecución local (30-10-2026, PostgreSQL 16.15)

| Comando | Resultado real |
|---|---|
| `pnpm run verify` | Código 0. web 4, crypto 15, audit-log 44, identity 19, persistence 23 + 1 omitida, api 28 + 1 omitida. Licencias: 314 paquetes permitidos |
| `vitest run` en `apps/api` con PostgreSQL | **55 aprobadas**, 0 fallidas |
| Identidad + `check-integration-report` (mínimo 27) | **27 aprobadas · postgresql=27**. Informe: `evidencia-2c1/identidad-pg-qa1.json` |
| Organizaciones + `check-integration-report` (mínimo 24) | **47 aprobadas · postgresql=24**, incluidas las de rotación (M-02), que ahora cierran sesiones. Informe: `evidencia-2c1/organizaciones-pg-qa1.json` |

Mínimo de CI para identidad: 25 → **27** por motor. En CI, SQL Server alcanzó el mismo número `[VERIFICADO: CI de 6500602]`.

## 7. Bloqueo de MFA por cuenta (D-89, hallazgo QA 2C1-04)

**Estado:** Implementado y probado localmente con PostgreSQL 16.15. Verificado en CI y por QA (segunda revisión, `qa2-*`). `[PENDIENTE: aprobación del responsable]`. Quien implementó no aprueba su propio trabajo (regla 5).

### 7.1 Qué cambió

| Punto | Implementación | Archivos |
|---|---|---|
| Contador de MFA por cuenta | `throttleOrigin()` decide la fila: contraseña → HMAC del origen (sin cambios, D-88); MFA → origen fijo `ACCOUNT_ORIGIN` (64 ceros, el mismo de las filas `attack_alert` y `lock_logged_*`). `beginAttempt` y `attemptSucceeded` lo usan. Aplica a `POST /auth/mfa/verify` y a `POST /auth/reauth`, que comparten el contador `mfa` | `apps/api/src/identity/identity.service.ts` |
| D-82 conservada | Misma reserva por comparar y reemplazar **antes** de verificar, ahora sobre la fila de la cuenta: ningún fallo se pierde en paralelo antes del umbral, al vencer cada espera entra **un** intento y la espera crece de forma progresiva hasta 15 min | Ídem |
| D-83 conservada | Los intentos durante un bloqueo vigente no cuentan ni lo alargan. El desbloqueo (API y CLI) borra las filas `password` y `mfa` de la cuenta, y `resetMfa` las `mfa`. Ambos borran también filas `mfa` por origen que hubieran quedado de antes de D-89 | Ídem |
| Bitácora (2C1-10) | `auth.account.locked` sigue yendo a la bitácora inmutable **una vez por cuenta, contador y ventana de 1 hora** (marca `lock_logged_mfa`). El dato `scope` es ahora `account` para la MFA y `account+origin` para la contraseña. El registro de accesos sigue anotando cada bloqueo con su IP | Ídem |
| Esquema | **Sin migración nueva y sin tocar `0003` ni `0002`.** `login_throttle` ya admite filas por cuenta con su clave primaria `(user_id, origin_hmac, kind)`. Solo se agrega el nombre `ACCOUNT_ORIGIN` en el paquete de persistencia; `ATTACK_ALERT_ORIGIN` queda como alias del mismo valor `[DECISIÓN técnica]` | `packages/persistence/src/schema.ts`, `index.ts` |
| Retención | Sin cambios: la fila por cuenta se borra con la retención del registro de accesos (D-78), salvo un bloqueo vigente | — |

### 7.2 Pruebas de integración nuevas (identidad, por motor)

- **D-89 (QA-05):** con la contraseña conocida, 5 códigos errados desde 5 orígenes distintos dejan **una** fila `mfa` con `ACCOUNT_ORIGIN` y `failed_attempts` = 5, sin contadores de MFA por origen. Desde un origen nuevo, la contraseña da `mfa_pending`, pero el código **correcto** (de un paso no usado) se rechaza; también desde el origen de la dueña y en su reautenticación. Esos intentos no cambian la fila y quedan como `auth.mfa.blocked` (2) y `auth.reauth.blocked` (1) en el registro de accesos. La bitácora tiene un `auth.account.locked` con `{ counter: 'mfa', scope: 'account' }`. Tras `POST /users/:id/unlock`, **el mismo código** entra desde otro origen nuevo. Un segundo bloqueo en la misma ventana deja 1 evento en la bitácora y 2 en el registro de accesos; tras `auditor-admin user unlock` se vuelve a entrar.
- **D-89 + D-82:** 30 códigos errados **en paralelo** desde 30 orígenes: exactamente 5 se verifican (`auth.mfa.failed` = 5) y la fila queda en 5 y bloqueada. Al vencer la espera (30 s), de 20 códigos en paralelo desde 20 orígenes cuenta **uno**: `failed_attempts` = 6 y la espera restante es de 60 s como máximo (no salta al tope de 15 min). Restablecer la MFA borra la fila y la persona vuelve a `mfa_enroll`.
- La prueba 2B-01 ya existente sigue pasando sin cambios en sus aserciones (solo el comentario dice "MFA de la cuenta").
- **Prueba de mutación local:** con `throttleOrigin` devolviendo el origen también para la MFA (comportamiento anterior), las dos pruebas nuevas **fallan** (2 fallidas, 27 omitidas por el filtro `-t 'D-89'`). Se restauró el código y se volvió a ejecutar todo.

Mínimo de CI para identidad: 27 → **29** por motor. En CI, SQL Server alcanzó el mismo número `[VERIFICADO: CI de 6500602]`.

### 7.3 Ejecución local (30-10-2026, Node 24.22.1, PostgreSQL 16.15)

| Comando | Resultado real |
|---|---|
| `pnpm run verify` (sin motores) | Código 0. web 4, crypto 15, audit-log 44, identity 19, persistence 23 + 1 omitida, api 28 + 1 omitida. Licencias: 314 paquetes, todos permitidos |
| `vitest run` en `apps/api` con PostgreSQL | **57 aprobadas**, 0 fallidas |
| Identidad + `check-integration-report` (mínimo 29) | **29 aprobadas, 0 fallidas, 0 omitidas · postgresql=29**. Informe: `evidencia-2c1/identidad-pg-d89.json` |
| Organizaciones + `check-integration-report` (mínimo 24) | **47 aprobadas, 0 fallidas, 0 omitidas · postgresql=24**. Informe: `evidencia-2c1/organizaciones-pg-d89.json` |

### 7.4 Riesgos

- **R-34:** el bloqueo por cuenta solo aplica a la MFA, a la que se llega con la contraseña correcta. Quien conoce la contraseña **sí** puede mantener bloqueada la MFA de la cuenta (un intento al vencer cada espera, unas 4 peticiones por hora con el tope de 15 min). Es el costo aceptado por D-89, pero esa situación ya implica una contraseña comprometida: el desbloqueo no basta y corresponde cambiar la contraseña. `[PENDIENTE: reevaluación por QA y el responsable]`.
- El contador de MFA es común a la verificación del inicio de sesión y a la reautenticación: fallos de una cuentan para la otra (igual que en 2B).



## 8. Cierre de la segunda revisión QA (30-10-2026, sobre `6500602`)

Veredicto QA: **APROBADO CON OBSERVACIONES**. Todos los hallazgos funcionales 2C1-04 a 2C1-12 están resueltos; las observaciones nuevas no bloquean.

| ID | Tratamiento |
|---|---|
| 2C1-13 | Corregido: `2c-diseno.md` §1.1 y §1.2 reflejan D-90 y 2C1-06 |
| 2C1-14 | Corregido: se precisa "no recrea R-34 para quien no conoce la contraseña" y se nombra el residual **R-38** |
| 2C1-15 | `[PENDIENTE]` para 2C-2: agregar a la prueba centinela las contraseñas y los códigos de recuperación de los usuarios de las pruebas D-89 y 2C1-06 (la prueba adversarial de QA R2-10 sí los cubrió, 0 apariciones) |
| 2C1-16 | Corregido: estados de esta página actualizados con lo verificado en CI |
| 2C1-17 | D-89 y D-90 se respondieron en un cuestionario de la sesión sin hora registrada; se deja constancia. La aprobación del cierre de 2C-1 por el responsable las ratifica |
| 2C1-12 | `[PENDIENTE]`: el certificado propio de la institución no se prueba en CI; con Docker sin privilegios o con reasignación de usuarios el UID 65532 del anfitrión no coincide con el del contenedor |

Matriz de riesgos: R-33, R-34 y el nuevo R-38 se actualizan con la propuesta QA (`[ESTIMACIÓN]`), sujeta a la aprobación del responsable.

Nota: la sección 1 describe la implementación inicial; las filas 2 (MFA) y 4 (bloqueo) fueron modificadas después por 2C1-06 y D-89 (secciones 6 y 7).
