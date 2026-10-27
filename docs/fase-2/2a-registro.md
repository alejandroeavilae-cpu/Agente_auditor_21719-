# Fase 2 · Entrega 2A — Base de datos y organizaciones: registro

**Aprobación de inicio de la Fase 2:** Alejandro Ávila, 26-10-2026 23:37 (hora de Chile), en tres entregas con aprobación separada.
**Rama:** `fase-2a`. **Estado:** Implementado y Probado. Pendiente: revisión QA independiente y aprobación humana de cierre de 2A.

## 1. Alcance entregado

| Entregable | Ubicación | Estado |
|---|---|---|
| Cifrado de sobre: clave maestra por instalación + DEK por organización, AES-256-GCM con contexto obligatorio (D-12) | `packages/crypto` | Probado |
| Base de control con registro de organizaciones | `packages/persistence` (`schema.ts`, `tenant-manager.ts`) | Probado en PostgreSQL y SQL Server |
| Una base por organización con **usuario propio** y privilegios mínimos (D-04, D-61) | `provisioner.ts` | Probado en ambos motores |
| Bitácora persistida en la base de cada organización, solo-anexar reforzada por el motor, escrituras serializadas (D-62) | `audit-log-repository.ts` | Probado en ambos motores |
| Exportación forense de la bitácora (sin validar ni descartar) verificable con la CLI independiente | `exportRaw`, `auditor-admin audit export` | Probado |
| CLI de administración `auditor-admin` (D-63) | `apps/api/src/admin/cli.ts` | Probado manualmente en PostgreSQL local y en la prueba de humo de Compose |
| Compose con clave maestra y alta de organizaciones | `deploy/compose`, `scripts/generate-secrets.sh` | Probado en CI |
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
| — | 20 escrituras concurrentes → cadena continua y válida | ídem | Aprobada. **Primera versión fallaba** (solo reintentos); corregido con bloqueo (D-62) |
| — | Secreto cifrado copiado de una organización a otra no se descifra | ídem | Aprobada |
| — | Suspensión: la organización no se abre y la acción queda en su bitácora | ídem | Aprobada |
| — | No se pisa una base preexistente con el mismo nombre; identificadores con inyección SQL rechazados | ídem | Aprobada |
| — | Integración completa: **37 aprobadas, 0 fallidas, 0 omitidas** con PostgreSQL 18 y SQL Server 2025 CU10 | CI run [40441155353](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40441155353), job "Integración" | Aprobada |
| — | Compose: alta de 2 organizaciones, bases separadas, exportación y verificación de cada bitácora | `scripts/smoke-compose.sh` pasos 9–10, run 40441155353 | Aprobada |
| PT-17 | La regla D-24 bloqueó la integración por `@azure/msal-node` 6.0.1 (CVE-2026-109461); corregido con override (D-59) | runs con hallazgo → run 40441155185 (Seguridad) en verde | Aprobada |

Motores usados en CI (registrados por el propio job): `postgres:18-alpine@sha256:898c60cb…` y `mcr.microsoft.com/mssql/server:2025-CU10-ubuntu-24.04` (digest `sha256:245f6b1c…`, ahora fijado).

## 3. Decisiones

D-58 a D-64 en `docs/fase-0/21-decisiones.md` §5. La más relevante: **Kysely en lugar de Prisma** (D-58).

## 4. Limitaciones y riesgos residuales

1. **La cuenta administrativa del motor puede alterar cualquier base** (incluida la bitácora). Mitigación: detección por exportación + anclajes externos (R-26). No es prevención.
2. **Clave maestra única por instalación** (R-27): quien obtenga el archivo y la base de control puede descifrar las credenciales de todas las organizaciones. Se documenta y se exige respaldo fuera del servidor (R-24).
3. En Compose la verificación de permisos del archivo de clave maestra está desactivada dentro del contenedor (el usuario del contenedor difiere del anfitrión); la protección es el directorio del anfitrión con permisos 700.
4. En SQL Server, el login de una organización puede conectarse a `master` (comportamiento del motor; ve solo metadatos públicos). No puede entrar a otras bases de usuario.
5. Las pruebas con SQL Server solo se ejecutan en CI (el entorno del agente no puede descargar la imagen); las de PostgreSQL se ejecutaron también localmente.
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
| 6 | Permisos correctos | Cumplido: usuario por organización con privilegios mínimos |
| 7 | Aislamiento de datos revisado | Cumplido a nivel de base de datos; el aislamiento por endpoint HTTP corresponde a 2C |
| 8 | Comentarios en español | Cumplido |
| 9 | Documentación actualizada | Cumplido (`docs/fase-1/ejecucion-local.md`, este registro) |
| 10 | Revisión QA | **Pendiente** |
| 11 | Limitaciones documentadas | Cumplido (§4) |
| 12 | Aprobación humana | **Pendiente** |
