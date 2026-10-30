# Fase 2 · Entrega 2C-2: Pantallas de usuarios. Registro (parte API)

- **Base:** diseño aprobado por el responsable el 29-10-2026 23:31 (D-88, `2c-diseno.md` §2); inicio de 2C-2 aprobado el 30-10-2026 02:44.
- **Rama:** `fase-2c2`.
- **Alcance de este registro:** solo la **API** que necesitan las pantallas de 2C-2 (agente backend). Las pantallas (`apps/web`) las hace otro agente después; sus pruebas E2E, de accesibilidad y ZAP (2C §2.5) **no** están aquí.
- **Contrato para el frontend:** `2c2-api.md`.
- **Estado:** `[IMPLEMENTADO]` `[PROBADO en PostgreSQL 16.15 local]`. `[PENDIENTE: CI con PostgreSQL 18 y SQL Server; verificación QA independiente; aprobación del responsable]`. Quien implementó **no** aprueba su propio trabajo (regla 5). SQL Server **no** se ejecutó localmente (no hay Docker en este entorno): el código usa los mismos patrones portables ya probados en CI, pero su resultado en SQL Server queda `[PENDIENTE: CI]`.

## 1. Qué se implementó

| # | Punto | Implementación | Archivos principales |
|---|---|---|---|
| 1 | **Registro de accesos** (pregunta 3 de 2C §6, D-88) | `GET /api/v1/access-log`: permiso **nuevo** `access_log.read` (solo `org_admin`) y MFA reciente. Paginación por cursor opaco `(ts, id)` en base64url, orden descendente, `limit` 1–100 (50 por defecto). Filtros: `event` (lista separada por comas, máx. 20, nombres validados), `userId` (UUID), `from`/`to` (ISO UTC, `from < to`). Esquema zod estricto: parámetro no declarado o repetido → `400`. Devuelve id, fecha, evento, usuario (id y correo actual), **IP en claro** (D-78) y familia de navegador; incluye `account.attack_suspected` y `auth.account.locked`. Cada consulta se registra en la bitácora como `access_log.viewed` (filtros, página, cantidad; IP solo como HMAC) y **no** en el registro de accesos | `apps/api/src/identity/logs.controller.ts`, `logs.service.ts` |
| 2 | **Exportación de la bitácora** (2C §2.4) | `GET /api/v1/audit-log/export`: permiso **nuevo** `audit_log.export` (solo `org_admin`) y MFA reciente. Registra primero `audit_log.exported` (IP como HMAC), fija como final la última entrada y envía JSON Lines en **forma canónica** por lotes de 500 (paginación por `seq`), con contrapresión del socket. Cabeceras: `Content-Disposition: attachment; filename="bitacora-<slug>-<fecha>.jsonl"`, `Cache-Control: no-store`, `Content-Type: application/x-ndjson; charset=utf-8`, `X-Audit-Chain-Id: <slug>`. Si falla antes de enviar datos responde JSON de error sin cabeceras de descarga; si falla a mitad, corta la conexión (archivo incompleto, la verificación lo detecta) | `logs.controller.ts`, `logs.service.ts`; `packages/persistence/src/audit-log-repository.ts` (`exportRawBatches`, `lastSeqRaw`, `rawExportRow` compartida con `exportRaw`) |
| 3 | **R-38: aviso al administrador** | `GET /api/v1/users` agrega por usuario `passwordLock { lockedOrigins, lockedUntil }` (bloqueos de contraseña vigentes por origen), `mfaLock { locked, lockedUntil, failedAttempts }`, `passwordCompromiseSuspected` (contador de MFA ≥ 5 sin éxito, desbloqueo ni restablecimiento posterior) y `mustChangePassword`. La regla de "bloqueado" para la pantalla queda en el contrato | `identity.service.ts` (`listUsers`, `UserListItem`) |
| 4 | **R-38: cambio de contraseña obligatorio** (evaluado e **implementado**, recomendación del orquestador) | Migración nueva **`0004_must_change_password`** (`app_user.must_change_password`, entero 0/1, `NOT NULL DEFAULT 0`; 0002/0003 sin cambios). `unlockUser` (API y CLI) la fija **solo** si levanta un bloqueo de MFA (en la primera versión también `resetMfa`; desde D-92 el reinicio invalida la contraseña directamente, §5). Etapa de sesión nueva **`password_change`**: tras la MFA (`mfa/verify` o `mfa/confirm`) la persona solo puede cambiar la contraseña, ver `/me` o cerrar sesión (`403 password_change_required` en lo demás). Una sesión `full` ya abierta pasa a esa etapa al desbloquear. `POST /auth/password` acepta la etapa, exige que la nueva contraseña sea **distinta** de la actual (`400 password_reused`, para todos) y limpia la marca. La CLI avisa al desbloquear. Bitácora: `user.unlocked` y `user.mfa.reset` con `mustChangePassword`, `auth.password.changed` con `forced` | `packages/persistence/src/schema.ts`, `tenant-manager.ts` (columnas esperadas de `cleanupProvisioning`), `identity.service.ts`, `auth.controller.ts`, `apps/api/src/admin/cli.ts` |
| 5 | **API para la SPA** | `GET /auth/me` ya daba etapa, `csrfToken`, usuario, roles y `mfaEnabled`. Se agregó lo mínimo: `permissions` (efectivos, ordenados; solo en `full`) para ocultar opciones, y `session { expiresAt, idleExpiresAt, reauthValidUntil }` para el aviso de expiración (2C §2.2) y para pedir el código antes de una acción de alto riesgo. En etapas previas solo `session.expiresAt` (sin datos del usuario, QA 2B-07) | `auth.controller.ts` |
| 6 | **Matriz de permisos y "toda ruta declara política"** | `PERMISSIONS` y `ROLE_PERMISSIONS` con `access_log.read` y `audit_log.export` solo para `org_admin`; prueba de la matriz ampliada. La prueba de rutas incluye los controladores nuevos (17 rutas), verifica sus políticas exactas y que la etapa `password_change` solo la admiten `changePassword`, `logout` y `me` | `packages/identity/src/rbac.ts`, `packages/identity/test/identity.test.ts`, `apps/api/test/identity-unit.test.ts` |
| 7 | **2C1-15** | Prueba de valores centinela (sigue siendo la **última** de la suite): ahora revisa también las contraseñas de **todos** los usuarios de prueba (incluidos D-89, 2C1-06 y los de 2C-2, vía `syntheticPassword()`), **todos** los tokens de activación, **todos** los códigos de recuperación (tal cual y normalizados) y los secretos TOTP de **todos** los usuarios (hex y base32). Exige más de 100 valores y más de 5 secretos para no pasar vacía | `apps/api/test/identity.int.test.ts` |
| 8 | **OpenAPI** | El proyecto no genera OpenAPI `[VERIFICADO: búsqueda en el repositorio]`: contrato en `2c2-api.md` | `docs/fase-2/2c2-api.md` |
| 9 | **CI** | Mínimos por motor subidos a lo observado en PostgreSQL: identidad **29 → 34**, persistencia **24 → 26** | `.github/workflows/ci.yml` |

Sin dependencias nuevas (`check:licenses`: 314 paquetes, todos permitidos). Sin cambios en `apps/web`.

## 2. Pruebas y resultados reales (30-10-2026, entorno local)

Entorno: Node 24.22.1, PostgreSQL 16.15 local. SQL Server no disponible localmente.

| Ejecución | Resultado |
|---|---|
| `pnpm run verify` (SPDX, build, lint, typecheck, pruebas unitarias, licencias) | **Exit 0.** SPDX en 70 archivos; web 4/4; crypto 15/15; audit-log 44/44; identity 19/19; persistence 23 + 1 omitido (integración sin motor, por diseño); api 31 + 1 omitido (ídem); licencias: 314 paquetes permitidos |
| Identidad por HTTP, `REQUIRE_DB_ENGINES=postgresql`, `test/identity.int.test.ts` + `check-integration-report.mjs` con `SUITE_PREFIX="identidad en"`, `MIN_TESTS_PER_ENGINE=34` | **34 aprobadas, 0 fallidas, 0 omitidas · postgresql=34** (antes 29). Con D-92: **35** (§5) |
| Persistencia, `REQUIRE_DB_ENGINES=postgresql`, `packages/persistence` + `check-integration-report.mjs`, `MIN_TESTS_PER_ENGINE=26` | **49 aprobadas, 0 fallidas, 0 omitidas · postgresql=26** (antes 24) |
| SQL Server | `[PENDIENTE: CI]` |

Pruebas nuevas o cambiadas:

| Prueba | Qué demuestra |
|---|---|
| R-38: lista de usuarios y desbloqueo de MFA | Bloqueo de contraseña desde 2 orígenes → `lockedOrigins: 2`, sin sospecha; desbloquearlo **no** obliga a cambiar. 5 códigos errados desde 5 orígenes → `mfaLock.locked`, `passwordCompromiseSuspected`; sigue en `true` al vencer la espera. Desbloqueo → `mustChangePassword`; la sesión `full` ya abierta pasa a `password_change` (`/me` sin datos, `/users` → `password_change_required`). El tercero con la contraseña no pasa la MFA ni llega a cambiarla. La dueña: MFA → `password_change` → misma contraseña `password_reused` → nueva → `full`; la sesión vieja se cierra y la contraseña anterior deja de servir. Bitácora: `user.unlocked` `[false, true]`, `auth.password.changed` `forced: true` |
| ~~R-38: restablecer la MFA~~ | Reemplazada por la prueba D-92 (§5) |
| `/me` | Permisos exactos del administrador y del lector; `idleExpiresAt` ≈ 30 min; `reauthValidUntil` ≤ 5 min; antes de la MFA solo `csrfToken`, `organization`, `session.expiresAt`, `stage` |
| Registro de accesos | Lector → `403 forbidden` (y en la exportación). Sin MFA reciente → `reauth_required`. 10 parámetros inválidos → `400 invalid_request`; 2 cursores manipulados → `400 invalid_cursor`. Filtro usuario + eventos con IP en claro (`198.51.108.1`, `198.51.109.1`), correo y familia de navegador. `account.attack_suspected` visible. Recorrido completo con páginas de 3 = exactamente las filas de la base, en orden, sin saltos ni repeticiones. Rango futuro vacío. Página por defecto 50. `access_log.viewed` en la bitácora con `ipHmac`, filtros y sin IP; ninguno en `access_log` |
| Exportación | Sin MFA reciente → `403 reauth_required` (JSON); parámetro extra → `400`. Cabeceras exactas. El cuerpo es **idéntico** a `toJsonl(exportAuditLog)` de la CLI de administración; la última línea es `audit_log.exported` del administrador con `ipHmac`; sin IP en claro. **`auditor-log verify` (el `dist/cli.js` real, en un proceso aparte) devuelve 0 e "íntegra"**; con una línea alterada devuelve 1 |
| Persistencia: exportación por lotes | Con lotes de 1, 3, N y 1000 se obtiene exactamente `exportRaw`; con límite superior no entra una entrada agregada después; `null` no entrega nada; lote 0 se rechaza |
| Persistencia: migración 0004 | Sobre una organización "de 2C-1" (columna y registro de 0004 quitados, con un usuario previo), `migrateAllTenants` aplica solo 0004 a esa organización; el usuario previo queda en 0 y la cuenta de la organización puede leer y modificar la columna; queda `schema.migrated` en la bitácora. En SQL Server la prueba quita antes la restricción `DEFAULT` de nombre generado |
| Unitarias | Políticas exactas de las rutas nuevas; solo 3 rutas admiten `password_change`; cursor: ida y vuelta y 7 cursores manipulados rechazados (incluido uno con SQL) |
| D-89 (2C-1), **cambiada** | Tras desbloquear un bloqueo de MFA (por API y por CLI), el código correcto ahora lleva a `password_change` y no a `full`: es el comportamiento nuevo de R-38. Comentado en la prueba |

## 3. Decisiones técnicas tomadas en la implementación (registradas como D-93 por el orquestador, commit `3975b5d`)

1. **Permisos propios** `access_log.read` y `audit_log.export` (solo `org_admin`) en vez de reutilizar `users.manage`: la matriz dice explícitamente quién ve IP en claro y quién exporta, y permite asignarlos a otro rol en el futuro sin darle la gestión de usuarios.
2. **Cambio de contraseña obligatorio al levantar un bloqueo de MFA** (unlock por API o CLI; el reinicio de MFA quedó cubierto por D-92), con la etapa `password_change` **después** de la MFA: el tercero que solo tiene la contraseña no llega a cambiarla. No se aplica a bloqueos solo de contraseña (los provoca quien no la conoce, R-34).
3. **`passwordCompromiseSuspected`** = contador de MFA ≥ 5 (umbral de bloqueo) sin éxito, desbloqueo ni reinicio posterior; persiste aunque la espera haya vencido.
4. **Nueva contraseña distinta de la actual** para todo cambio de contraseña (`password_reused`): sin esto, el cambio obligatorio podría no invalidar lo que conoce el tercero. Costo: una verificación argon2id más por cambio.
5. **Sesiones `full` abiertas** de quien queda obligado a cambiar la contraseña se tratan como `password_change` (etapa efectiva calculada en cada petición), sin cerrarlas.
6. **`access_log.viewed` solo en la bitácora**, una entrada por consulta (también por página). Anotarlo en el registro de accesos lo llenaría con las consultas del propio administrador.
7. **Exportación:** se registra `audit_log.exported` **antes** de enviar datos y se fija como final la última entrada; la exportación incluye su propio registro y no crece durante la descarga. Si no se puede registrar (p. ej. la bitácora tiene una fecha futura, QA B-02), **no se exporta** por la web (falla segura: no hay exportaciones sin rastro); queda `auditor-admin audit export`, que no necesita escribir.
8. **Paginación portable** con `OFFSET 0 … FETCH NEXT n ROWS ONLY` (Kysely `offset(0).fetch(n)`), válida en PostgreSQL `[VERIFICADO localmente]` y SQL Server `[PENDIENTE: CI]`, en vez de `LIMIT`/`TOP` por motor.
9. **Lotes de 500** al exportar y **página máxima de 100** en el registro de accesos `[ESTIMACIÓN: valores razonables, no medidos]`.
10. **`Content-Type: application/x-ndjson`** para la exportación (JSON Lines no tiene un tipo registrado de uso universal `[SUPUESTO]`); la descarga la determina `Content-Disposition`.
11. **`/me` informa vencimientos de la sesión** y advierte en el código que la llamada renueva la inactividad (no usarla para sondear).

## 4. Riesgos y pendientes

| ID | Tema | Estado |
|---|---|---|
| 2C2-P1 | **SQL Server** no se ejecutó localmente | `[PENDIENTE: CI]`. Riesgos concretos a mirar: `OFFSET/FETCH` con parámetros, `ALTER TABLE … ADD … DEFAULT` en la migración 0004, comparación de `char` en el cursor (UUID y fechas en minúsculas/dígitos, sin efecto de la intercalación sin distinción de mayúsculas `[SUPUESTO]`) |
| ~~2C2-P2~~ | ~~Tras restablecer la MFA, quien conociera la contraseña podía configurar su propia MFA antes que la persona~~ | **Resuelto por D-92** (decisión del responsable, 30-10-2026): el reinicio invalida la contraseña y las sesiones y entrega un enlace de activación de un solo uso. Implementado y probado en PostgreSQL (§5); `[PENDIENTE: CI con SQL Server y QA]` |
| 2C2-P3 | `access_log.viewed` agrega una entrada a la bitácora por página consultada | Acotado: requiere sesión de administrador con MFA reciente. `[PENDIENTE: QA evaluar si basta o si conviene registrar una vez por ventana]` |
| 2C2-P4 | La exportación es un `GET` con efecto (registra `audit_log.exported`) | Aceptable: la cookie es `SameSite=Strict` (un sitio ajeno no la dispara con la sesión) y exige MFA reciente. `[PENDIENTE: revisión QA]` |
| 2C2-P5 | El registro de accesos no muestra el correo intentado en fallos con correos inexistentes (solo `null`); la bitácora tiene su HMAC | Por diseño (no guardar correos ajenos en claro). La interfaz debe explicarlo |
| 2C2-P6 | `idleExpiresAt` lo calcula el cliente a partir de la última petición; varias pestañas renuevan la misma sesión | `[PENDIENTE: frontend]` |
| 2C2-P7 | Pantallas, E2E con Playwright, axe-core, ZAP (2C §2.5) | `[PENDIENTE: agente frontend y QA]` |
| 2C1-12 | Certificado propio de la institución en CI | Sigue `[PENDIENTE]` (sin cambios en 2C-2) |

## 5. Reinicio de MFA con enlace de un solo uso (D-92)

Decisión del responsable (D-92, `21-decisiones.md`), que resuelve 2C2-P2. Contrato: `2c2-api.md` §3.1.

### 5.1 Qué se implementó

| Punto | Implementación |
|---|---|
| Reinicio en una transacción | `resetMfa` ahora, dentro de la transacción SERIALIZABLE de `withAdminGuard`: invalida la contraseña, borra el secreto MFA (y el pendiente) y los códigos de recuperación, revoca todas las sesiones, borra los contadores `password` y `mfa` de `login_throttle` (se conservan las marcas de una vez por ventana, como en el desbloqueo), borra los enlaces anteriores e inserta uno nuevo en `activation_token` (hash SHA-256, un solo uso, 24 h). Responde `200 { activationToken, expiresAt }` una vez. Bitácora: `user.mfa.reset` con `passwordInvalidated` y el vencimiento, sin el token |
| Contraseña invalidada | `[DECISIÓN técnica]` `password_hash` pasa a `mfa-reset:<hash anterior>`. Con el prefijo ya no es un hash PHC: `verifyPassword` lo rechaza siempre (falla cerrada aunque algún camino lo olvidara). El inicio de sesión lo trata explícitamente como "sin contraseña": misma respuesta genérica y misma duración mínima, sin contador ni sesión, registrado en el registro de accesos como `auth.login.failed` con `reason: mfa_reset_pending`. Un segundo reinicio antes de activar no encadena prefijos |
| No reutilizar la contraseña anterior | Era sencillo: el hash anterior se conserva detrás del prefijo, así que `activate` lo compara y responde `400 password_reused` **sin consumir el enlace** |
| Activación | `activate` acepta invitados **y** cuentas activas con reinicio pendiente; fija la contraseña nueva, limpia `must_change_password` y lleva a `mfa_enroll` (D-86). Bitácora: `user.activated` con `via: invitation` o `via: mfa_reset` |
| Solo cuentas activas | Reiniciar un invitado o un desactivado responde `409 user_not_active` |
| Último administrador | **Antes** (2B/2C-1), el reinicio solo impedía reiniciarse a sí mismo y **no** usaba la guardia: dos administradores que se reiniciaran mutuamente a la vez podían dejar la organización sin administrador con MFA. **Ahora** usa `withAdminGuard` (misma regla y transacción que desactivar o quitar el rol): `409 last_admin` o `409 conflict`. Recuperación si aun así faltara: `auditor-admin user invite-admin` |
| Lista de usuarios | Campo nuevo `mfaResetPending` |
| CLI | **No existe** un comando de reinicio de MFA en `auditor-admin` `[VERIFICADO]`; no se agregó (fuera del alcance pedido). La consola del operador (2C §3.3, 2C-3) deberá seguir D-92 |

### 5.2 Pruebas y resultados (PostgreSQL 16.15 local, 30-10-2026)

| Ejecución | Resultado |
|---|---|
| Identidad por HTTP + `check-integration-report.mjs` (`SUITE_PREFIX="identidad en"`, `MIN_TESTS_PER_ENGINE=35`) | **35 aprobadas, 0 fallidas, 0 omitidas · postgresql=35** |
| Persistencia + `check-integration-report.mjs` (`MIN_TESTS_PER_ENGINE=26`) | **49 aprobadas, 0 fallidas, 0 omitidas · postgresql=26** |
| `pnpm run verify` (con las variables de PostgreSQL cargadas, por lo que incluyó las integraciones) | **Exit 0.** api 66/66, persistence 49/49, identity 19/19, audit-log 44/44, crypto 15/15, web 4/4; SPDX en 70 archivos; 314 paquetes con licencia permitida |
| SQL Server | `[PENDIENTE: CI]` |

CI: mínimo de identidad por motor **34 → 35**.

| Prueba | Qué demuestra |
|---|---|
| D-92 (nueva) | Tras un bloqueo de MFA y un desbloqueo (`mustChangePassword`), con dos sesiones abiertas: reiniciar un invitado → `user_not_active`; el reinicio responde 200 solo con `activationToken` (43 caracteres) y `expiresAt` (24 h); lista con `mfaResetPending`, sin bloqueos. Ambas sesiones previas → 401. La contraseña antigua desde dos orígenes → **401 genérico, sin `mfa_pending` ni cookie**. Bitácora con un `user.mfa.reset` sin el token. Activación con la contraseña anterior → `password_reused`; débil → `weak_password`; nueva → `mfa_enroll` → `full` (no `password_change`: la marca se limpió) con 10 códigos de recuperación. El enlace es de un solo uso. Entra con la contraseña nueva. Bitácora `user.activated` `via` `[invitation, mfa_reset]`. Un reinicio nuevo invalida el enlace anterior y el enlace **vence** a las 24 h (reloj controlado); la contraseña previa al segundo reinicio tampoco sirve |
| D-92 + D-79 (nueva, en B, antes de la centinela) | Dos administradores (los únicos de B, preparado sintéticamente) se reinician la MFA mutuamente en paralelo: exactamente una petición 200; la otra `last_admin`, `conflict` o `unauthenticated`; queda exactamente 1 administrador activo con MFA; sin errores internos |
| D-89 + D-82 (cambiada) | El final ahora usa el enlace: la contraseña anterior da el 401 genérico y la activación con el enlace lleva a `mfa_enroll` |
| Valores centinela | Incluye todos los tokens de reinicio emitidos (y los secretos TOTP reemplazados); sigue siendo la última prueba |

