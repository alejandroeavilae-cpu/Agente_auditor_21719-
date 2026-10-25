# Registro de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado según [SemVer](https://semver.org/lang/es/).

## [No publicado]

### Fase 1 — Infraestructura base
- Monorepo pnpm (Node.js 24, TypeScript 6.0 estricto, ESLint, Vitest).
- `@auditor-21719/audit-log`: bitácora encadenada, anclaje externo Ed25519 y CLI `auditor-log` de verificación independiente.
- API NestJS mínima (`/health`, `/api/v1/about`) y web React mínima.
- Docker Compose (perfiles local y offline), imágenes por digest, contenedores sin root, red interna sin salida.
- CI y seguridad: verificación, prueba de humo, Gitleaks, Semgrep CE, Trivy (regla D-24), OSV-Scanner.
- Publicación con SBOM CycloneDX, firmas Cosign y paquete offline verificable sin red; pre-versión de prueba `v0.1.0-rc.1`.
- Política de licencias de dependencias e inventario de terceros; guías de revisión, versiones, soporte, ejecución local y verificación.

### Seguridad
- Corregidas vulnerabilidades altas detectadas por la regla D-24: multer 2.5.0, runtime de Node sin npm/corepack, Caddy v2.11.7 compilado con Go 1.27 y x/net v0.60.0.

### Agregado
- Fase 0: especificación V2.0, análisis de factibilidad, revisión crítica, arquitectura, modelo de datos, diseño de conectores y agentes, seguridad, privacidad, multiempresa, IA local, estrategia normativa, gobernanza, plan por fases, historias de usuario, riesgos, plan de pruebas, trazabilidad, costos y registro de decisiones.
- Licencia AGPL-3.0-or-later y documentos de gobernanza comunitaria.
- Correcciones de la revisión QA independiente de la Fase 0: decisiones D-43 a D-46, riesgos R-25 a R-30, pruebas PT-21 a PT-30, revisión jurídica en dos niveles, anclaje externo de la bitácora, asignación de módulos a fases.
