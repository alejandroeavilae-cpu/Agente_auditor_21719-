# Fase 2 · Entrega 2B: Identidad y permisos. Registro

- **Aprobación de inicio:** Alejandro Ávila, 29-10-2026 14:07 (hora de Chile), después de aprobar el cierre de 2A (fusión del PR #3, 29-10-2026 13:32).
- **Rama:** `fase-2b`.
- **Estado:** diseño aprobado (D-79, 29-10-2026 14:46). Implementado y probado: local con PostgreSQL; CI con PostgreSQL y SQL Server. **Aprobado por QA en la tercera revisión** (29-10-2026, `421b0fb`). Pendiente: aprobación humana del cierre y aceptación del riesgo residual R-34.
- **Orden de trabajo:**
  1. Corregir los hallazgos abiertos de 2A.
  2. Diseñar identidad y permisos y **presentar el diseño al responsable antes de implementarlo**.
  3. Implementar.
  4. Revisión QA independiente.
  5. Aprobación humana del cierre de 2B.

## 1. Hallazgos abiertos de 2A corregidos

| ID | Corrección | Prueba |
|---|---|---|
| X-01 | Un `CREATE` que falla con "ya existe" se trata como **no creado**, sin dudas sobre su autoría. Códigos: PostgreSQL 42P04/42710; SQL Server 1801/15025. Además, `cleanupProvisioning` comprueba que la base solo contenga tablas de la plataforma y que no declare otra organización antes de eliminarla. | `M-01/X-01` (la base ajena se conserva y el alta se revierte). `X-01: cleanupProvisioning no elimina una base con tablas ajenas`. |
| X-02 | `rotate-password` hace `RESET ALL` en **cada** base para la que el usuario fijó parámetros, no solo en la suya. | `M-02` ampliada con un parámetro fijado para la base de control. |
| Y-02 | `tenant check` distingue un fallo de descifrado: indica que la clave maestra no corresponde o que el registro fue alterado, y que `rotate-password` no lo resuelve. | `Y-02` (un administrador con otra clave maestra) |
| Y-03 | La prueba de FIFO se omite en Windows (`it.skipIf`). | `pnpm run verify` en Linux (crypto: 15 pruebas). [PENDIENTE: CI no se ejecuta en Windows; tampoco se verificaron allí las pruebas de permisos de archivo] |

**Evidencia local (29-10-2026, Node 24.22.1, PostgreSQL 18.4):**

- `pnpm run verify`: código 0. Pruebas: web 4, crypto 15, audit-log 44, api 15, persistence 23 más 1 omitida (la de integración, sin motores).
- Integración: **3 ejecuciones seguidas con 46 aprobadas, 0 fallidas y 0 omitidas** (postgresql=23). Informes en `docs/fase-2/evidencia-2b/hallazgos-2a-1.json` a `-3.json`.
- CI de `c696bf9` (mismo código que `e169e90`): **69 aprobadas, 0 fallidas y 0 omitidas** (postgresql=23, sqlserver=23), verificado por QA. En `e169e90` y `b67f602`, la integración y la prueba de humo quedaron canceladas porque llegó un push más nuevo.
- **QA independiente (29-10-2026): X-01, X-02, Y-02 e Y-03 aprobados**, sin regresiones en 2A. QA abrió tres hallazgos nuevos, todos Bajos: Z-01, Z-02 y Z-03 (§2).

## 2. Hallazgos de la verificación QA del 29-10-2026

| ID | Hallazgo | Corrección | Prueba |
|---|---|---|---|
| Z-01 | `cleanupProvisioning` solo revisaba tablas de `public` por nombre. Podía borrar una base con datos ajenos en otro esquema, en vistas materializadas, secuencias, funciones, tipos u objetos grandes | `Provisioner.foreignObjects` revisa todo el catálogo: en PostgreSQL `pg_class` (todo tipo), esquemas, `pg_proc`, tipos y `pg_largeobject_metadata`; en SQL Server `sys.objects`, tipos de usuario y esquemas. Solo se admiten las tablas de la plataforma en `public`/`dbo` y sus índices o restricciones | `X-01` ampliada. PostgreSQL: tabla `otro.audit_log`, vista materializada, secuencia, función, tipo enumerado y objeto grande. SQL Server: tabla y secuencia ajenas en `dbo`, y `otro.audit_log` |
| Z-02 | El mensaje de Y-02 decía que `rotate-password` no resolvía un registro alterado, pero sí lo resuelve | `tenant check` separa los dos casos. Si no abre la DEK, la clave maestra no corresponde y rotar no sirve. Si la DEK abre pero la contraseña guardada no, rotar sí lo resuelve | `Z-02` (sobre cifrado de otra organización → `check` recomienda rotar → rotar lo resuelve) |
| Z-03 | El diseño de 2B mantenía como `[PROPUESTA]` puntos ya decididos (D-75, D-76, D-78) | Etiquetas corregidas. Se citan D-18 y `09-seguridad.md` §10.3. Se agregaron las cabeceras de seguridad y los errores sin trazas internas (§10.4), que faltaban | — |

**Evidencia local (29-10-2026):**
- `pnpm run verify`: código 0.
- Integración con PostgreSQL: **3 ejecuciones seguidas con 47 aprobadas, 0 fallidas y 0 omitidas** (postgresql=24). Informes en `docs/fase-2/evidencia-2b/z-1.json` a `-3.json`.
- **Incidente:** las primeras ejecuciones fallaron por dos errores de la propia prueba.
  - Un operador SQL ambiguo (`text || "char"`).
  - La cuenta de aprovisionamiento no puede crear objetos grandes (`template1` endurecido).

  Se corrigieron antes de commitear. Las bases y los roles que dejaron esas ejecuciones fallidas se eliminaron a mano.
- **Incidente en CI:** el run de `e3f70ff` falló en SQL Server por un conflicto de intercalación (error 451) en la consulta de `foreignObjects`; esa consulta no se puede probar localmente. Se corrigió forzando `COLLATE DATABASE_DEFAULT` y armando el texto en JavaScript. También se cierran las sesiones antes de borrar el login de pruebas.
- CI de `94cb0d9`: los 7 jobs en verde; integración **71 aprobadas, 0 fallidas, 0 omitidas** (postgresql=24, sqlserver=24), job 123617274392.
- **QA (29-10-2026, sobre `94cb0d9`): Z-01, Z-02 y Z-03 aprobados.** QA probó más de 15 variantes de contenido ajeno y 11 altas interrumpidas que se limpiaron bien. Abrió un hallazgo nuevo, Z-04 (Bajo).

| ID | Hallazgo | Corrección | Prueba |
|---|---|---|---|
| Z-04 | Una tabla `public.audit_log` creada por terceros, con otras columnas y datos, se borraba igual | Si la base no declara pertenecer a la organización (fila `organization` con su id), `audit_log` debe estar vacía; si tiene filas, se rechaza. El caso legítimo (alta cortada antes de escribir la bitácora) deja `audit_log` vacía | `X-01` ampliada. Integración local: **3 ejecuciones, 47/0/0** (`evidencia-2b/z4-*.json`). CI de `3b111db` en verde (71; postgresql=24, sqlserver=24). **QA: corregido, sin regresiones** (11 de 11 altas interrumpidas se limpian) |
| Z-05 | La misma evasión con `kysely_migration` y `kysely_migration_lock` | Cada tabla de la plataforma debe tener **exactamente** sus columnas, revisadas con la introspección, incluidas las tablas internas de Kysely. Además, `kysely_migration` solo puede registrar migraciones conocidas | `X-01` ampliada: columnas ajenas y migración desconocida. Integración local: 3 ejecuciones, 47/0/0 (`evidencia-2b/z5-*.json`). **Incidente:** la primera versión no detectaba nada, porque la introspección de Kysely omite sus propias tablas por defecto; la prueba lo reveló. CI y QA: [PENDIENTE] |

Residual aceptado [DECISIÓN]: los comentarios, los triggers con funciones del catálogo y las publicaciones no se revisan porque no contienen datos (observación de QA).

## 3. Implementación de identidad y permisos (29-10-2026)

| Entregable | Ubicación | Estado |
|---|---|---|
| Contraseñas argon2id (`crypto.argon2` de Node 24), política de 12 a 128 caracteres, rechazo de comunes y del correo | `packages/identity/src/password.ts` | Probado (unitarias) |
| TOTP (RFC 6238) sin dependencias, con ±1 paso y sin reuso | `packages/identity/src/totp.ts` | Probado con los vectores del RFC |
| Tokens (sesión, CSRF, activación) guardados solo como hash; 10 códigos de recuperación | `packages/identity/src/tokens.ts` | Probado |
| Matriz de 6 roles web y 8 permisos; MFA obligatoria en 3 roles; 3 combinaciones prohibidas | `packages/identity/src/rbac.ts` | Probado |
| Tablas de identidad en la base de cada organización (migración `0002_identity`); permisos del usuario de la organización sobre ellas; la bitácora sigue solo SELECT/INSERT | `packages/persistence/src/schema.ts`, `provisioner.ts` | Probado en PostgreSQL y SQL Server (CI) |
| Cifrado y HMAC con la DEK de cada organización (`TenantHandle.crypto`) | `tenant-manager.ts` | Probado |
| Servicio de identidad: inicio de sesión en dos pasos, bloqueo progresivo, sesiones (30 min / 12 h), CSRF, reautenticación (5 min), activación (24 h), gestión de usuarios con "último administrador" | `apps/api/src/identity/identity.service.ts` | Probado por HTTP. **Corrección:** en la primera versión, el bloqueo progresivo y "último administrador" se probaron solo en secuencia y fallaban con peticiones simultáneas (QA 2B-01, 2B-03); ver §4 |
| Guardia global que **deniega por defecto**, límite de tasa, filtro de errores sin trazas, cabeceras CSP/no-store | `guard.ts`, `errors.ts`, `bootstrap.ts` | Probado |
| Endpoints `/api/v1/auth/*` y `/api/v1/users/*` (sin pantallas) | `auth.controller.ts`, `users.controller.ts` | Probado |
| CLI `user invite-admin`; `init` concede lectura a la cuenta de la API | `apps/api/src/admin/cli.ts` | Ejecutado a mano contra PostgreSQL local (ver abajo) |
| Compose: cuenta `auditor_api` (solo lectura del registro), API con clave maestra (D-80), cookie sin `Secure` en perfil local (D-81) | `deploy/compose`, `scripts/generate-secrets.sh`, `scripts/smoke-compose.sh` pasos 9 y 12 | Probado en CI (prueba de humo) |

**Valores verificados contra su fuente durante la implementación** (antes estaban `[PENDIENTE]` en el diseño):
- **argon2id:** m=19456, t=2, p=1 es una de las configuraciones mínimas de OWASP [VERIFICADO: OWASP Password Storage Cheat Sheet, 29-10-2026].
- **`crypto.argon2`:** se agregó en Node v24.7.0 [VERIFICADO: notas de la versión 24.7.0]. Su nivel de estabilidad sigue `[PENDIENTE]`: no figura en las notas de la versión ni en la traducción de nodejs.cn, y la documentación oficial no se pudo consultar (robots).
- **Lista de contraseñas comunes:** `@zxcvbn-ts/language-common` 4.1.3, licencia MIT, 49 233 entradas [VERIFICADO: npm y LICENSE.txt]. Su dependencia `@zxcvbn-ts/dictionary-compression` 3.0.1 también es MIT [VERIFICADO: npm]. La política de licencias del repositorio pasó: 314 paquetes permitidos.
- **Vectores TOTP:** semillas según la errata 2866 del RFC 6238 [VERIFICADO: rfc-editor.org]. Valores esperados [FUENTE SECUNDARIA: otplib], y coinciden con el cálculo propio.

**Decisiones de implementación nuevas:**
- **D-80:** cuenta de la API de solo lectura más la clave maestra en la API. Cambia la postura de A-02 y lo documento como riesgo R-27.
- **D-81:** cookie sin `Secure` en el perfil local sin HTTPS.
- **Valores marcados `[DECISIÓN]` en el código:**
  - bloqueo progresivo desde el 5.º fallo, con espera de 30 s que se duplica hasta 15 min;
  - límites de tasa: 20 intentos sensibles cada 5 min por IP, y 600 peticiones por minuto por IP;
  - TOTP con SHA-1 y 6 dígitos, por compatibilidad con las apps autenticadoras;
  - pantalla previa a la MFA válida 10 min.

**Evidencia local (29-10-2026, Node 24.22.1, PostgreSQL 18.4):**
- `pnpm run verify`: código 0. Pruebas: web 4, crypto 15, audit-log 44, identity 19, persistence 23 más 1 omitida, api 22 más 1 omitida (las omitidas son las de integración, sin motor). Licencias: 314 permitidas.
- Integración de identidad por HTTP (`apps/api/test/identity.int.test.ts`): **16 de 16 aprobadas, en 3 ejecuciones**. Al terminar, el servidor quedó sin restos.
- Integración de 2A con las tablas nuevas: 47 aprobadas, 0 fallidas, 0 omitidas.
- **Recorrido manual con el binario compilado:**
  - script de inicialización de Compose;
  - `init` con `DB_API_READER_USER`;
  - `tenant create` y `user invite-admin`;
  - API arrancada con la cuenta `auditor_api`.

  Resultados: `/auth/me` sin sesión → 401; inicio de sesión inválido → mensaje genérico; activación → `mfa_enroll` con cookie `HttpOnly`; `/users` → `mfa_enrollment_required`; cabeceras CSP y `no-store` presentes.

**Errores encontrados al probar y corregidos antes de publicar:**
- La contraseña de prueba del administrador contenía la parte local del correo ("admin"), y la política la rechazó correctamente.
- Una ejecución con Node 22 falló porque `crypto.argon2` no existe en esa versión. El proyecto exige Node 24 (`engines`).

**Evidencia de CI sobre `685f38d`** (7 de 7 jobs en verde):

| Job | ID | Resultado |
|---|---|---|
| Integración | 123646533420 | 2A: "**71 aprobadas · postgresql=24, sqlserver=24**". Identidad: "**32 aprobadas, 0 fallidas, 0 omitidas · postgresql=16, sqlserver=16**" |
| Prueba de humo de Compose | 123646534138 | Pasos 1–12: la API monta solo `api_db_password` y `master.key`; `auditor_api` sin privilegios; activación HTTP → `mfa_enroll` con cookie `HttpOnly` |
| Seguridad (Gitleaks, Semgrep, Trivy, OSV) | — | En verde |

**Incidentes de CI durante la implementación:**

| Commit | Qué pasó | Corrección |
|---|---|---|
| `0de6ac2` | **Imagen:** el Dockerfile no copiaba `packages/identity/package.json` y el build falló | Agregado al Dockerfile |
| `0de6ac2` | **SQL Server:** `EXEC(N'…' + QUOTENAME(…))` no es válido, porque EXEC no admite expresiones | El texto se arma en una variable antes del EXEC |
| `0de6ac2` | **Gitleaks:** marcó como "generic-api-key" tres contraseñas **sintéticas** literales de la prueba | Ahora se generan al azar en cada ejecución. Los tres hallazgos del commit histórico se registraron en `.gitleaksignore`, con justificación |
| `4b78dd5` | **Prueba de humo:** PostgreSQL 18 concatena los booleanos como `false`/`true`, no como `f`/`t` | Se comparan como enteros |

## 4. Primera revisión QA de 2B (29-10-2026, sobre `340b822`): NO APROBADA

QA atacó la API como lo haría un adversario.

- **Lo que resistió:** aislamiento entre organizaciones, CSRF, fijación y revocación de sesiones, RBAC, reuso de TOTP y de códigos de recuperación, carreras de activación, entradas malformadas, bitácora y permisos de `auditor_api`. Tampoco hubo regresiones de 2A.
- **Hallazgos:** 1 Alto, 1 Medio y 8 Bajos.

| ID | Sev. | Hallazgo | Corrección | Prueba |
|---|---|---|---|---|
| 2B-01 | **Alta** | El bloqueo progresivo se eludía con peticiones en paralelo (incrementos perdidos), y en la MFA bastaba con volver a iniciar sesión cada 4 intentos | Contadores separados de contraseña y MFA (columna `mfa_failed_attempts`), incremento atómico **antes** de verificar, un intento por ventana reclamado de forma condicional; acertar la contraseña no reinicia el contador de MFA (D-82) | `2B-01`: 30 contraseñas en paralelo → contador 30 y bloqueo; ciclos de contraseña + 4 códigos → bloqueo; 20 códigos en paralelo → bloqueo |
| 2B-02 | **Media** | Tras `tenant rotate-password`, la API seguía con la credencial vieja (500) | `openTenant` reabre la conexión si cambió la credencial cifrada | `2B-02` |
| 2B-03 | Baja | Carrera en "último administrador" | Comprobación y cambio en una transacción **SERIALIZABLE**; un conflicto responde 409 | `2B-03`: desactivación y quita de rol simultáneas → queda exactamente 1 administrador |
| 2B-04 | Baja | El tiempo revelaba si existe la organización (≈4 ms) | Duración mínima de 300 ms para fallos de inicio de sesión y de activación (D-82) | Medición de QA (100 muestras por caso): medianas de 302,3 a 302,5 ms, sin diferencia significativa (Mann-Whitney \|z\| ≤ 1,11) |
| 2B-05 | Baja | Con `TRUST_PROXY=true` y acceso directo a la API, `X-Forwarded-For` se falsifica | En Compose la API no publica puertos: solo Caddy la alcanza. Paso 13 nuevo en la prueba de humo, que verifica que la IP falsa no queda registrada | Prueba de humo en CI (`bff8f64`): aprobada |
| 2B-06 | Baja | Un cuerpo de más de 100 KB respondía 500 | El filtro responde 413 `payload_too_large` | `2B-06` |
| 2B-07 | Baja | `/auth/me` en `mfa_pending` mostraba el correo y los roles | Antes de completar la MFA solo se informan la etapa y la organización | `2B-01` (parte `/me`) |
| 2B-08 | Baja | Cada intento fallido agregaba una entrada inborrable a la bitácora | Los fallos van solo al registro de accesos; a la bitácora van los bloqueos (`auth.account.locked`) | Prueba de bitácora ajustada |
| 2B-09 | Baja (docs) | D-80 describía el riesgo de forma incompleta | D-80 reescrita; riesgo nuevo **R-33** (Modalidad A) | — |
| 2B-10 | Baja (docs) | El registro daba el bloqueo por "Probado" sin concurrencia | Corregido en §3 | — |
| Obs. | — | `GET /me` rotaba el token anti-CSRF | El token se deriva de la sesión (HMAC) y es estable (D-82) | Pruebas de CSRF existentes |

**Cambio de esquema:** se agregó la columna `mfa_failed_attempts` a la migración `0002_identity`. Esa migración no se ha publicado (la rama no está fusionada), por lo que se editó en vez de crear otra.

**Evidencia local (29-10-2026):**
- Integración de identidad por HTTP: **3 ejecuciones seguidas con 20 de 20 aprobadas** (postgresql=20). Informes en `evidencia-2b/identidad-qa1-*.json`.

**CI:**
- **`fd5393e`:** falló la prueba `2B-03` en **SQL Server**. Una de las dos peticiones simultáneas respondió `internal` (500) en vez de 409. Causa probable: el error de interbloqueo de SQL Server (1205), o el ROLLBACK posterior (3903), no se reconocía como conflicto. [SUPUESTO: los logs de CI no son accesibles; ver la corrección]
  - **Corrección (`bff8f64`):** se amplió el reconocimiento a 1205, 3960 y 3903, al mensaje "deadlock" y a la causa encadenada.
  - **Diagnóstico agregado:** la prueba ahora captura los errores internos del servidor y falla mostrándolos si aparece alguno.
- **`bff8f64`:** 7 de 7 jobs en verde.
  - Identidad: "**40 aprobadas, 0 fallidas, 0 omitidas · postgresql=20, sqlserver=20**" (job 123663296767).
  - 2A: 71 aprobadas.
  - Prueba de humo (job 123663297319), incluido el paso 13: la IP enviada en `X-Forwarded-For` a través de Caddy no queda registrada.
  - Advertencia: esa carrera no es determinista. Una sola ejecución en verde no demuestra que el caso de SQL Server esté cubierto en todas las intercalaciones posibles [PENDIENTE: verificación QA].

**Tercera revisión QA (29-10-2026, sobre `421b0fb`): APROBADA.**
- 2B-11 corregido. QA confirmó con ejecución real que los intentos durante un bloqueo no cuentan, y probó el desbloqueo por API (RBAC, CSRF, MFA reciente, otra organización → 404) y por CLI (único administrador bloqueado).
- 2B-01 no se reabrió: 120 contraseñas en paralelo → 5 verificaciones reales.
- Sin regresiones en 2B ni en 2A.
- **R-34 está descrito con exactitud:** la espera se duplica en cada ventana hasta 15 min, unas 4 peticiones por hora.
- **Observaciones Bajas, sin bloqueo:**
  1. Contra un atacante persistente, el desbloqueo solo abre una ventana breve. Precisado en D-83.
  2. Una ráfaga en paralelo lleva la espera directo al tope. Precisado en D-83.
  3. Restablecer la MFA también levanta un bloqueo de contraseña. Es inocuo, porque el contador de contraseña se conserva.
- **Sigue `[PENDIENTE]`:** la carrera de "último administrador" en SQL Server, que no es determinista (solo hay evidencia de CI).

## 5. Segunda revisión QA de 2B (29-10-2026, sobre `5243d1f`): NO APROBADA

- **Corregidos y sin regresiones:** 2B-01 a 2B-10, verificados con ejecución real (detalle en el informe de QA). Destacan:
  - 2B-01: 120 contraseñas en paralelo → solo 5 verificaciones reales;
  - 2B-02: 392 respuestas 200 y 0 errores 500 con rotaciones concurrentes;
  - 2B-04: tiempos sin diferencia significativa.
- **Pendiente:** la carrera de 2B-03 en SQL Server sigue `[PENDIENTE]`, porque no es determinista.
- **Hallazgo nuevo:** QA reconoció que ya existía y no lo había reportado en la primera revisión.

| ID | Sev. | Hallazgo | Corrección | Prueba |
|---|---|---|---|---|
| 2B-11 | Media | El bloqueo funcionaba como denegación de servicio permanente: el atacante reclamaba el único intento de cada ventana, los intentos de la propia persona durante el bloqueo lo alargaban, y no había forma de desbloquear | Los intentos durante un bloqueo vigente no cuentan. Desbloqueo por API (administrador, alto riesgo) y por CLI (`user unlock`). Restablecer la MFA levanta el bloqueo de MFA (D-83). **Riesgo residual R-34**, registrado | `2B-11`: 5 intentos bloquean; 3 intentos más durante el bloqueo no cambian nada; el desbloqueo deja la cuenta en 0 y la persona entra; `user.unlocked` queda en la bitácora |

**Evidencia local (29-10-2026):** integración de identidad, **3 ejecuciones seguidas con 21 de 21 aprobadas** (`evidencia-2b/identidad-qa2-*.json`).

**CI de `6970c24`:** 7 de 7 jobs en verde. Identidad: "**42 aprobadas, 0 fallidas, 0 omitidas · postgresql=21, sqlserver=21**" (job 123800772789). 2A: 71 aprobadas. Prueba de humo: en verde (job 123800772372).

QA: [PENDIENTE].

**Riesgo residual que requiere aceptación del responsable:** R-34. Un atacante que conoce la organización y el correo de una persona puede seguir bloqueando su cuenta con unas 4 peticiones por hora. El remedio es el desbloqueo manual. La mitigación de fondo (bloqueo por cuenta e IP, o por dispositivo) se propone para 2C.

## 6. Revisión 1 a 1 de las decisiones de 2B por el responsable (29-10-2026)

[DECISIÓN del responsable] Revisión hecha después de la aprobación de QA y antes del cierre. El código de 2B **no se modificó**; los cambios acordados se implementan al **inicio de 2C**, con verificación QA.

| Decisión | Resultado |
|---|---|
| D-84 (nueva) | Una sola organización por instalación |
| D-75 | Ajustada (confirmada 23:03): inicio de sesión solo con correo y contraseña |
| 2C | Confirmado (23:03): sin suite de aislamiento entre organizaciones; se concentra en pantallas y permisos entre roles |
| D-76 → D-85 (nueva) | Operador con interfaz web propia: servicio separado, acceso solo interno con lista de IP, operadores con nombre, MFA y reautenticación |
| D-77 → D-86 (nueva) | MFA obligatoria para todos los usuarios |
| D-78 | Reconfirmada sin cambios |
| D-79 | Reconfirmada sin cambios (se mantiene la separación de funciones) |
| D-80 → D-87 (nueva) | La API deja de tener la clave maestra; reduce R-33 |
| D-81 | Reconfirmada (opción A); riesgo residual registrado como R-35 |
| D-82 | Reconfirmada sin cambios |
| D-83 | Reconfirmada; **R-34 aceptado** con mitigación de fondo al inicio de 2C |

## 7. Alerta de CodeQL en el PR #4 (29-10-2026)

**Hallazgo.** El check `CodeQL` del PR #4 marca una alerta nueva de severidad alta, "Clear text storage of sensitive information", en `apps/api/src/identity/http.ts:83` (`setSessionCookie`). Aparece desde que se abrió el PR (`13b574b`). El código señalado no cambió desde `0de6ac2`. La alerta no se detectó al abrir el PR y se revisó recién en `046d61c`.

**Evaluación QA independiente** (agente QA, commit `046d61c`, solo lectura de código): **FALSO POSITIVO.**
- La cookie contiene `<slug>.<token>`, con un token de 32 bytes aleatorios (`packages/identity/src/tokens.ts:14`).
- No incluye la contraseña, su hash ni el secreto MFA.
- `changePassword` solo devuelve la sesión nueva.
- En la base de datos se guarda únicamente el SHA-256 del token (`id_hash`).
- La cookie es `HttpOnly` y `SameSite=Strict`. Por defecto lleva `Secure` y el prefijo `__Host-`.
- El transporte sin TLS corresponde al riesgo R-35, ya aceptado (D-81).
- No hay una mitigación de código razonable: cifrar un token opaco no cambia nada.

**Acción.** Se descarta la alerta en GitHub como *False positive*. El descarte lo hace el responsable, porque requiere permisos de administración del repositorio.

**Observaciones de cobertura para 2C** (no bloquean el cierre de 2B):
- agregar el token de sesión a la prueba de valores centinela;
- comprobar en la prueba de integración que la cabecera `Set-Cookie` lleve `HttpOnly`, `SameSite=Strict` y el prefijo `__Host-`.
