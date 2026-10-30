# Reglas para agentes de IA que trabajan en este repositorio

Este archivo rige a cualquier agente de IA (orquestador o especializado) que contribuya al proyecto. La especificación completa está en `docs/especificacion/prompt-maestro-v2.0.md`; el estado y las decisiones en `docs/fase-0/`.

## Fase actual

**Fase 0 aprobada** (25-10-2026). **Fase 1 aprobada y cerrada** (26-10-2026, PR #1). **Fase 2 aprobada por el responsable el 26-10-2026 23:37 (hora de Chile), en tres entregas con aprobación humana separada:**

- **2A — Base de datos y organizaciones: APROBADA Y CERRADA** (29-10-2026 13:32, fusión del PR #3 por el responsable). Alcance: BD de control, una BD por organización con usuario propio, cifrado de sobre de credenciales, bitácora persistida en BD, CLI de administración, CI con PostgreSQL y SQL Server.
- **2B — Identidad y permisos: APROBADA Y CERRADA** (29-10-2026 23:17, fusión del PR #4 por el responsable; R-34 aceptado, D-83). Diseño aprobado por el responsable (D-79). Alcance: usuarios de la plataforma, contraseñas argon2id, MFA TOTP, sesiones, roles y permisos (RBAC), operador de plataforma. Sin pantallas de gestión (2C).
- **2C — Pantallas, permisos entre roles y consola del operador: DISEÑO APROBADO** (29-10-2026 23:31, D-88; `docs/fase-2/2c-diseno.md`). Tres partes con PR, QA y aprobación humana separados:
  - **2C-1 Ajustes de identidad y despliegue: APROBADA POR QA (30-10-2026, segunda revisión), PENDIENTE DE APROBACIÓN HUMANA** (rama `fase-2c`, PR #5). D-75 ajustada, D-86, D-87/D-88, mitigación de R-34, pruebas de la cookie, perfil institucional HTTPS.
  - 2C-2 Pantallas de usuarios: NO iniciada (requiere aprobación de 2C-1).
  - 2C-3 Consola del operador: NO iniciada (requiere aprobación de 2C-2).
  Sin suite de aislamiento entre organizaciones (D-84).

No implementar partes de 2C no iniciadas ni fases posteriores (pantallas de gestión, conectores, etc.) hasta su aprobación. La v1 se concentra en la Modalidad A, instalación institucional local (D-74).

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
