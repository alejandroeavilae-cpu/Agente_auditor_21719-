# 22. Registro de decisiones (tomadas y pendientes)

**Contexto:** el 25-10-2026 el responsable del proyecto, Alejandro Ávila, delegó explícitamente la toma de cada decisión en la opción recomendada por el equipo de análisis, con registro completo. Las decisiones siguientes se tomaron bajo esa delegación. Cada una indica su reversibilidad. Las decisiones que **no pueden delegarse** a un sistema de IA (porque requieren criterio jurídico, compromisos de personas o instituciones) se listan en §3.

Conforme a la sección 28, se presentan primero las que pueden comprometer seguridad, cumplimiento normativo, gratuidad o viabilidad técnica.

## 1. Decisiones críticas

| ID | Ámbito | Decisión | Alternativa descartada | Reversibilidad |
|---|---|---|---|---|
| D-01 | Gratuidad / licencia | **AGPL-3.0-or-later** | Apache-2.0 (permite cierre como servicio) | Libre hasta la primera contribución externa; luego requiere consentimiento |
| D-02 | Gobernanza | Contribuciones con **DCO**, sin CLA | CLA (permitiría relicenciar a cerrado) | Alta |
| D-03 | Gratuidad / técnica | **PostgreSQL por defecto**; SQL Server como adaptador oficial probado en CI | SQL Server como único motor | Media (esquema común vía Prisma) |
| D-04 | Seguridad | **Base de datos por tenant** + BD de control | Filas con tenantId; esquema por tenant | Baja una vez en producción |
| D-05 | Cumplimiento | Fecha de vigencia normativa como **parámetro del catálogo versionado** (hoy 01-12-2026) | Fecha en código | Alta |
| D-06 | Cumplimiento | Controles nacen **"pendiente de revisión jurídica"**; sin revisión, obligaciones legales solo pueden quedar "Requiere validación"; solo el rol Revisor jurídico confirma "Conforme/No conforme" | Evaluación legal automática | Alta |
| D-07 | Seguridad / privacidad | IA generativa **local y desactivada por defecto**; solo sugiere; sin herramientas ni red | IA activa por defecto | Alta |
| D-08 | Seguridad | "Solo lectura" web = bloqueo de métodos no seguros salvo login declarado, sin envío de formularios, heurística anti-destructiva, contenedor aislado | Confiar en la buena fe de la aplicación | Alta |
| D-09 | Privacidad | **Muestreo de valores desactivado por defecto**; si se activa, se persisten solo estadísticas/hashes, nunca valores | Muestreo por defecto | Alta |
| D-10 | Seguridad | Modalidad C: agente **solo saliente**, mTLS, política de compartición bloqueada por defecto, registro de lo transmitido | Panel que se conecta al agente | Media |
| D-11 | Confianza | Firmas **Cosign (Sigstore)** + SBOM **CycloneDX (Syft)** + atestaciones de procedencia; material para verificación offline | Solo hashes publicados | Alta |
| D-12 | Seguridad | Cifrado de sobre **AES-256-GCM** con clave maestra en archivo montado y DEK por tenant; OpenBao opcional; ningún gestor no libre obligatorio | HashiCorp Vault obligatorio | Media |
| D-23 | Gratuidad / confianza | Repositorio **privado hasta cerrar la Fase 1** (higiene de secretos y políticas listas); luego público, con aprobación del responsable | Publicar de inmediato | Hacer público es irreversible en la práctica |
| D-24 | Seguridad | Vulnerabilidad crítica/alta con corrección disponible **bloquea publicación**; sin corrección, excepción documentada aprobada por otro mantenedor | Solo advertir | Alta |
| D-32 | Confianza | **Adelantar** bitácora encadenada, registro de consultas, firmas y SBOM a Fases 1–3 | Todo en Fase 11 | Alta |

## 2. Decisiones técnicas y de proceso

| ID | Decisión |
|---|---|
| D-13 | Monorepo con **pnpm workspaces** (`apps/web`, `apps/api`, `apps/agent`, `packages/*`, `catalog/`, `deploy/`) |
| D-14 | **Node.js 24 LTS** para iniciar; reevaluar Node.js 26 al arrancar la Fase 1 si ya es LTS y las dependencias lo soportan |
| D-15 | **NestJS + Prisma 7** (adaptadores de driver) + **zod** + OpenAPI 3 |
| D-16 | Frontend **React + Vite + React Aria Components + TanStack Query + Recharts**; objetivo **WCAG 2.2 AA**; sin CDN |
| D-17 | Colas con **Valkey + BullMQ** |
| D-18 | Autenticación propia: **argon2id + MFA TOTP** (obligatorio en roles con privilegios); WebAuthn posterior; **OIDC opcional**; sin proveedor de identidad empaquetado |
| D-19 | Reportes: **PDF vía Playwright** desde HTML, **exceljs** para Excel, CSV nativo |
| D-20 | **RAG solo sobre el catálogo normativo**; embeddings en la BD; sin base vectorial adicional; citas verificadas contra IDs del catálogo |
| D-21 | Modelo de IA por defecto elegido **por medición en Fase 10**; licencia libre obligatoria; ejecutable en CPU |
| D-22 | CI/CD en **GitHub Actions**, diseñado para ser portable a Forgejo/Woodpecker |
| D-25 | Riesgo: **matriz 5×5 configurable**, inherente y residual, con incertidumbre; nunca se traduce a multas |
| D-26 | Identificadores en inglés; comentarios, JSDoc explicativo y documentación en español; cabecera SPDX en cada archivo |
| D-27 | Equipo multiagente de desarrollo definido en `CLAUDE.md` y `.claude/agents/`; QA siempre distinto del implementador; revisión jurídica siempre humana |
| D-28 | **SemVer**; `CHANGELOG.md` en formato Keep a Changelog; soporte de seguridad a la última versión menor |
| D-29 | Despliegue oficial con **Docker Compose** (perfiles por modalidad); Kubernetes fuera de alcance en v1 |
| D-30 | **Sin telemetría** y **sin actualizaciones automáticas**; actualizaciones manuales verificadas |
| D-31 | Bitácora **solo-anexar con encadenamiento de hash** por tenant, verificable con CLI independiente |
| D-33 | Conectores v1: PostgreSQL, SQL Server, MySQL, CSV, Excel, REST (Fase 3); PDF y DOCX (Fase 4); web con Playwright (Fase 10). Oracle, SAP, SharePoint, Salesforce y legacy: solo interfaces |
| D-34 | **OCR fuera de alcance** en v1 |
| D-35 | Interfaz solo en **español (es-CL)**, con arquitectura i18n preparada |
| D-36 | **Monolito modular** + workers + agente separado; sin microservicios |
| D-37 | Proxy inverso **Caddy** con CA interna para instalaciones sin Internet |
| D-38 | Evidencias en **sistema de archivos por tenant, cifradas** con la clave del tenant; sin servidor de objetos adicional |
| D-39 | Pruebas con **Vitest, Playwright Test y Testcontainers** |
| D-40 | Hito **MVP publicable al cierre de la Fase 9** (sin IA ni agente web) |
| D-41 | Nombre provisional del proyecto: **"Auditor 21719"** (el repositorio conserva su nombre actual) |
| D-42 | Rol **Operador de plataforma sin acceso a contenido** de tenants; acceso de emergencia con aprobación del tenant |

## 3. Decisiones pendientes que requieren a una persona (no delegables)

| ID | Decisión pendiente | Por qué no puede tomarla la IA | Bloquea |
|---|---|---|---|
| P-01 | Designar **revisor/a jurídico/a** del catálogo y de la elección de licencia | Requiere criterio y responsabilidad profesional | Marcar controles como revisados (Fase 5) |
| P-02 | Titularidad del copyright a largo plazo (persona vs. fundación/organización) | Compromiso legal e institucional | Continuidad (no bloquea fases) |
| P-03 | Incorporar **al menos un segundo mantenedor** | Requiere personas | Publicación (Fase 13) |
| P-04 | Elegir **institución piloto** | Requiere acuerdo institucional | Fase 14 |
| P-05 | Activar el **reporte privado de vulnerabilidades** en GitHub (requiere configuración del dueño del repositorio) | Acción de configuración de cuenta | Publicación del repo |
| P-06 | Seguimiento del **boletín 18.623-07** hasta su resultado | Hecho externo futuro | Versión del catálogo |
| P-07 | Nombre definitivo del proyecto | Preferencia del responsable | No bloquea |
| P-08 | Hardware real del piloto | Depende de la institución | Fase 14 |
| P-09 | Espejo del repositorio en una forja libre (Codeberg u otra) | Cuenta y compromiso del responsable | No bloquea |
| P-10 | **Aprobación de la Fase 0 e inicio de la Fase 1** | Puerta de fase humana (sección 23) | Todo el desarrollo |
