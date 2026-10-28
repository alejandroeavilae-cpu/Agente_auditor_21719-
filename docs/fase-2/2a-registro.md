# Fase 2 · Entrega 2A — Base de datos y organizaciones: registro

**Aprobación de inicio de la Fase 2:** Alejandro Ávila, 26-10-2026 23:37 (hora de Chile), en tres entregas con aprobación separada.
**Rama:** `fase-2a`. **Estado:** Implementado y Probado. Revisiones QA independientes:

- **Primera** (27-10-2026, sobre `375e794`): no aprobada, con 2 hallazgos Altos, 7 Medios y 15 Bajos. Correcciones en la §6.
- **Segunda** (28-10-2026, sobre `d969f80`): no aprobada, con 1 hallazgo nuevo Medio y 6 Bajos. Correcciones en la §7.

- **Tercera** (28-10-2026, sobre `930b5cd`): **APROBADA por QA**. N-01 a N-07 corregidos y sin regresiones. Quedan 2 hallazgos Bajos abiertos (X-01, X-02; ver §8).

Pendiente: **aprobación humana de cierre de 2A**.

## 1. Alcance entregado

| Entregable | Ubicación | Estado |
|---|---|---|
| Cifrado de sobre: clave maestra por instalación + DEK por organización, AES-256-GCM con contexto obligatorio (D-12) | `packages/crypto` | Probado |
| Base de control con registro de organizaciones | `packages/persistence` (`schema.ts`, `tenant-manager.ts`) | Probado en PostgreSQL y SQL Server |
| Una base por organización con **usuario propio** y privilegios mínimos (D-04, D-61) | `provisioner.ts` | Probado en ambos motores |
| Bitácora persistida en la base de cada organización, solo-anexar reforzada por el motor, escrituras serializadas (D-62) | `audit-log-repository.ts` | Probado en ambos motores |
| Exportación forense de la bitácora (sin validar ni descartar), verificable con la CLI independiente; también con organizaciones suspendidas | `exportAuditLog`, `auditor-admin audit export` | Probado |
| CLI de administración `auditor-admin` (D-63): `init`, `tenant create/list/suspend/reactivate/check/rotate-password/cleanup-provisioning`, `audit export` | `apps/api/src/admin/cli.ts` | Códigos de salida: prueba automática (`admin-cli.test.ts`). Recorrido completo ejecutado a mano el 28-10-2026 contra PostgreSQL 18.4 local con la cuenta sin superusuario. Prueba de humo de Compose: §6 |
| Compose: servicio `admin` separado (único con secretos de administración), cuenta `auditor_provisioner` sin superusuario creada al iniciar PostgreSQL | `deploy/compose`, `scripts/generate-secrets.sh` | Prueba de humo en CI (§6) |
| Guía de preparación del servidor (PostgreSQL y SQL Server) | `docs/fase-2/servidor-de-base-de-datos.md` | Documentado; SQL de PostgreSQL ejecutado el 28-10-2026 en el servidor local |
| CI: integración con PostgreSQL 18 y SQL Server 2025 reales; omitir = fallar (D-64) | `.github/workflows/ci.yml` (job `integration`) | Probado |

**Sin implementar a propósito en 2A:** endpoints HTTP nuevos, usuarios, autenticación y pantallas (2B/2C); baja definitiva con acta de destrucción (O-09, fase posterior); TLS hacia la base en el perfil institucional (2C/11); respaldos cifrados por organización (D-44, pendiente).

## 2. Evidencia de pruebas

| ID | Prueba | Dónde | Resultado |
|---|---|---|---|
| — | `pnpm run verify` desde estado limpio (SPDX, build, lint, tipos, pruebas, licencias: 312 paquetes permitidos) | Local (Node 24.22.1) y CI | Aprobada |
| — | 12 pruebas de cifrado (contexto incorrecto, alteración, rotación, permisos de archivo, contraseñas) | `packages/crypto/test` | Aprobada |
| PT-12 (base) | Las credenciales de la organización A **no abren** la base de B ni la base de control | `tenants.int.test.ts`, ambos motores | Aprobada |
| PT-04 (BD) | Una modificación hecha con la cuenta administrativa en la base se detecta al exportar y verificar | `tenants.int.test.ts`, ambos motores | Aprobada (cierra la parte pendiente de PT-04 en Fase 1) |
| — | El usuario de aplicación no puede UPDATE ni DELETE en la bitácora | ídem | Aprobada |
| — | 20 escrituras concurrentes → cadena continua y válida | ídem | Aprobada. Según el desarrollo, una primera versión que solo reintentaba fallaba y se corrigió con bloqueo (D-62). [PENDIENTE: no se conservó evidencia de ejecución de esa falla] |
| — | Secreto cifrado copiado de una organización a otra no se descifra | ídem | Aprobada |
| — | Suspensión: la organización no se abre y la acción queda en su bitácora | ídem | Aprobada |
| — | Identificadores con inyección SQL rechazados | ídem | Aprobada |
| — | Integración completa sobre `375e794`: **37 aprobadas, 0 fallidas, 0 omitidas** con PostgreSQL 18 y SQL Server 2025 CU10 | CI run [40441561664](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40441561664), job "Integración" (confirmado por QA) | Aprobada |
| — | Compose: alta de 2 organizaciones, bases separadas, exportación y verificación de cada bitácora | `scripts/smoke-compose.sh`, run 40441561664 | Aprobada |
| PT-17 | La regla D-24 detectó `@azure/msal-node` 6.0.1 (CVE-2026-109461): en el run 40440771108 fallaron el escaneo Trivy (job 121980313742) y la prueba de humo de Compose (imagen de la API); la integración sí pasó. Corregido con override (D-59) | run 40440771108 → run 40441155185 (Seguridad) en verde | Aprobada |

Motores usados en CI (registrados por el propio job): `postgres:18-alpine@sha256:898c60cb…` y `mcr.microsoft.com/mssql/server:2025-CU10-ubuntu-24.04` (digest `sha256:245f6b1c…`, ahora fijado).

## 3. Decisiones

D-58 a D-64 en `docs/fase-0/21-decisiones.md` §5. La más relevante: **Kysely en lugar de Prisma** (D-58).

## 4. Limitaciones y riesgos residuales

1. **La cuenta administrativa del motor puede alterar cualquier base** (incluida la bitácora). Mitigación: detección por exportación + anclajes externos (R-26). No es prevención.
2. **Clave maestra única por instalación** (R-27): quien obtenga el archivo y la base de control puede descifrar las credenciales de todas las organizaciones. Se documenta y se exige respaldo fuera del servidor (R-24).
3. En Compose la verificación de permisos del archivo de clave maestra está desactivada dentro del contenedor, porque el usuario del contenedor difiere del del anfitrión. Los secretos nuevos quedan en 644 y la protección es el directorio del anfitrión, con permisos 700. Fuera de Compose, `loadMasterKey` exige permisos 600 y rechaza enlaces simbólicos.
9. **Rotación de la clave maestra** [PENDIENTE] (B-10): la librería admite varias claves y recifrado por identificador (probado en `packages/crypto`), pero la CLI carga una sola clave y no hay comando de recifrado. No es operable en 2A.
10. **Cuenta de aprovisionamiento en SQL Server:** `securityadmin` equivale en la práctica a `sysadmin` [VERIFICADO, ver la guía del servidor]. En ese motor la separación aporta trazabilidad, no un límite fuerte.
11. **El usuario de una organización puede cambiar su propia contraseña** (R-31, D-68): se detecta con `tenant check` y se corrige con `tenant rotate-password`.
4. En SQL Server, el login de una organización puede conectarse a `master` y `tempdb` (usuario invitado propio del motor). Con `DENY VIEW ANY DATABASE` no ve los nombres de otras bases. No puede entrar a otras bases de usuario.
5. Las pruebas con SQL Server solo se ejecutan en CI (el entorno del agente no puede descargar la imagen); las de PostgreSQL se ejecutaron también localmente. La prueba de humo de Compose solo se ejecuta en CI (el entorno del agente no tiene Docker).
6. La CLI de administración registra como actor `operador-plataforma:cli`, sin identidad individual: la identidad llega en 2B.
7. Override de `@azure/msal-node` a una versión mayor que la declarada por `@azure/identity` (D-59): retirar cuando el proveedor publique compatibilidad.
8. Los digests "flotantes" de algunas imágenes base cambiaron en el registro (p. ej. `postgres:18-alpine`); el proyecto mantiene los fijados y los actualiza deliberadamente.

## 5. Criterios de aceptación (sección 24)

| # | Criterio | Estado |
|---|---|---|
| 1 | Requisitos aprobados implementados | Cumplido (§1) |
| 2 | Compila | Cumplido |
| 3 | Pruebas ejecutadas | Cumplido (§2) |
| 4 | Resultados verificables | Cumplido (runs de CI enlazados; anotaciones con conteos) |
| 5 | Riesgos de seguridad evaluados | Cumplido (§4; regla D-24 aplicada) |
| 6 | Permisos correctos | Cumplido según QA: usuario por organización con privilegios mínimos, cuenta de aprovisionamiento sin superusuario y API sin secretos de administración. En SQL Server, `securityadmin` sigue siendo poderoso (§4.10) |
| 7 | Aislamiento de datos revisado | Cumplido a nivel de base de datos; el aislamiento por endpoint HTTP corresponde a 2C |
| 8 | Comentarios en español | Cumplido |
| 9 | Documentación actualizada | Cumplido (`docs/fase-1/ejecucion-local.md`, este registro) |
| 10 | Revisión QA | **Aprobada** en la tercera revisión (28-10-2026, `930b5cd`), con X-01 y X-02 (Bajos) abiertos; ver §8 |
| 11 | Limitaciones documentadas | Cumplido (§4) |
| 12 | Aprobación humana | **Pendiente** |

## 6. Correcciones tras la primera revisión QA (28-10-2026)

Revisión QA independiente del 27-10-2026 sobre `375e794`: **no aprobada**. Correcciones en los commits `7a84b3a`, `38c6351` y `28c764f`; decisiones D-65 a D-70; riesgos nuevos R-31 y R-32.

| Hallazgo | Corrección | Prueba que lo cubre |
|---|---|---|
| A-01 Reversión inestable | Manejador de errores en los pools de `pg` y `tedious`; la reversión borra base, usuario y registro por separado | `A-01: si falla un paso del alta…` (fallo inyectado en `grantAppPrivileges`) |
| A-02 API con superusuario y clave maestra | Servicio `admin` (perfil `tools`) único con secretos; cuenta `auditor_provisioner` sin superusuario | Integración: `la cuenta de aprovisionamiento no es superusuario` (todas las pruebas usan esa cuenta); humo de Compose paso 9 |
| M-01 La reversión borraba una base ajena | Banderas `dbCreated` / `loginCreated` marcadas después de cada CREATE exitoso | `M-01: la reversión nunca elimina una base que la plataforma no creó` (carrera simulada) |
| M-02 El usuario cambia su contraseña | `tenant check`, `tenant rotate-password` (con `RESET ALL`), `search_path` fijo | `M-02: …se detecta y la rotación recupera el acceso` |
| M-03 Catálogo y bases del sistema visibles | Nombres opacos; `REVOKE CONNECT, TEMP` en `postgres` y `template1`; `DENY VIEW ANY DATABASE`; `REVOKE CONNECT FROM guest` | `PT-12 (base)` ampliada a `postgres` y `template1`; `no ve identificadores de otras organizaciones` (en PostgreSQL sí se ve cuántas hay: R-32) |
| M-04 Suspensión solo en la aplicación | `NOLOGIN` / `DISABLE` y cierre de sesiones | `M-04/M-05`: una conexión abierta antes de suspender queda cortada y no se puede volver a conectar |
| M-05 No se exportaba una organización suspendida | Exportación con la cuenta de aprovisionamiento | `M-04/M-05`; humo de Compose paso 11 |
| M-06 Alta interrumpida bloqueada | Registro `provisioning` previo; aviso en `init`; `tenant cleanup-provisioning` | `M-06: …se limpia con cleanupProvisioning` |
| M-07 La migración se detenía en el primer fallo | Resultado por organización; `init` sale con código 1 si alguna falló | `M-07: …no se detiene ante un fallo` |
| B-01 `seq` impreciso | Se exporta como texto si excede el rango seguro | `B-01/B-02` (seq 9007199254740993 exportado exacto) |
| B-02 Fecha futura contagiada | Error "fecha futura: posible alteración" si la última entrada excede 5 minutos en el futuro | `B-01/B-02` |
| B-03 Fila dañada impedía suspender | La suspensión se aplica igual y se informa aviso | `B-03: con la bitácora dañada la suspensión igual se aplica` |
| B-04 Espera de bloqueo sin límite | `SET LOCAL lock_timeout = '30s'` | Revisión de código [PENDIENTE: sin prueba automática] |
| B-05 Errores de archivo y de opciones | Causa real del error de archivo (código 1); errores de opciones con código 2, antes de leer secretos | `admin-cli.test.ts`; recorrido manual (`/nonexistent/x.jsonl` → código 1) |
| B-06 Caracteres de control en el nombre | `assertTenantName` rechaza `\p{C}` | `naming-config.test.ts` e integración |
| B-07 Funciones de prueba en producción | Movidas a `TestTenantManager` en `test/helpers.ts` | Compila; no se exportan |
| B-08 Nombres reservados para la base de control | `assertControlDatabaseName` | `naming-config.test.ts` |
| B-09 Permisos de secretos | `generate-secrets.sh` no cambia permisos de secretos existentes; `loadMasterKey` exige 600 y rechaza enlaces | `envelope.test.ts` |
| B-10 Rotación de clave maestra | Marcada `[PENDIENTE]` (§4.9) | — |
| B-11 base64url permisivo | Solo forma canónica | `envelope.test.ts` |
| B-12 Objetos grandes | `REVOKE EXECUTE` de `lo_*` en `template1` (guía y Compose); aviso al crear la organización si siguen permitidos | Integración (`lo_creat` rechazado) |
| B-13 Control de pruebas en CI | `scripts/check-integration-report.mjs`: mínimo de 19 pruebas aprobadas **por motor**; puertos de servicios solo en 127.0.0.1 | Ejecutado localmente: con un motor faltante el script falla |
| B-14 Inexactitudes del registro | Corregidas en §1, §2 y §4 | — |
| B-15 Guía incompleta | `docs/fase-1/ejecucion-local.md`: verificación de exportación, suspendidas, variables `TEST_PG_*` / `TEST_MSSQL_*` | — |

**Evidencia local (28-10-2026, Node 24.22.1, PostgreSQL 18.4):**

- `pnpm run verify`: código de salida 0. Pruebas: web 4, crypto 14, audit-log 44, api 15, persistence 23 + 1 omitida (la de integración, sin motores). Licencias: 312 paquetes permitidos.
- Integración con PostgreSQL (`REQUIRE_DB_ENGINES=postgresql`): **42 aprobadas, 0 fallidas, 0 omitidas** (23 unitarias + 19 de integración). [PENDIENTE: no se conservó el informe de esa ejecución; la evidencia actual está en la §7]
  - Al terminar, el servidor solo conserva `postgres`, `template0`, `template1` y el rol `auditor`.

**Evidencia de CI sobre `28c764f`** (todos los jobs en verde):

- CI run [40695749197](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40695749197):
  - Verificación: job 122841927019.
  - Integración: job 122841927551, anotación "**61 aprobadas, 0 fallidas, 0 omitidas · por motor: postgresql=19, sqlserver=19**". Motores fijados por digest. Todas las pruebas de organizaciones se ejecutan con la cuenta de aprovisionamiento sin superusuario.
  - Prueba de humo de Compose (pasos 1–11, incluidos API sin secretos, `auditor_provisioner` sin superusuario, nombres opacos y exportación de una organización suspendida): job 122841927373.
- Seguridad run [40695749289](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40695749289).

**Hallazgos que aparecieron al ejecutar CI durante la corrección (registrados por transparencia):**

- Run 40694426271 (`7a84b3a`):
  - La regla D-24 bloqueó la imagen web por CVE-2026-116587 en `go-jose` v4.1.5, que va dentro de Caddy. Se corrigió fijando la v4.1.6 en el Dockerfile.
  - Falló el job de integración. Como los logs de CI no son accesibles desde el entorno del agente (403), se añadió el reporte de pruebas fallidas como anotaciones.
- Run 40695125716 (`38c6351`): el aviso de endurecimiento detectó una base `auditor` con acceso público, creada por la configuración del servicio PostgreSQL de CI. Se corrigió con `POSTGRES_DB: postgres`. Es el mismo aviso que verá un administrador real.

## 7. Correcciones tras la segunda revisión QA (28-10-2026)

Segunda revisión QA sobre `d969f80`: **no aprobada**.

- **Hallazgos anteriores:** A-02, M-01 y M-03 a M-07 quedaron corregidos. A-01 y M-02 quedaron parciales; sus causas son los hallazgos nuevos N-01 y N-02.
- **B-04:** QA lo ejecutó y confirmó el `lock timeout` a los 30 s. Lo cuento como evidencia de QA, no mía.
- **Hallazgos nuevos:** N-01 (Media) y N-02 a N-07 (Bajas).

Correcciones en `2119a8c` y `fefab6f`. Decisión nueva: D-71.

| Hallazgo | Corrección | Prueba |
|---|---|---|
| N-01 Base huérfana sin registro si fallaba la 2.ª sentencia de un paso | `CREATE` aislado (`restrictDatabase` y `restrictLogin` son pasos aparte); la bandera se marca apenas termina el `CREATE`. Si el `CREATE` falla pero el recurso existe, el alta queda en `provisioning`. `init` lista bases `auditor_t_…` sin registro | `N-01: si falla una restricción posterior al CREATE…`; `N-01: init informa bases…`; `M-01` ajustada (el registro queda en `provisioning`) |
| N-02 `rotate-password` no borraba parámetros `IN DATABASE` | `ALTER ROLE … IN DATABASE … RESET ALL`; `tenant check` lee `pg_db_role_setting` | `M-02` ampliada con `default_transaction_read_only` solo para su base |
| N-03 `suspend` con sesiones vivas salía con 0; reactivar sin registro | Se espera hasta 5 s el cierre de sesiones y se avisa si siguen abiertas; la CLI sale con 1 si hay advertencias; reactivar se rechaza si no puede registrarse (D-71) | `B-03` ampliada (la reactivación se rechaza con la bitácora dañada) |
| N-04 Objetos grandes solo se revisaban al crear | `tenant check` revisa cada organización (las 5 funciones `lo_*`) e indica la base | Revisión de código e integración (`check` vacío en servidor endurecido) |
| N-05 `check-integration-report.mjs` aceptaba valores no numéricos | Validación de contadores y del mínimo (código 2) | Ejecutado: `MIN_TESTS_PER_ENGINE=abc` → código 2; informe con 1 omitida y sin `numTodoTests` → código 1 |
| N-06 Contraseña en los argumentos de `psql` | `\set prov_pw \`cat …\`` dentro del script | Script ejecutado contra PostgreSQL 18.4 local: crea la cuenta y esta inicia sesión |
| N-07 Documentación | Se aclara que se ve **cuántas** organizaciones hay; se advierte que `pg_signal_backend` alcanza a cualquier sesión que no sea de superusuario; la afirmación "4 veces" se marcó `[PENDIENTE]` | — |

**Sobre N-07:** los dos pasos numerados 7 de `ejecucion-local.md` pertenecen a listas distintas (Opción A, administración, y Opción B). No se cambió la numeración.

**Observación de QA, anterior a 2A:** `compose.offline.yaml` usa `postgres:18-alpine` sin digest, porque las imágenes cargadas con `docker load` no conservan el digest del registro. Su integridad depende del `SHA256SUMS` firmado del paquete offline. No se modificó en 2A.

**Incidente durante la corrección:**
- El commit `2119a8c` se subió con una prueba inestable: la suspensión contaba las sesiones antes de que el motor terminara de cerrarlas.
- Localmente fallaron 3 pruebas en cadena. El informe está en `docs/fase-2/evidencia-2a/incidente-2119a8c.json`.
- Su run de CI (40698647444) quedó cancelado por el siguiente push.
- Se corrigió en `fefab6f`, que espera hasta 5 s.

**Evidencia local (28-10-2026, `fefab6f`):**
- `pnpm run verify`: código 0. Pruebas: crypto 14, audit-log 44, api 15, web 4, persistence 23 + 1 omitida.
- Integración con PostgreSQL 18.4: **5 ejecuciones seguidas con 44 aprobadas, 0 fallidas y 0 omitidas** (postgresql=21). Informes JSON en `docs/fase-2/evidencia-2a/` (`vi-1.json` a `vi-5.json`).

**Evidencia de CI sobre `fefab6f`** (todo en verde):
- CI run [40698772829](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40698772829):
  - integración, job 122853286061: "**65 aprobadas, 0 fallidas, 0 omitidas · por motor: postgresql=21, sqlserver=21**";
  - humo de Compose: job 122853285494;
  - verificación: job 122853286080.
- Seguridad: run [40698772823](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40698772823).

## 8. Tercera revisión QA: aprobada, con hallazgos Bajos abiertos

**Revisión:** sobre `930b5cd`, en un clon nuevo, con la CLI real y una cuenta sin superusuario.

**Resultado:**
- **N-01:** QA ejecutó una matriz de 21 casos (cada paso × fallo, fallo después del paso o proceso muerto). En todos el alta quedó revertida o registrada en `provisioning`; no quedó ninguna base sin registro.
- **N-02 a N-07:** corregidos con ejecución real.
- **Regresiones:** ninguna.
- **CI de `930b5cd`:** run 40699796629 en verde, verificado por QA.

**Hallazgos abiertos.** No se corrigieron después de la aprobación para no introducir código sin revisar. Quedan como limitaciones conocidas [PENDIENTE], para corregir al inicio de 2B o antes de fusionar si el responsable lo prefiere:

| ID | Severidad | Descripción | Corrección propuesta |
|---|---|---|---|
| X-01 | Baja | Si `CREATE` falla con "ya existe" (PostgreSQL 42P04/42710), el alta queda en `provisioning` en vez de tratarse como "no creado". Si esa base ajena pertenece a la misma cuenta de aprovisionamiento, seguir el mensaje (`cleanup-provisioning`) la elimina. Exige que coincida un nombre aleatorio de 48 bits, o un atacante que ya tenga las credenciales de aprovisionamiento | Tratar 42P04/42710 (y 1801/15025 en SQL Server) como "no creado"; que `cleanupProvisioning` verifique `organization.id` antes de eliminar |
| X-02 | Baja | Si el usuario de una organización fija parámetros para **otra** base (`IN DATABASE <otra>`), `tenant check` sigue informando el problema y `rotate-password` no lo resuelve. No afecta la operación: ese usuario no puede conectarse a otras bases | `RESET ALL` en cada `setdatabase` del rol |

**Pendiente** (fuera del alcance de QA): no se verificó si la protección de la rama `main` exige el job de integración para fusionar.

## 9. Hallazgo de CodeQL en el PR #3, posterior a la aprobación QA (28-10-2026)

**Hallazgo.** El análisis CodeQL del PR #3 (commit `1396457`) reportó **1 alerta nueva de severidad alta**, `js/file-system-race`, en `packages/crypto/src/envelope.ts:91`.
- **Causa:** `loadMasterKey` comprobaba el archivo por su ruta (`lstat`) y luego lo leía por la ruta. Entre ambas operaciones, el archivo podía cambiar.
- **Origen:** la corrección de B-09.
- **Detección:** no lo detectaron ni QA ni las pruebas.

**Corrección.**
- El archivo se abre una sola vez, con `O_NOFOLLOW` cuando la comprobación está activa.
- Permisos y tipo se comprueban sobre el descriptor abierto (`fstat`), y se lee desde ese mismo descriptor.
- Se rechaza todo lo que no sea un archivo regular. Hay una prueba nueva con un directorio.

**Verificación.**
- Local: `pnpm run verify`, código 0.
- CI y CodeQL sobre el commit de la corrección: [PENDIENTE].
- Verificación QA dirigida: [PENDIENTE].
