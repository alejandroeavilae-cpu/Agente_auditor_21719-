# Fase 1 — Infraestructura base: registro de fase

**Aprobación de inicio:** Alejandro Ávila, 25-10-2026 03:33 (hora de Chile) (P-10).
**Rama:** `fase-1`. **Estado:** Implementado y Probado. Pendiente: revisión QA independiente y aprobación humana de cierre.

## 1. Alcance entregado

| Entregable (plan de Fase 1) | Ubicación | Estado |
|---|---|---|
| Monorepo pnpm, TypeScript estricto, ESLint `strictTypeChecked`, Vitest | raíz, `apps/`, `packages/` | Probado |
| Bitácora encadenada con anclaje externo y CLI de verificación independiente (adelantada, D-32) | `packages/audit-log` | Probado |
| API mínima: salud y `/api/v1/about` con enlace al código fuente exacto (AGPL §13) | `apps/api` | Probado |
| Web mínima con validación de la respuesta de la API | `apps/web` | Probado |
| Docker Compose perfil local y perfil offline | `deploy/compose/` | Probado en CI |
| Imágenes: API sin gestores de paquetes en runtime; web con Caddy compilado desde fuente | `deploy/docker/` | Probado en CI |
| CI: verificación, prueba de humo de Compose, escaneo de imágenes | `.github/workflows/ci.yml` | Probado |
| Seguridad: Gitleaks, Semgrep CE, Trivy (regla D-24), OSV-Scanner | `.github/workflows/security.yml` | Probado |
| Publicación: GHCR, SBOM CycloneDX, firmas Cosign, paquete offline, verificación sin red | `.github/workflows/release.yml` | Probado con clave efímera |
| Política de licencias e inventario de terceros | `scripts/check-licenses.mjs`, `THIRD_PARTY_LICENSES.md` | Probado |
| Gobernanza: guía de revisión, políticas de versiones y soporte | `docs/gobernanza/` | Diseñado |
| Guías: ejecución local, verificación de integridad, clave de firma | `docs/fase-1/` | Diseñado |

Estructura reservada sin implementar (solo README): `apps/agent`, `packages/shared`, `packages/connector-sdk`, `packages/classifier`, `packages/catalog-schema`, `catalog/`.

## 2. Evidencia de pruebas

Todas las ejecuciones son reales; los enlaces llevan a GitHub Actions (repositorio privado: requieren acceso). Evidencia vigente: commit `e84f473` (CI [40174189402](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40174189402), Seguridad [40174189383](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40174189383)) y publicación de prueba `v0.1.0-rc.2` ([40174458705](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40174458705)).

| ID | Prueba | Dónde | Resultado |
|---|---|---|---|
| — | `pnpm run verify` (SPDX, lint, tipos, **54 pruebas**, build, política de licencias) | Local (Node 24.22.1) y CI | Aprobada |
| PT-04 | Alteración, eliminación, reordenamiento y duplicación de entradas detectadas | `packages/audit-log/test/*.test.ts`, `scripts/smoke-audit-log.sh` | **Aprobada parcialmente**: sobre el formato de exportación JSONL. La prueba sobre la base de datos queda para la fase que persista la bitácora |
| PT-21 | Reescritura completa detectada solo con anclaje externo; la limitación sin anclaje se prueba explícitamente | `anchor.test.ts`, `cli.test.ts`, smoke en CI | **Aprobada parcialmente** (mismo alcance que PT-04) |
| — | Regresiones de la QA: `__proto__` oculto, claves duplicadas, números y escapes no canónicos, cadena de otro tenant, timestamps no UTC o decrecientes, firma maleable, bitácora/anclajes vacíos, recorrido de rutas y enlaces simbólicos en la CLI | `packages/audit-log/test/qa-regression.test.ts` (19 casos en la re-revisión, 23 tras las correcciones finales) | Aprobada |
| — | API: salud, about con commit, cabeceras, 404, configuración que falla cerrada (URL https, SemVer), escucha local por defecto | `apps/api/test/app.test.ts` | Aprobada |
| — | Web: rechazo de enlaces no https y formas inesperadas | `apps/web/test/about.test.ts` | Aprobada |
| — | Compose: salud vía proxy, commit, CSP, sin cabecera Server, **web publicado solo en 127.0.0.1:8080** (comprobado con `docker compose port`), api/postgres/valkey sin puertos publicados, red interna sin salida a Internet, api/web/valkey no root, proceso principal de PostgreSQL no root, Valkey exige contraseña | `scripts/smoke-compose.sh` en CI 40174189402 | Aprobada |
| PT-17 | La regla D-24 **bloquea la publicación**: el workflow de release construye, escanea con Trivy y solo publica si no hay hallazgos altos/críticos con corrección. Además, prueba sintética que demuestra que el bloqueo falla ante un hallazgo | Release 40174458705 (paso "PT-17"); `scripts/test-d24.sh` en CI. Bloqueos reales observados en CI: runs [40170599529](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40170599529) y [40170599544](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40170599544) (multer, undici, brace-expansion, runtime Go, x/net, brotli), corregidos en las causas | Aprobada |
| — | Gitleaks (historial completo), Semgrep CE, Trivy fs, OSV-Scanner sin hallazgos bloqueantes | Seguridad 40174189383 | Aprobada |
| PT-02 | Firma de `SHA256SUMS` verificada **sin red** (`unshare --net`) y archivo alterado rechazado; firmas de imágenes verificadas | Release 40174458705 | Aprobada **con clave efímera** (mecanismo, no confianza de origen) |
| PT-01 (parcial) | Paquete offline extraído, IDs de imágenes comparados con `IMAGE_IDS`, servicios levantados con `pull_policy: never` y commit verificado | Release 40174458705 | Aprobada parcialmente: falta la prueba en una máquina sin red física (Fase 11) |

Pre-versiones de prueba publicadas: `v0.1.0-rc.1` y `v0.1.0-rc.2` (prerelease, clave efímera, advertencia en sus notas).

## 3. Criterios de aceptación (sección 24)

| # | Criterio | Estado |
|---|---|---|
| 1 | Requisitos aprobados implementados | Cumplido (tabla §1) |
| 2 | El código compila | Cumplido (local y CI) |
| 3 | Pruebas ejecutadas | Cumplido (§2) |
| 4 | Resultados verificables | Cumplido: ejecuciones de CI enlazadas con su commit |
| 5 | Riesgos de seguridad evaluados | Cumplido: escaneos, regla D-24 en publicación y correcciones de la QA |
| 6 | Permisos correctos | Cumplido con matiz: api, web y valkey sin root y con `cap_drop: ALL`; PostgreSQL con `cap_drop: ALL` y 5 capacidades mínimas porque su entrypoint arranca como root antes de cambiar al usuario `postgres`; workflows con permisos mínimos |
| 7 | Aislamiento de datos revisado | Parcial: sin tenants hasta Fase 2; `chainId` obligatorio en la verificación de bitácoras; red interna verificada |
| 8 | Comentarios explicativos en español | Cumplido |
| 9 | Documentación actualizada | Cumplido |
| 10 | Revisión QA | Primera revisión **no aprobada** (27 hallazgos); correcciones en `29e28b4` y `e84f473`. **Re-revisión sobre `c925ef0`: sin bloqueos**, cumple 1–11; sus 7 observaciones (N-01 a N-07) se corrigieron después |
| 11 | Limitaciones documentadas | Cumplido (§5) |
| 12 | Aprobación humana | **Pendiente** (fusión del pull request) |

## 4. Decisiones de la fase

D-47 a D-57 en `docs/fase-0/21-decisiones.md` §4 (TypeScript 6.0, clave de firma custodiada por el responsable, versiones de Node/pnpm/PostgreSQL/Valkey, Express, acciones por SHA, anotaciones de escaneo, política de licencias). P-13 resuelto en esta fase (imágenes por digest).

## 5. Limitaciones y riesgos residuales

1. **Sin clave de firma del proyecto (P-12).** Las versiones se firman con clave efímera hasta que el responsable siga `clave-de-firma.md`. Confianza de origen: **no establecida**.
2. **Registro de transparencia público (D-55):** cada firma registra una entrada en Rekor (Sigstore); ya ocurrió con las pre-versiones de prueba. Para `SHA256SUMS` contiene solo hash y clave pública [VERIFICADO]; para imágenes y atestaciones podría incluir la referencia `ghcr.io/<propietario>/…` [SUPUESTO, no verificado].
3. **Registros de CI no legibles desde el entorno del agente**; por eso los hallazgos se publican como anotaciones (D-53).
4. **El repositorio sigue privado** (D-23): CodeQL, OpenSSF Scorecard y el reporte privado de vulnerabilidades requieren repositorio público.
5. **Bitácora:** la eliminación de entradas posteriores al último anclaje no es detectable (R-26); la verificación se probó sobre el formato de exportación, no sobre la base de datos (aún no existe).
6. TLS del perfil institucional (CA interna, D-37) se define en la Fase 2; el perfil local usa HTTP solo en 127.0.0.1.
7. Las dependencias Go de Caddy no pasan por la política de licencias automática (que cubre npm); quedan inventariadas en el SBOM de la imagen web.
8. Semgrep se instala con versión fijada pero sin hashes, y sus reglas se descargan del registro de Semgrep (no fijadas, licencia propia de reglas) [SUPUESTO: uso en CI permitido; verificar].
9. Quedan dos ramas remotas `release/v0.1.0-rc.1` y `release/v0.1.0-rc.2` de las pruebas de publicación; el entorno del agente no puede borrarlas (puede borrarlas el responsable).
10. El perfil offline referencia PostgreSQL y Valkey por etiqueta; su integridad se garantiza con `IMAGE_IDS` dentro de `SHA256SUMS` firmado.
