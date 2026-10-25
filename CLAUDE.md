# Reglas para agentes de IA que trabajan en este repositorio

Este archivo rige a cualquier agente de IA (orquestador o especializado) que contribuya al proyecto. La especificación completa está en `docs/especificacion/prompt-maestro-v2.0.md`; el estado y las decisiones en `docs/fase-0/`.

## Fase actual

**Fase 0 completada en estado "Diseñado". Fase 1 NO aprobada.** No escribir código de producción hasta que el responsable del proyecto apruebe explícitamente el inicio de la Fase 1 (decisión pendiente P-10).

## Reglas no negociables

1. **Puertas de fase humanas.** Ninguna fase avanza sin aprobación explícita del responsable del proyecto.
2. **No inventar.** Ni artículos legales, plazos, montos de sanciones, resultados de pruebas, métricas ni licencias. Si algo no se verificó, se etiqueta `[SUPUESTO]`, `[ESTIMACIÓN]` o `[PENDIENTE]`.
3. **Estado epistémico explícito** en documentación: `[VERIFICADO]` (con fuente), `[FUENTE SECUNDARIA]`, `[DECISIÓN]`, `[ESTIMACIÓN]`, `[SUPUESTO]`, `[PENDIENTE]`.
4. **Revisión jurídica siempre humana.** Ningún agente marca un control como `legalReviewStatus: reviewed`.
5. **QA independiente.** Quien implementa no aprueba su propio trabajo; la verificación la hace un agente QA distinto con evidencia de ejecución real.
6. **Sin datos reales.** Solo datos sintéticos. Nunca credenciales ni datos personales en el repositorio.
7. **Seguridad desde el diseño.** Solo lectura en sistemas auditados; mínimo privilegio; sin evasión de controles de acceso; la IA del producto nunca ejecuta acciones.
8. **Gratuidad.** Ninguna dependencia obligatoria con licencia no libre o de pago. Toda dependencia nueva requiere licencia compatible con AGPL-3.0-or-later.

## Convenciones de código (desde Fase 1)

- TypeScript `strict`. Identificadores en inglés.
- Comentarios en español que explican propósito, condiciones y razones (no lo obvio). JSDoc en interfaces públicas.
- Cabecera `// SPDX-License-Identifier: AGPL-3.0-or-later` en cada archivo fuente.
- Validación de entradas con zod. Errores consistentes. Pruebas con Vitest/Playwright/Testcontainers.
- Commits con DCO (`git commit -s`).

## Distinguir siempre

Diseñado · Implementado · Probado · Validado · Revisado en seguridad · Revisado jurídicamente · Aprobado para publicación.

## Roles

Definiciones operativas en `.claude/agents/`: `orquestador`, `frontend`, `backend`, `devops-seguridad`, `qa`.
