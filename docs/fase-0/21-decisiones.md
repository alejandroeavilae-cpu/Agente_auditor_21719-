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
| D-06 | Cumplimiento | Revisión jurídica en dos niveles: (a) cada control del catálogo nace **"pendiente de revisión jurídica"** del proyecto y se muestra con advertencia; (b) en obligaciones legales el motor solo emite "Requiere validación" y **solo el rol Revisor jurídico de la organización** fija "Conforme/No conforme" | Evaluación legal automática | Alta |
| D-07 | Seguridad / privacidad | IA generativa **local y desactivada por defecto**; solo sugiere; sin herramientas ni red | IA activa por defecto | Alta |
| D-08 | Seguridad | "Solo lectura" web = solo GET/HEAD permitidos (lista permitida) salvo login declarado, sin envío de formularios, heurística anti-destructiva, contenedor aislado | Confiar en la buena fe de la aplicación | Alta |
| D-09 | Privacidad | **Muestreo de valores desactivado por defecto**; si se activa, se persisten **solo estadísticas agregadas**; nunca valores ni hashes por valor (R-25) | Muestreo por defecto | Alta |
| D-10 | Seguridad | Modalidad C: agente **solo saliente**, mTLS, política de compartición bloqueada por defecto, registro de lo transmitido | Panel que se conecta al agente | Media |
| D-11 | Confianza | Firmas **Cosign (Sigstore)** + SBOM **CycloneDX (Syft)** + atestaciones de procedencia; material para verificación offline | Solo hashes publicados | Alta |
| D-12 | Seguridad | Cifrado de sobre **AES-256-GCM** con clave maestra en archivo montado y DEK por tenant; OpenBao opcional; ningún gestor no libre obligatorio | HashiCorp Vault obligatorio | Media |
| D-43 | Seguridad | En Modalidades B y C las **credenciales de los sistemas auditados se guardan solo en el agente local** de la organización (cifradas con clave local); la plataforma central guarda una referencia opaca y nunca puede descifrarlas | Credenciales centralizadas | Media |
| D-44 | Seguridad / continuidad | **Respaldos lógicos por tenant cifrados por la aplicación** (independientes del motor, porque SQL Server Express no cifra respaldos), con claves respaldadas por separado; diseño detallado en Fase 2 | Depender del cifrado del motor | Alta |
| D-45 | Seguridad | **Archivos y contenido de terceros son hostiles**: parseo de PDF/DOCX/XLSX/CSV en el agente aislado con límites de tamaño, descompresión y tiempo, sin entidades XML externas; reportes renderizados con el navegador **sin red**, con escape de todo texto de origen externo y neutralización de fórmulas (`= + - @`) en exportes CSV/Excel | Confiar en los parsers | Alta |
| D-46 | Seguridad | El agente web usa **cuentas dedicadas de mínimo privilegio** en la aplicación auditada, creadas por la organización para la auditoría; nunca cuentas personales ni administrativas | Usar cuentas existentes | Alta |
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
| D-19 | Reportes: **PDF vía Playwright** desde HTML (sin red, ver D-45), **exceljs** para Excel, CSV nativo con neutralización de fórmulas |
| D-20 | **RAG solo sobre el catálogo normativo**; embeddings en la BD; sin base vectorial adicional; citas verificadas contra IDs del catálogo |
| D-21 | Modelo de IA por defecto elegido **por medición en Fase 10**; licencia libre obligatoria; ejecutable en CPU |
| D-22 | CI/CD en **GitHub Actions**, diseñado para ser portable a Forgejo/Woodpecker |
| D-25 | Riesgo: **matriz 5×5 configurable**, inherente y residual, con incertidumbre; nunca se traduce a multas |
| D-26 | Identificadores en inglés; comentarios, JSDoc explicativo y documentación en español; cabecera SPDX en cada archivo |
| D-27 | Equipo multiagente de desarrollo definido en `CLAUDE.md` y `.claude/agents/`; QA siempre distinto del implementador; revisión jurídica siempre humana |
| D-28 | **SemVer**; `CHANGELOG.md` en formato Keep a Changelog; soporte de seguridad a la última versión menor |
| D-29 | Despliegue oficial con **Docker Compose** (perfiles por modalidad); Kubernetes fuera de alcance en v1 |
| D-30 | **Sin telemetría** y **sin actualizaciones automáticas**; actualizaciones manuales verificadas |
| D-31 | Bitácora **solo-anexar con encadenamiento de hash** por tenant, verificable con CLI independiente, con **anclaje externo**: el último hash se firma periódicamente y se exporta a un destino controlado por la organización (archivo descargado, medio de solo escritura u otro sistema), porque quien controla la BD podría reescribir la cadena completa (R-26) |
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
| P-11 | Usuario de GitHub de mantenedores en `CODEOWNERS` y protección de rama (2 aprobaciones en áreas sensibles) — depende de P-03 y de que el repositorio sea público o el plan lo permita | Configuración de cuenta y personas | Gobernanza efectiva |
| P-10 | ~~Aprobación de la Fase 0 e inicio de la Fase 1~~ | **Resuelta: aprobada por Alejandro Ávila el 25-10-2026 a las 03:33 (hora de Chile)** | — |

## 4. Decisiones tomadas durante la Fase 1 (25-10-2026)

| ID | Decisión | Fundamento |
|---|---|---|
| D-47 | **TypeScript 6.0.3**, no 7.0 | typescript-eslint 8.72 exige TypeScript < 6.1 [VERIFICADO: peerDependencies en npm]. Reevaluar cuando typescript-eslint soporte 7.x |
| D-48 | Firma de versiones con **clave Cosign del proyecto**, generada y custodiada por el responsable (secreto `COSIGN_SIGNING_KEY_PEM`); sin ella, el workflow firma con una **clave efímera de prueba** y lo declara en las notas. La verificación offline usa la clave pública con `--insecure-ignore-tlog` | La clave privada no debe pasar por un sistema de IA ni por el chat; la verificación por clave funciona sin Internet (R-17). La firma keyless con registro público se evaluará al hacer público el repositorio |
| D-49 | **pnpm 10.28.0** fijado en `packageManager`; Node.js **24** (`.nvmrc`) | Node.js 26 aún no era LTS al iniciar la Fase 1 [FUENTE SECUNDARIA]; mantiene D-14 |
| D-50 | **PostgreSQL 18** y **Valkey 8** (imágenes alpine oficiales) | Versiones mayores estables y conservadoras [SUPUESTO: disponibilidad verificada en CI]; fijación por digest pendiente (P-13) |
| D-51 | NestJS 12 sobre **Express** (`@nestjs/platform-express`) y dependencias inyectadas con `@Inject` explícito | Plataforma por defecto de NestJS; la inyección explícita no depende de metadatos de decoradores, lo que simplifica pruebas |
| D-52 | **Acciones de GitHub fijadas por SHA de commit** con comentario de versión | Cadena de suministro (sección 15.4) |
| D-53 | Los escaneos publican sus hallazgos como **anotaciones** de GitHub Actions y la regla D-24 la aplica un script propio (`scripts/ci-report-trivy.mjs`) | Hallazgos visibles para cualquier revisor sin descargar registros |
| D-54 | Política de licencias de dependencias aplicada en CI (`scripts/check-licenses.mjs`) e inventario `THIRD_PARTY_LICENSES.md` generado y versionado | Sección 4; cualquier licencia nueva requiere decisión registrada |

### Pendientes nuevos

| ID | Pendiente | Responsable |
|---|---|---|
| P-12 | Generar la clave de firma del proyecto y cargarla como secreto (guía: `docs/fase-1/clave-de-firma.md`) | Responsable del proyecto |
| P-13 | Fijar imágenes base por digest (los digests se registran en cada ejecución de CI) | Fase 2 |
