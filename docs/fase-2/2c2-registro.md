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


---

## 6. Parte frontend: pantallas de usuarios (agente frontend)

- **Base:** `2c-diseno.md` §2 (D-88), contrato `2c2-api.md`, D-79, D-86, D-89, D-92, D-93; R-35, R-37, R-38.
- **Estado:** `[DISEÑADO]` `[IMPLEMENTADO]` `[PROBADO en Chromium (Playwright 1.63) contra la API real y PostgreSQL 16.15 local]`. `[PENDIENTE: CI (job E2E y ZAP), revisión manual de accesibilidad de QA con teclado y lector de pantalla (R-37), verificación QA independiente y aprobación del responsable]`. Quien implementó no aprueba su propio trabajo (regla 5). Nada de esto es una "certificación WCAG": es "probado automáticamente con axe-core en Chromium".
- **Alcance respetado:** solo 2C-2. Nada de la consola del operador (2C-3) ni de fases posteriores. Sin cambios en la API ni en la CSP de Caddy.

### 6.1 Qué se hizo

| # | Punto | Implementación | Archivos principales |
|---|---|---|---|
| 1 | Cliente de la API | `fetch` con `credentials: 'same-origin'`, `X-CSRF-Token` en toda petición con efecto, token anti-CSRF **solo en memoria** (variable de módulo; se recupera con `/me` al recargar), respuestas validadas con zod, errores `{ error, message }` mostrados tal cual. Ganchos de sesión: 401 `unauthenticated`/`session_expired` → inicio de sesión con mensaje; 403 de etapa → vuelve a leer `/me`; actividad → renueva el plazo de inactividad en el cliente | `apps/web/src/api/` |
| 2 | Enrutamiento por etapa | Según `GET /me`: sin sesión solo inicio de sesión; `mfa_pending` → `/verificacion`; `mfa_enroll` → `/configurar-mfa`; `password_change` → `/cambiar-contrasena`; `full` → la aplicación. `/activar` se admite en cualquier etapa | `src/App.tsx`, `src/session/SessionProvider.tsx` |
| 3 | Inicio de sesión y MFA | Mensaje único de la API; código de 6 dígitos o de recuperación; `autocomplete` `username`, `current-password`, `new-password`, `one-time-code` (3.3.8: se puede pegar y usar gestores) | `pages/LoginPage.tsx`, `pages/MfaVerifyPage.tsx` |
| 4 | Configurar MFA | QR generado en el navegador con `qrcode` y dibujado como **trazado SVG propio** (sin `innerHTML` ni `data:`), clave base32 en texto para ingreso manual, confirmación con código. Códigos de recuperación **una sola vez**, con descarga `.txt` (Blob local), copiar y casilla obligatoria "Guardé mis códigos"; la sesión no avanza hasta confirmarla | `pages/MfaSetupPage.tsx`, `lib/qr.ts`, `components/QrCode.tsx` |
| 5 | Activar cuenta (invitación y reinicio D-92) | Token leído del fragmento (`#`), validado (43 caracteres base64url), guardado solo en memoria del componente y **borrado de la barra con `history.replaceState`**; también si se pega otro enlace en la misma pestaña (`hashchange`). Contraseña con indicador de fortaleza y luego MFA obligatoria. Muestra `password_reused` (reinicio) e `invalid_token` con qué hacer | `pages/ActivatePage.tsx` |
| 6 | Cambio obligatorio (D-93) | Pantalla de la etapa `password_change` que explica por qué (bloqueo de MFA = alguien conoce la contraseña) y exige una contraseña distinta | `pages/PasswordChangeRequiredPage.tsx`, `pages/ChangePasswordForm.tsx` |
| 7 | Mi cuenta e inicio | Datos propios, cambio de contraseña (avisa que cierra las demás sesiones), cerrar sesión. Inicio con el rol y el aviso de que las funciones de auditoría llegan en fases posteriores | `pages/AccountPage.tsx`, `pages/HomePage.tsx` |
| 8 | Usuarios (administrador) | Tabla con estado en texto (Activo, Invitado, Desactivado, Sin MFA, Reinicio de MFA pendiente, Bloqueado en N orígenes, MFA bloqueada hasta…, Debe cambiar su contraseña). **Aviso destacado de R-38** (región con título, borde y texto "Atención:", no solo color) cuando `passwordCompromiseSuspected`: explica que alguien conoce la contraseña, pide contactar a la persona por otro medio y **recomienda reiniciar la MFA con enlace** en vez de solo desbloquear, con botón directo. El diálogo de desbloqueo repite la recomendación y permite cambiar a reinicio | `pages/users/*`, `lib/user-status.ts` |
| 9 | Invitar y reiniciar MFA | Enlace `window.location.origin + /activar#<token>` mostrado **una sola vez**, con botón copiar (portapapeles; si falla, lo selecciona), vencimiento y aviso de entregarlo por canal seguro; el diálogo no se cierra con Escape mientras muestra el enlace | `components/OneTimeLink.tsx`, `pages/users/InviteDialog.tsx`, `pages/users/UserActionDialog.tsx` |
| 10 | Roles (D-79) | Casillas con la explicación de la separación de funciones; advertencia local si la combinación está prohibida, pero se puede enviar y **se muestra el mensaje de la API** (`invalid_roles`), que es el que manda | `pages/users/RoleCheckboxes.tsx`, `RolesDialog.tsx`, `lib/roles.ts` |
| 11 | Reautenticación | `withReauth`: si la API responde `403 reauth_required`, diálogo de código → `POST /auth/reauth` → repite la acción una vez; cancelar no ejecuta la acción | `session/ReauthProvider.tsx` |
| 12 | Registro de accesos | Tabla paginada por cursor opaco (anterior/siguiente), filtros por grupo o evento, persona y fechas (hora local → ISO UTC con `Z`). Filas de `account.attack_suspected` y `auth.account.locked` resaltadas con la etiqueta "Alerta". Si falta MFA reciente, aviso con botón "Confirmar código". Explica "Sin persona asociada" (2C2-P5). Los datos (con IP en claro) no se conservan en memoria al salir (`gcTime: 0`) ni se vuelven a pedir solos (cada consulta queda en la bitácora) | `pages/AccessLogPage.tsx`, `lib/access-events.ts` |
| 13 | Exportar bitácora | `fetch` + Blob (para poder reaccionar a `reauth_required`), nombre desde `Content-Disposition` (solo caracteres seguros), muestra el `X-Audit-Chain-Id` y el comando `auditor-log verify --entries <archivo> --chain-id <id>` | `pages/AuditExportPage.tsx` |
| 14 | Expiración de la sesión | Aviso 2 min antes, contado en el cliente a partir de `/me` (no sondea); "Continuar" llama `/me`; al vencer cierra la sesión en la API y vuelve al inicio de sesión con mensaje. Plazos medidos contra la cabecera `Date` del servidor (no depende del reloj del equipo). Las pestañas comparten plazos y cierre con `BroadcastChannel` (resuelve 2C2-P6; no es almacenamiento) | `session/session-clock.ts`, `session/IdleWatcher.tsx` |
| 15 | Accesibilidad | React Aria Components (campos, casillas, diálogos, botones, medidor); enlace "Saltar al contenido"; foco al título al navegar; foco visible propio (3 px); objetivos ≥ 32 px (principales 44 px); errores con `aria-invalid`, `aria-describedby` y `role="alert"`; prefijos de texto ("Error:", "Atención:") además del color; tablas con `caption` y `th`; contenedores de tabla desplazables enfocables; `lang="es-CL"` e `I18nProvider es-CL` | `src/styles/app.css` y componentes |
| 16 | CSS y CSP | CSS propio en archivo, fuentes del sistema, sin CDN. Sin `dangerouslySetInnerHTML` `[VERIFICADO: búsqueda en apps/web/src]` | `src/styles/app.css` |
| 17 | SPDX | `check-spdx` cubre ahora `.css` y `.html` además de `.ts/.tsx/.js/.mjs/.cjs` | `scripts/check-spdx.mjs` |

### 6.2 CSP sin cambios: hallazgos y cómo se resolvieron

La CSP de Caddy (`style-src 'self'`, `script-src 'self'`, sin `unsafe-inline` ni `unsafe-eval`) **no se modificó**. Las pruebas E2E sirven la SPA con exactamente esa CSP (leída del `Caddyfile`) y fallan ante cualquier evento `securitypolicyviolation`. Hallazgos con evidencia:

| Hallazgo | Evidencia | Resolución |
|---|---|---|
| React Aria (`usePress`) inyecta en tiempo de ejecución `<style id="react-aria-pressable-style">` | `react-aria@3.53.1/dist/private/interactions/usePress.mjs`, líneas 582–598: solo lo inyecta si `getElementById('react-aria-pressable-style')` no existe | `index.html` declara un `<template id="react-aria-pressable-style">` inerte y la regla equivalente (`touch-action`) está en `app.css`. La prueba `csp.spec.ts` verifica el marcador y que el único `<style>` del documento es el que la propia prueba inyecta a propósito (para comprobar que la guarda detecta infracciones): la SPA no agregó ninguno |
| React Aria (`usePreventScroll`) inyecta `<style>` al abrir un modal **solo en Safari de iOS** | Misma librería, `overlays/usePreventScroll.mjs`, rama `preventScrollMobileWebKit` (se elige con `isIOS() && isWebKit()`) | **Residual `[PENDIENTE]`**: en iOS la CSP lo bloquea y el navegador informa una infracción; el efecto es solo cosmético (`overscroll-behavior` dentro del modal). No probado en iOS (no hay dispositivo en este entorno). No se relajó la CSP |
| zod 4 prueba `new Function("")` para compilar validadores (JIT): la CSP lo bloquea y lo informa aunque zod capture el error | Infracción `script-src eval` capturada por las pruebas en el bundle; `zod/v4/core/util.js` (`allowsEval`) | `z.config({ jitless: true })` al cargar el cliente HTTP (`src/api/http.ts`): validación interpretada, misma semántica, sin la prueba de `new Function` |
| axe-core usa `new Function` para sus mensajes dentro de la página | `axe-core@4.14.0/axe.js` | Es de la herramienta de pruebas, no de la SPA: la guarda tolera **solo** infracciones `eval` mientras axe analiza (marcado en la página) |
| Vite y React | `dist/index.html` sin scripts ni estilos en línea `[VERIFICADO]`; React aplica `style` por CSSOM (no lo bloquea `style-src`) | Sin cambios |

### 6.3 Licencias verificadas (30-10-2026)

Verificadas contra el campo `license` del `package.json` instalado **y** el archivo de licencia incluido en el paquete; `scripts/check-licenses.mjs`: **361 paquetes, todos permitidos** (antes 314).

| Paquete | Versión exacta | Licencia | Uso |
|---|---|---|---|
| react-aria-components (+ react-aria 3.53.1, react-stately 3.51.0, @internationalized/date 3.12.4, number 3.6.9, string 3.2.10, @react-types/shared 3.37.0, @swc/helpers 0.5.23) | 1.22.1 | Apache-2.0 | Producción |
| @tanstack/react-query (+ query-core) | 5.105.0 | MIT | Producción |
| react-router (+ cookie-es 3.1.1, @remix-run/route-pattern 0.22.1) | 8.5.1 | MIT | Producción |
| qrcode (+ dijkstrajs 1.0.3; pngjs y yargs solo para su CLI en Node, no entran al bundle del navegador) | 1.5.4 | MIT | Producción |
| zod (ya estaba en el monorepo) | 4.6.7 | MIT | Producción |
| @playwright/test, playwright, playwright-core | 1.63.0 | Apache-2.0 | Solo pruebas |
| @axe-core/playwright, axe-core | 4.14.0 | MPL-2.0 (permitida por la política; solo pruebas, no se distribuye) | Solo pruebas |
| @types/qrcode | 1.5.6 | MIT | Solo desarrollo |

Transitivas nuevas (todas MIT o ISC): aria-hidden, clsx, client-only, use-sync-external-store y las de la CLI de `qrcode` (yargs 15 y sus dependencias). Lista completa: `THIRD_PARTY_LICENSES.md`. `@playwright/test` se fijó en **1.63.0**, la misma versión que el Chromium preinstalado del entorno, para no descargar navegadores aquí; en CI el job instala el Chromium de esa versión.

### 6.4 Pruebas y resultados reales (30-10-2026, entorno local)

Entorno: Node 24.22.1, PostgreSQL 16.15 local, Chromium de Playwright 1.63.0 (sin Docker).

| Ejecución | Resultado |
|---|---|
| `pnpm run verify` (con las variables de PostgreSQL cargadas) | **Exit 0.** SPDX en **129** archivos (incluye `.css`/`.html`); web **38/38** (antes 4); crypto 15/15; audit-log 44/44; identity 19/19; persistence 49/49; api 66/66; licencias **361** permitidas |
| E2E completo (`CI=1 playwright test`) + `check-e2e-report.mjs … 15` | **15 aprobadas, 0 fallidas, 0 omitidas, 0 inestables** (10,1 min). `check-e2e-report.mjs`: exit 0. Sin infracciones de axe-core ni de la CSP. Ejecuciones anteriores de la misma tarde encontraron y corrigieron: el `eval` de zod (§6.2), dos problemas de aislamiento entre pruebas (el panel R-38 lista a todas las cuentas sospechosas de la organización; la primera espera de bloqueo de MFA puede vencer mientras se espera un código TOTP nuevo) y selectores |
| Typecheck de las pruebas E2E (`tsc -p e2e/tsconfig.json`) y ESLint de todo el repositorio | Sin errores |

Pruebas E2E (cada una con axe-core en sus pantallas: etiquetas `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` y `best-practice`, falla ante cualquier infracción; y guarda de CSP):

| Archivo | Qué demuestra |
|---|---|
| `activation.spec.ts` (2) | Enlace inválido con mensaje; token en el fragmento, borrado de la URL y **nunca enviado al servidor** (se revisan todas las peticiones); validación en español; QR e ingreso manual; código errado; 10 códigos de recuperación, descarga `.txt` con todos, "Continuar" deshabilitado hasta confirmar; inicio del Lector sin opciones de administración; `localStorage` y `sessionStorage` vacíos; mensaje único ante credenciales malas; inicio de sesión con TOTP y con código de recuperación; foco al título; recarga recupera el CSRF desde `/me`; página no encontrada |
| `users-admin.spec.ts` (2) | Invitación con errores en español, enlace único con copiar (se lee el portapapeles), Escape no lo cierra; "Invitado"; combinación prohibida → **mensaje exacto de la API**; roles válidos; desactivar con MFA vieja → diálogo de código (código errado y luego correcto) → acción repetida → "Desactivado". Cancelar la reautenticación no desactiva |
| `roles-ui.spec.ts` (2) | El Auditor no ve Usuarios/Registro/Bitácora; las rutas muestran "Sin permiso"; **la API responde 403** a `/users`, `/access-log` y `/audit-log/export` desde su sesión. El administrador ve las 5 opciones y `aria-current` |
| `lock-unlock.spec.ts` (1) | 5 códigos errados en la interfaz → panel R-38 con el correo y "MFA bloqueada hasta…"; diálogo de desbloqueo con la recomendación; tras desbloquear, "Debe cambiar su contraseña" y el panel desaparece; la persona entra → solo la pantalla de cambio (incluso al ir a `/mi-cuenta`); misma contraseña → `password_reused`; nueva → inicio; la anterior ya no sirve |
| `mfa-reset.spec.ts` (1) | Reinicio con enlace único; "Reinicio de MFA pendiente"; la sesión abierta de la persona se cierra (siguiente acción → inicio de sesión); contraseña anterior → mensaje genérico; activación con la anterior → `password_reused`; nueva → MFA con secreto distinto → inicio; el enlace no sirve dos veces |
| `session-expiry.spec.ts` (2) | Con el reloj del navegador adelantado 28:30 aparece el aviso (axe); "Continuar" llama `/me` y lo cierra; a los 31 min más la SPA cierra la sesión **en la API** (`/me` → 401, 0 sesiones en la base) con mensaje de inactividad. Con `last_seen_at` envejecido 31 min en la base, la siguiente acción lleva al inicio de sesión con "Su sesión expiró" |
| `access-log.spec.ts` (1) | Bloqueo provocado → fila con "Alerta", correo e IP; filtros por grupo y persona; rango inválido; más de 50 eventos → página 2 y vuelta; "Sin persona asociada"; MFA vieja → "Confirme su código" → tabla |
| `audit-export.spec.ts` (1) | Exportación con reautenticación; nombre `bitacora-muni-e2e-AAAAMMDDTHHMMSSZ.jsonl`; la pantalla muestra el chain id y el comando; última línea `audit_log.exported`; sin IP en claro; **`auditor-log verify` real → código 0 y "RESULTADO: bitácora íntegra."**; una línea alterada → código 1 |
| `csp.spec.ts` (1) | La cabecera CSP servida es idéntica a la del `Caddyfile`; un `<style>` inyectado a propósito **sí** es detectado por la guarda (control de la propia prueba); el marcador de React Aria está presente |
| `keyboard-responsive.spec.ts` (2) | Inicio de sesión completo solo con teclado (enlace de salto, Tab, Enter, foco en el código), foco visible propio, foco atrapado en el diálogo y devuelto al botón al cerrar con Escape. A **320 px** ninguna pantalla (inicio de sesión, inicio, usuarios, registro, bitácora, mi cuenta, diálogo de invitación) tiene desplazamiento horizontal |

Unitarias nuevas (`apps/web/test`, 38): la copia de roles y combinaciones prohibidas es **idéntica** a `packages/identity` y coincide par a par con `validateRoleSet`; estados de usuario; reloj de la sesión (desfase de reloj, aviso, renovación sin pasar del vencimiento absoluto); indicador de fortaleza; formato de fechas y enlaces; consulta del registro sin parámetros vacíos; nombre de archivo seguro; QR; esquemas zod; **contraste AA** de los colores del tema (fórmula WCAG 2.x sobre las variables de `app.css`, 14 pares, incluidos bordes y foco ≥ 3:1).

### 6.5 CI

| Job | Qué hace | Estado |
|---|---|---|
| `e2e` (nuevo) | PostgreSQL 18 de servicio (misma imagen fijada por digest que `integration`), `pnpm run build`, Chromium de Playwright 1.63.0, `playwright test` y `check-e2e-report.mjs` (mínimo **15**, ninguna omitida, fallida ni inestable). Si falla, publica la cola del registro de la API como anotaciones | Primera ejecución en CI (`d4e7291`): 14/15; falló la prueba de bloqueo por el aislamiento indicado arriba (corregido). `[PENDIENTE: resultado sobre el SHA final, ver el informe de entrega]` |
| `compose-smoke` (+ ZAP) | Tras `smoke-compose.sh`, `scripts/zap-baseline.sh` corre ZAP baseline (araña clásica y AJAX, 2 min) contra Caddy en `127.0.0.1:8080`; `scripts/zap-report.mjs` publica todas las alertas como anotaciones y **falla solo ante riesgo alto** no ignorado. `deploy/zap/baseline.conf`: **ninguna regla ignorada** | Primera ejecución en CI (`d4e7291`): **verde**, 0 alertas altas; 2 bajas (CORP y COEP ausentes) y 4 informativas (2C2-F3) |

### 6.6 Decisiones técnicas para registrar `[PROPUESTA para D-xx, sujetas a QA]`

1. **E2E contra la API real compilada + servidor de prueba con las cabeceras del Caddyfile**, en un job propio con PostgreSQL de servicio, en vez de contra el Compose. Razones: se ejecuta igual en local y en CI sin Docker (aquí no hay Docker), no depende de construir imágenes, permite simular el paso del tiempo en la base y deja trazas de Playwright. La CSP se lee del `Caddyfile` en cada ejecución (no hay copia que se desincronice). El proxy real (Caddy) se cubre con **ZAP contra el Compose** en `compose-smoke` y con la prueba de humo existente. Límite: el E2E no ejecuta Caddy mismo ni SQL Server (la API y su paridad de motores ya se prueban en `integration`).
2. **Plazos de la sesión medidos contra la cabecera `Date`** de la respuesta de `/me` (no contra el reloj del equipo) con 5 s de margen; aviso **2 min** antes `[ESTIMACIÓN: valor razonable, no medido con usuarios]`; al vencer, la SPA **llama a `logout`** (cierra también en el servidor). Pestañas sincronizadas con `BroadcastChannel` (2C2-P6).
3. **Reautenticación reactiva**: se pide el código al recibir `reauth_required` y se repite la acción una vez; no se usa `reauthValidUntil` para pedirlo antes (evita pedir el código de más; la API decide).
4. **Tabla de roles duplicada en la web** (el paquete de identidad usa `node:crypto` y no se empaqueta para el navegador), con prueba de paridad que falla si divergen.
5. **Exportación con `fetch` + Blob** para manejar `reauth_required` en JSON; el archivo pasa por la memoria del navegador `[SUPUESTO: aceptable para el volumen de una organización; no medido con bitácoras grandes]`.
6. **`zod` en modo `jitless`** y **marcador `<template>` para React Aria**, en vez de relajar la CSP (§6.2).
7. **Indicador de fortaleza orientativo** sin `zxcvbn` en el cliente (sin dependencia nueva ni lista de contraseñas en el bundle); la política real es la de la API.
8. **Filtros con `<select>` y `<input type="date">` nativos** (accesibles en móviles) y React Aria para campos de texto, casillas, diálogos, botones y medidor.
9. En el entorno E2E la API corre con `SENSITIVE_RATE_LIMIT=100000` (todas las peticiones salen de 127.0.0.1); los bloqueos por cuenta y por origen (D-88, D-89) no dependen de ese límite y se prueban igual.
10. ZAP con la imagen oficial `ghcr.io/zaproxy/zaproxy`, **fijada por digest** `sha256:030d3df57735dacbb83464854758e674dd9ad01d79d12a129a8e58b1fd384238` (el de `:stable` que registró el CI en la primera ejecución sobre `d4e7291`; desde este entorno ghcr.io no es accesible). El script sigue publicando el digest usado como anotación.
11. El estado de la ejecución E2E (incluido el secreto TOTP **sintético** del administrador de prueba) pasa a los procesos de prueba por variable de entorno, no por archivo (hallazgo de CodeQL "Network data written to file"); los valores sintéticos se generan con `node:crypto` (hallazgo "Insecure randomness").

### 6.7 Pendientes y riesgos

| ID | Tema | Estado |
|---|---|---|
| 2C2-F1 | Revisión **manual** de accesibilidad con teclado y lector de pantalla (NVDA u Orca) sobre los flujos principales (2C §2.3, R-37) | `[PENDIENTE: QA]`. Lo automático (axe-core, teclado y 320 px en Chromium) no la reemplaza |
| 2C2-F2 | Solo se probó en **Chromium** de escritorio. Firefox, Safari y móviles sin probar; en Safari de iOS queda la infracción de CSP cosmética de React Aria (§6.2) | `[PENDIENTE]` |
| 2C2-F3 | ZAP baseline informó 2 alertas **bajas** (falta `Cross-Origin-Resource-Policy` y `Cross-Origin-Embedder-Policy` en las respuestas de Caddy) y 4 informativas; ninguna alta | `[PENDIENTE: decisión DevOps/QA]`: agregarlas cambia el `Caddyfile` (fuera del alcance de 2C-2, que no debía cambiar la CSP ni las cabeceras) |
| 2C2-F6 | La prueba de la migración 0004 en SQL Server (`packages/persistence/test/tenants.int.test.ts`) fallaba en CI desde los commits de la API (`EXEC()` con `QUOTENAME` en su argumento). El agente frontend la corrigió (solo la preparación de la prueba) para dejar el CI en verde | `[PENDIENTE: revisión backend/QA]` |
| 2C2-F4 | Bundle de 565 kB sin dividir (Vite lo advierte) | `[PENDIENTE: evaluar división por rutas; no afecta a la función]` |
| 2C2-F5 | Exportaciones muy grandes pasan por la memoria del navegador (decisión 5) | `[PENDIENTE: medir]` |
| ~~2C2-P6~~ | Varias pestañas | Resuelto en el frontend (decisión 2) `[PENDIENTE: QA]` |
| 2C2-P7 | Pantallas, E2E, axe-core, ZAP | Implementado y probado localmente; ZAP solo en CI `[PENDIENTE: CI y QA]` |
