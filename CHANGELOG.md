# Registro de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado según [SemVer](https://semver.org/lang/es/).

## [No publicado]

### Alineamiento con el Prompt Maestro V2.2 (07-11-2026)
- Especificación vigente: Prompt Maestro V2.2 (`docs/especificacion/prompt-maestro-v2.2.md`); la V2.0 queda como histórico.
- Fuentes normativas oficiales (leyes 21.719 y 19.628, generadas por la BCN el 07-11-2026) en `docs/normativa/fuentes/`, con hashes SHA-256.
- Revisión de alineamiento (`docs/alineamiento-v2.2.md`) y decisiones D-94 a D-107, pendientes P-15 a P-17 y riesgos R-39 a R-41.
- `CLAUDE.md` y definiciones de agentes: cierre de fases sin aprobación humana con QA independiente, sin revisión jurídica especializada, reglas antes de fusionar y estado real de las entregas.

### Fase 1 — Infraestructura base (aprobada 26-10-2026)
- Monorepo pnpm (Node.js 24, TypeScript 6.0 estricto, ESLint, Vitest).
- `@auditor-21719/audit-log`: bitácora encadenada, anclaje externo Ed25519 y CLI `auditor-log` de verificación independiente.
- API NestJS mínima (`/health`, `/api/v1/about`) y web React mínima.
- Docker Compose (perfiles local y offline), imágenes por digest, contenedores sin root, red interna sin salida.
- CI y seguridad: verificación, prueba de humo, Gitleaks, Semgrep CE, Trivy (regla D-24), OSV-Scanner.
- Publicación con SBOM CycloneDX, firmas Cosign y paquete offline verificable sin red; probado con pre-versiones `v0.1.0-rc.1` a `rc.3` (eliminadas después de las pruebas).
- Repositorio público; CodeQL y OpenSSF Scorecard; reporte privado de vulnerabilidades activado.
- Política de licencias de dependencias e inventario de terceros; guías de revisión, versiones, soporte, ejecución local y verificación.

### Seguridad
- Corregidas vulnerabilidades altas detectadas por la regla D-24: multer 2.5.0, runtime de Node sin npm/corepack, Caddy v2.11.7 compilado con Go 1.27 y x/net v0.60.0.

### Agregado
- Fase 0: especificación V2.0, análisis de factibilidad, revisión crítica, arquitectura, modelo de datos, diseño de conectores y agentes, seguridad, privacidad, multiempresa, IA local, estrategia normativa, gobernanza, plan por fases, historias de usuario, riesgos, plan de pruebas, trazabilidad, costos y registro de decisiones.
- Licencia AGPL-3.0-or-later y documentos de gobernanza comunitaria.
- Correcciones de la revisión QA independiente de la Fase 0: decisiones D-43 a D-46, riesgos R-25 a R-30, pruebas PT-21 a PT-30, revisión jurídica en dos niveles, anclaje externo de la bitácora, asignación de módulos a fases.
