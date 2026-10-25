# Política de versiones

**Decisión D-28.** El software sigue [SemVer 2.0.0](https://semver.org/lang/es/):

| Cambio | Ejemplo | Cuándo |
|---|---|---|
| MAYOR | 1.x → 2.0.0 | Cambios incompatibles en API pública, formato de exportación, esquema de configuración o de bitácora |
| MENOR | 1.1 → 1.2.0 | Funcionalidad nueva compatible |
| PARCHE | 1.2.0 → 1.2.1 | Correcciones compatibles, incluidas de seguridad |
| Pre-versión | 0.1.0-rc.1 | Candidatas; nunca para producción |

Mientras la versión sea **0.x**, cualquier versión menor puede introducir cambios incompatibles (convención SemVer).

## Reglas de publicación

1. Solo se publica desde una etiqueta `vX.Y.Z` creada sobre `main` con CI en verde.
2. Toda versión incluye: imágenes en GHCR con digest, SBOM CycloneDX, `SHA256SUMS` firmado, paquete offline y notas en `CHANGELOG.md`.
3. Una versión firmada con clave efímera de prueba (sin clave del proyecto) se marca como pre-versión y no debe instalarse en producción.
4. Vulnerabilidad alta o crítica con corrección disponible bloquea la publicación (D-24).
5. El **catálogo normativo** tiene versión propia, independiente del software, y declara su fecha de vigencia normativa (D-05).

## Formato de bitácora

`AuditEntry` y `Anchor` (paquete `@auditor-21719/audit-log`) tienen formato versionado. Cambiarlo es un cambio MAYOR: los verificadores independientes de las organizaciones dependen de él.
