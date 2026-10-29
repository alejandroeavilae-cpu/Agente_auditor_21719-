# Fase 2 · Entrega 2B: Identidad y permisos. Registro

- **Aprobación de inicio:** Alejandro Ávila, 29-10-2026 14:07 (hora de Chile), después de aprobar el cierre de 2A (fusión del PR #3, 29-10-2026 13:32).
- **Rama:** `fase-2b`.
- **Estado:** diseño aprobado (D-79, 29-10-2026 14:46). Implementado y probado: local con PostgreSQL; CI con PostgreSQL y SQL Server. Pendiente: QA independiente y aprobación humana del cierre.
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
| Servicio de identidad: inicio de sesión en dos pasos, bloqueo progresivo, sesiones (30 min / 12 h), CSRF, reautenticación (5 min), activación (24 h), gestión de usuarios con "último administrador" | `apps/api/src/identity/identity.service.ts` | Probado por HTTP |
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

QA: [PENDIENTE].
