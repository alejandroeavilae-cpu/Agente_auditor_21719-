# Auditor 21719 (nombre provisional)

Plataforma **open source y gratuita** de auditoría inteligente de protección de datos personales, orientada a la Ley 19.628 de Chile modificada por la **Ley 21.719**, para municipalidades, organismos públicos, empresas y organizaciones de cualquier tamaño.

> **Estado: Fase 0 — Análisis y arquitectura.** Todavía no existe código ejecutable. Nada de este repositorio constituye asesoría jurídica ni certifica el cumplimiento normativo de ninguna organización.

## Principio

> La plataforma debe ser confiable porque su comportamiento pueda verificarse, no porque sus desarrolladores simplemente afirmen que es segura.

## Qué hará

- Descubrir datos personales en bases de datos, archivos, APIs y aplicaciones web **autorizadas**, priorizando metadatos.
- Clasificarlos con reglas determinísticas, IA local opcional y validación humana.
- Evaluarlos frente a un catálogo normativo versionado, con revisión jurídica humana.
- Gestionar riesgos, hallazgos y planes correctivos.
- Permitir que cada institución **verifique** el software y lo que el agente hizo en sus sistemas.

## Modalidades

- **A — Local:** dentro de la institución, sin Internet.
- **B — Multiempresa autohospedada:** una base de datos por organización.
- **C — Híbrida opcional:** agente local que envía solo resultados autorizados.

## Documentación

- Especificación: [`docs/especificacion/prompt-maestro-v2.0.md`](docs/especificacion/prompt-maestro-v2.0.md)
- Fase 0 (análisis, arquitectura, riesgos, decisiones): [`docs/fase-0/00-indice.md`](docs/fase-0/00-indice.md)
- Registro de decisiones: [`docs/fase-0/21-decisiones.md`](docs/fase-0/21-decisiones.md)

## Licencia

Copyright (C) 2026 Alejandro Ávila y colaboradores del proyecto.

Este programa es software libre: puede redistribuirlo y/o modificarlo bajo los términos de la **GNU Affero General Public License** publicada por la Free Software Foundation, versión 3 o (a su elección) cualquier versión posterior. Ver [`LICENSE`](LICENSE).

## Contribuir y seguridad

- [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) · [`GOVERNANCE.md`](GOVERNANCE.md)
- Vulnerabilidades: **no abra un issue público**; ver [`SECURITY.md`](SECURITY.md).
