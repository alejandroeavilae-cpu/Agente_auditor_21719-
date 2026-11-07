# Reglas para agentes de IA que trabajan en este repositorio

Este archivo rige a cualquier agente de IA (orquestador o especializado) que contribuya al proyecto. La especificación vigente es `docs/especificacion/prompt-maestro-v2.2.md` (D-94); la V2.0 se conserva como histórico. El estado y las decisiones están en `docs/fase-0/` y la revisión de alineamiento con la V2.2 en `docs/alineamiento-v2.2.md`.

## Fase actual

**Fase 0 aprobada** (25-10-2026). **Fase 1 cerrada** (26-10-2026, PR #1). **Fase 2** en tres entregas:

- **2A — Base de datos y organizaciones: CERRADA** (29-10-2026, PR #3).
- **2B — Identidad y permisos: CERRADA** (30-10-2026, PR #4; R-34 aceptado, D-83). Diseño D-79.
- **2C — Pantallas, permisos entre roles y consola del operador** (diseño D-88, `docs/fase-2/2c-diseno.md`):
  - **2C-1 Ajustes de identidad y despliegue: CERRADA** (fusión del PR #5 por el responsable, 30-10-2026; D-106).
  - **2C-2 Pantallas de usuarios: EN CURSO** (rama `fase-2c2`, PR #6). CI verde; falta la QA independiente. **No fusionar hasta resolver P-15 (roles).**
  - 2C-3 Consola del operador: NO iniciada.
  Una sola organización por instalación (D-84). Sin suite de aislamiento entre organizaciones.

**Pendientes del responsable:** P-15 (roles: los tres de la V2.2 §16 o los seis más el operador ya construidos), P-16 (protección de rama) y P-17 (Best Practices Badge). Ver `docs/fase-0/21-decisiones.md` §6.1.

Solo instalación institucional local: las Modalidades B y C están fuera de alcance (D-99). La Fase 14 (piloto) está fuera del alcance de construcción (D-105).

## Reglas no negociables

1. **Cierre de fases sin aprobación humana, con QA independiente** (D-95). El orquestador cierra cada fase después de la QA independiente y deja la decisión en el registro de decisiones (decisión, alternativas, justificación, riesgos y fecha). El orquestador fusiona los PR. **Requieren aprobación del responsable:** cambio de licencia, publicación de una versión etiquetada e instalación en una institución real. Una decisión que revierta otra tomada explícitamente por el responsable también se le consulta.
2. **No inventar.** Ni artículos legales, plazos, montos de sanciones, resultados de pruebas, métricas ni licencias. Si algo no se verificó, se etiqueta `[SUPUESTO]`, `[ESTIMACIÓN]` o `[PENDIENTE]`.
3. **Estado epistémico explícito** en documentación: `[VERIFICADO]` (con fuente), `[FUENTE SECUNDARIA]`, `[DECISIÓN]`, `[ESTIMACIÓN]`, `[SUPUESTO]`, `[PENDIENTE]`.
4. **Sin revisión jurídica especializada, sin presentarla como hecha** (D-96). Las únicas fuentes normativas son las de `docs/normativa/fuentes/` (D-97). Cada control cita el artículo y su texto literal. Ningún agente marca un control como `legalReviewStatus: reviewed`. Todo informe incluye: "Este informe no constituye asesoría legal ni ha sido validado por un abogado".
5. **QA independiente.** Quien implementa no aprueba su propio trabajo; la verificación la hace un agente QA distinto con evidencia de ejecución real.
6. **Sin datos reales.** Solo datos sintéticos. Nunca credenciales ni datos personales en el repositorio.
7. **Seguridad desde el diseño.** Solo lectura en sistemas auditados; mínimo privilegio; sin evasión de controles de acceso; la IA del producto nunca ejecuta acciones sobre los sistemas auditados. El motor externo opcional (DeepSeek) solo se usa con las condiciones de la V2.2 §17.1 (D-100).
8. **Gratuidad.** Ninguna dependencia obligatoria con licencia no libre o de pago. Toda dependencia nueva requiere licencia compatible con AGPL-3.0-or-later.
9. **Antes de fusionar** (D-102, mientras `main` no tenga protección de rama): comprobar por la API de GitHub que Gitleaks, Verificación, Trivy y CodeQL terminaron con éxito en el último commit del PR y que no hay alertas abiertas de CodeQL de severidad crítica o alta.

## Convenciones de código (desde Fase 1)

- TypeScript `strict`. Identificadores en inglés.
- Comentarios en español que explican propósito, condiciones y razones (no lo obvio). JSDoc en interfaces públicas.
- Cabecera `// SPDX-License-Identifier: AGPL-3.0-or-later` en cada archivo fuente.
- Validación de entradas con zod. Errores consistentes. Pruebas con Vitest/Playwright/Testcontainers.
- Commits con DCO (`git commit -s`).

## Distinguir siempre

Estados de avance de la V2.2 §23:

- **Diseñado:** existe diseño documentado.
- **Implementado:** el código existe y compila.
- **Probado:** las pruebas fueron ejecutadas y sus resultados registrados.
- **Validado:** QA verificó los criterios de aceptación.
- **Revisado en seguridad:** se evaluaron los riesgos y no hay alertas críticas o altas abiertas en las herramientas de la V2.2 §15.5.
- **Aprobado para publicación:** aprobado por el responsable del proyecto.

## Roles

Definiciones operativas en `.claude/agents/`: `orquestador`, `frontend`, `backend`, `devops-seguridad`, `qa`.
