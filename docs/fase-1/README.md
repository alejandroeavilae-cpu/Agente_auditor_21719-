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

Todas las ejecuciones son reales; los enlaces llevan a GitHub Actions (repositorio privado: requieren acceso).

| ID | Prueba | Dónde | Resultado |
|---|---|---|---|
| — | `pnpm run verify` (SPDX, lint, tipos, 30 pruebas unitarias/integración, build, licencias) | Local (Node 24.22.1) y CI | Aprobada |
| PT-04 | Alteración y eliminación de entradas de bitácora detectadas | `packages/audit-log/test/chain.test.ts`, `cli.test.ts`, `scripts/smoke-audit-log.sh` en CI | Aprobada |
| PT-21 | Reescritura completa detectada solo con anclaje externo; la limitación sin anclaje queda probada explícitamente | `anchor.test.ts`, `cli.test.ts`, smoke en CI | Aprobada |
| — | API: salud, about con commit, cabeceras de seguridad, 404, configuración que falla cerrada | `apps/api/test/app.test.ts` | Aprobada |
| — | Web: rechazo de enlaces no https y formas inesperadas | `apps/web/test/about.test.ts` | Aprobada |
| — | Compose: salud vía proxy, commit correcto, CSP, sin cabecera Server, solo 127.0.0.1:8080 publicado, API no accesible directo, **red interna sin salida a Internet**, api/web no root, Valkey exige contraseña | `scripts/smoke-compose.sh` en CI, run [40170763182](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40170763182) | Aprobada |
| PT-17 | La regla D-24 **bloqueó** la integración al detectar vulnerabilidades altas con corrección (multer, undici, brace-expansion, runtime Go de Caddy, brotli); se corrigieron las causas, no se silenciaron | runs 40170452453 / 40170452332 (fallidos) → 40170763219 / 40170763182 (verdes) | Aprobada |
| — | Gitleaks (historial completo), Semgrep CE, Trivy fs, OSV-Scanner sin hallazgos bloqueantes | run [40170763219](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40170763219) | Aprobada |
| PT-02 | Firma de `SHA256SUMS` verificada **sin red** (`unshare --net`) y archivo alterado rechazado; firmas de imágenes verificadas | Release [40171398534](https://github.com/alejandroeavilae-cpu/Agente_auditor_21719-/actions/runs/40171398534) | Aprobada **con clave efímera** (mecanismo, no confianza de origen) |
| PT-01 (parcial) | Paquete offline extraído, imágenes cargadas desde el tar y servicios levantados con `pull_policy: never`; commit verificado | Release 40171398534 | Aprobada. Falta la prueba en una máquina sin red física (Fase 11) |

Pre-versión de prueba publicada: `v0.1.0-rc.1` (prerelease, firmada con clave efímera, advertencia en sus notas).

## 3. Criterios de aceptación (sección 24)

| # | Criterio | Estado |
|---|---|---|
| 1 | Requisitos aprobados implementados | Cumplido (tabla §1) |
| 2 | El código compila | Cumplido (local y CI) |
| 3 | Pruebas ejecutadas | Cumplido (§2) |
| 4 | Resultados verificables | Cumplido: ejecuciones de CI enlazadas |
| 5 | Riesgos de seguridad evaluados | Cumplido: escaneos + correcciones; ver §5 |
| 6 | Permisos correctos | Cumplido: contenedores sin root, `cap_drop: ALL`, workflows con permisos mínimos |
| 7 | Aislamiento de datos revisado | No aplica aún (sin tenants hasta Fase 2); red interna verificada |
| 8 | Comentarios explicativos en español | Cumplido |
| 9 | Documentación actualizada | Cumplido |
| 10 | Revisión QA | **Pendiente** (agente QA independiente) |
| 11 | Limitaciones documentadas | Cumplido (§5) |
| 12 | Aprobación humana | **Pendiente** (fusión del pull request) |

## 4. Decisiones de la fase

D-47 a D-54 en `docs/fase-0/21-decisiones.md` §4 (TypeScript 6.0, clave de firma custodiada por el responsable, versiones de Node/pnpm/PostgreSQL/Valkey, Express, acciones por SHA, anotaciones de escaneo, política de licencias). P-13 resuelto en esta fase (imágenes por digest).

## 5. Limitaciones y riesgos residuales

1. **Sin clave de firma del proyecto (P-12).** Las versiones se firman con clave efímera hasta que el responsable siga `clave-de-firma.md`. Confianza de origen: **no establecida**.
2. **Registros de CI no legibles desde el entorno del agente**; por eso los hallazgos se publican como anotaciones (D-53).
3. **Firma keyless con registro de transparencia público no habilitada** mientras el repositorio sea privado (D-48).
4. **El repositorio sigue privado** (D-23): CodeQL, OpenSSF Scorecard y el reporte privado de vulnerabilidades requieren repositorio público. Hacerlo público es la decisión de cierre de esta fase.
5. TLS del perfil institucional (CA interna, D-37) se define en la Fase 2; el perfil local usa HTTP solo en 127.0.0.1.
6. Las dependencias Go de Caddy no aparecen en `THIRD_PARTY_LICENSES.md` (que cubre npm); quedan inventariadas en el SBOM de la imagen web.
7. Queda una rama remota `release/v0.1.0-rc.1` usada para la prueba de publicación; el entorno del agente no puede borrarla.
8. Reglas Semgrep descargadas del registro de Semgrep (con licencia propia de reglas) [SUPUESTO: uso en CI permitido; verificar].
