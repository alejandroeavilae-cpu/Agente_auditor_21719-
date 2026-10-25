# Fase 0 — Análisis y arquitectura: índice

**Proyecto:** Plataforma open source de auditoría de protección de datos personales (Ley 19.628 modificada por Ley 21.719, Chile)
**Fuente de requisitos:** `docs/especificacion/prompt-maestro-v2.0.md`
**Fecha de elaboración:** 25-10-2026
**Estado de la fase:** Diseñado. No implementado. Pendiente de aprobación humana para iniciar Fase 1.

## Convenciones de estado epistémico

Toda afirmación relevante de estos documentos lleva una de estas etiquetas:

| Etiqueta | Significado |
|---|---|
| **[VERIFICADO]** | Comprobado en una fuente citada al pie del documento, con fecha de consulta. |
| **[FUENTE SECUNDARIA]** | Tomado de una fuente no oficial; debe contrastarse con el texto oficial antes de usarse como regla. |
| **[DECISIÓN]** | Decisión tomada por delegación del responsable del proyecto (25-10-2026). Registrada en `21-decisiones.md`. Reversible según se indica. |
| **[ESTIMACIÓN]** | Valor de ingeniería no medido. Debe validarse con pruebas o en el piloto. |
| **[SUPUESTO]** | Condición que se da por cierta para avanzar; si cambia, se reabre el diseño. |
| **[PENDIENTE]** | No resuelto; requiere información o revisión humana (especialmente jurídica). |

Estados de avance (sección 24 de la especificación): Diseñado → Implementado → Probado → Validado → Revisado en seguridad → Revisado jurídicamente → Aprobado para publicación. **Todo lo contenido en esta fase está únicamente en estado "Diseñado".**

## Mapa de entregables (sección 28)

| N° | Entregable | Documento |
|---|---|---|
| — | Decisiones críticas (presentadas primero) | [21-decisiones.md](21-decisiones.md) |
| 1 | Resumen ejecutivo | [01-resumen-ejecutivo.md](01-resumen-ejecutivo.md) |
| 2 | Análisis de factibilidad | [02-factibilidad.md](02-factibilidad.md) |
| 3 | Revisión crítica de la especificación (incluye sección 27 completa) | [03-revision-critica.md](03-revision-critica.md) |
| 4 | Propuesta de licencia | [04-licencia.md](04-licencia.md) |
| 5 | Arquitectura técnica | [05-arquitectura.md](05-arquitectura.md) |
| 6 | Diagramas de componentes y despliegue | [05-arquitectura.md](05-arquitectura.md) §4–§5 |
| 7 | Modelo de datos preliminar | [06-modelo-de-datos.md](06-modelo-de-datos.md) |
| 8 | Diseño de conectores | [07-conectores.md](07-conectores.md) |
| 9 | Diseño de agentes | [08-agentes.md](08-agentes.md) |
| 10 | Arquitectura de seguridad | [09-seguridad.md](09-seguridad.md) |
| 11 | Modelo de privacidad | [10-privacidad.md](10-privacidad.md) |
| 12 | Modelo de aislamiento multiempresa | [11-multiempresa.md](11-multiempresa.md) |
| 13 | Estrategia de IA local | [12-ia-local.md](12-ia-local.md) |
| 14 | Estrategia de evaluación normativa (incluye matriz normativa preliminar) | [13-evaluacion-normativa.md](13-evaluacion-normativa.md) |
| 15 | Modelo de gobernanza comunitaria | [14-gobernanza.md](14-gobernanza.md) |
| 16 | Plan de desarrollo por fases | [15-plan-por-fases.md](15-plan-por-fases.md) |
| 17 | Historias de usuario | [16-historias-de-usuario.md](16-historias-de-usuario.md) |
| 18 | Matriz de riesgos | [17-matriz-de-riesgos.md](17-matriz-de-riesgos.md) |
| 19 | Plan de pruebas | [18-plan-de-pruebas.md](18-plan-de-pruebas.md) |
| 20 | Matriz de trazabilidad | [19-matriz-de-trazabilidad.md](19-matriz-de-trazabilidad.md) |
| 21 | Estimación de recursos y costos operativos | [20-recursos-y-costos.md](20-recursos-y-costos.md) |
| 22 | Lista de decisiones (tomadas y pendientes) | [21-decisiones.md](21-decisiones.md) |

## Advertencias generales

- Esta especificación y este análisis **no son exhaustivos**, y ningún diseño garantiza que el software sea invulnerable (sección 27).
- Ningún contenido de esta fase constituye asesoría jurídica. Toda regla normativa queda en estado **[PENDIENTE] de revisión jurídica** hasta que un profesional del derecho la revise.
