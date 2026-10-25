# 15. Modelo de gobernanza comunitaria

Estado: **Diseñado**. Documentos operativos en la raíz del repositorio: `GOVERNANCE.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`.

## 15.1 Estructura

| Rol | Quién | Atribuciones |
|---|---|---|
| Responsable del proyecto | Alejandro Ávila | Aprobación de fases, hoja de ruta, nombramiento de mantenedores |
| Mantenedores | Responsable + [PENDIENTE P-03: al menos uno adicional antes de Fase 13] | Revisar y fusionar cambios, publicar versiones |
| Mantenedor del catálogo normativo | [PENDIENTE] | Versiones del catálogo |
| Revisor jurídico | [PENDIENTE P-01] | Revisión jurídica de controles |
| Equipo de respuesta de seguridad | Mantenedores | Gestión de vulnerabilidades reportadas |
| Contribuyentes | Cualquier persona | Propuestas vía pull request con DCO |

Modelo de decisión: consenso razonable entre mantenedores; en desacuerdo, decide el responsable del proyecto y se registra en el registro de decisiones.

## 15.2 Reglas de contribución

- Toda contribución firmada con **DCO** (`git commit -s`) (D-02).
- **Ninguna contribución se fusiona sin revisión humana** (sección 20). La rama principal está protegida: revisión aprobada, CI verde y commits firmados con DCO.
- Cambios en áreas sensibles (`packages/connector-sdk`, autenticación, cifrado, `catalog/`, workflows de CI) requieren **dos aprobaciones**, una de ellas de un mantenedor distinto del autor (vía `CODEOWNERS`). **[PENDIENTE P-03]:** con un único mantenedor esta regla no puede cumplirse hoy; hasta que exista un segundo mantenedor, los cambios en áreas sensibles quedan registrados como "sin segunda revisión" y no pueden publicarse en una versión estable.
- Nuevas dependencias requieren justificación en el PR, licencia compatible y verificación de mantenimiento.

## 15.3 Versiones y soporte

- **SemVer** (D-28). Catálogo normativo con versión propia independiente del software.
- Se da soporte de seguridad a la última versión menor publicada. [DECISIÓN D-28; ampliar cuando haya más mantenedores]
- Notas de versión en `CHANGELOG.md` (formato Keep a Changelog).

## 15.4 Gestión de vulnerabilidades

Reporte privado (ver `SECURITY.md`), acuse de recibo, evaluación, corrección, aviso público coordinado. No se publican detalles explotables antes de la corrección.

## 15.5 Continuidad

- Riesgo principal: un único mantenedor (R-15).
- Medidas: documentación completa en español, decisiones registradas, CI reproducible, sin servicios pagos indispensables, espejo opcional del repositorio en una forja libre [PENDIENTE P-09].
- Evaluar alojamiento institucional del proyecto (fundación, universidad u organización de la sociedad civil) (P-02).
