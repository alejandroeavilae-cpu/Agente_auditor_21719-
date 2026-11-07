# Revisión de alineamiento con el Prompt Maestro V2.2

- **Fecha:** 07-11-2026.
- **Base:** `docs/especificacion/prompt-maestro-v2.2.md`, sección 27.1.
- **Repositorio revisado:** rama `main` en el commit `fb29cf5` (fusión del PR #5). Se revisó también la rama `fase-2c2` (PR #6, abierto) en el commit `ad8daf4`.
- **Quién la hizo:** el orquestador, por delegación del responsable (V2.2 §22). La revisión QA independiente está en la §7.
- **Estado de este documento:** `[DISEÑADO]`. No cambia código.

---

## 1. Estado real de cada fase

| Fase o entrega | Estado | Evidencia |
|---|---|---|
| Fase 0. Análisis y arquitectura | Aprobada (25-10-2026) | P-10 en `docs/fase-0/21-decisiones.md` |
| Fase 1. Infraestructura base | Cerrada (PR #1) | PR #1 fusionado el 26-10-2026 04:47 UTC [VERIFICADO vía API] |
| 2A. Base de datos y organizaciones | Cerrada (PR #3) | PR #3 fusionado el 29-10-2026 16:32 UTC [VERIFICADO vía API] |
| 2B. Identidad y permisos | Cerrada (PR #4) | PR #4 fusionado por `alejandroeavilae-cpu` el 30-10-2026 02:17 UTC [VERIFICADO vía API] |
| 2C-1. Ajustes de identidad y despliegue | **Cerrada (PR #5)**. `CLAUDE.md` decía "pendiente de aprobación humana", pero el responsable ya fusionó el PR | PR #5 fusionado por `alejandroeavilae-cpu` el 30-10-2026 05:42 UTC [VERIFICADO vía API]. Se corrige `CLAUDE.md` (D-106) |
| 2C-2. Pantallas de usuarios | **En curso** (PR #6 abierto). API, pantallas y E2E implementados; CI verde en `ad8daf4` | Verificaciones de `ad8daf4` exitosas: Verificación, Integración PostgreSQL y SQL Server, E2E y accesibilidad, Compose, Gitleaks, Semgrep, Trivy, OSV y CodeQL [VERIFICADO vía API]. `[PENDIENTE: QA independiente]` |
| 2C-3. Consola del operador | No iniciada | `CLAUDE.md` |
| Fases 3 a 13 | No iniciadas | — |
| Fase 14. Piloto | Fuera del alcance de construcción (V2.2 §22) | — |

---

## 2. Diferencias entre lo construido y la V2.2

Cada fila indica qué dice la V2.2, qué tiene el repositorio y la decisión: **corregir** (se cambia el repositorio), **aceptar** (se conserva lo construido y se documenta la razón) o **postergar**.

### 2.1 Gobierno del proceso

| # | Tema | V2.2 | Repositorio | Decisión |
|---|---|---|---|---|
| 1 | Especificación vigente | V2.2 | `CLAUDE.md` y `00-indice.md` apuntan a la V2.0 | **Corregir.** La V2.2 queda en `docs/especificacion/`; la V2.0 se conserva como histórico (D-94) |
| 2 | Aprobación humana por fase | No se requiere, salvo tres excepciones (§22). El orquestador fusiona los PR tras QA | Regla 1 de `CLAUDE.md`: "Ninguna fase avanza sin aprobación explícita del responsable". D-88: 2C-2 y 2C-3 con aprobación separada | **Corregir** `CLAUDE.md`, `.claude/agents/orquestador.md` y el registro de decisiones (D-95) |
| 3 | Revisión jurídica | Sin revisión jurídica especializada durante el desarrollo; compensación en §11 | Regla 4 de `CLAUDE.md`, D-06 (a) y P-01 (designar revisor jurídico) | **Corregir.** P-01 se cierra como "no aplica". Los controles nacen y permanecen como no revisados jurídicamente, con la advertencia obligatoria (D-96). La parte (b) de D-06, quién fija "Conforme"/"No conforme" dentro del producto, depende de P-15 |
| 4 | Estados de avance | Seis estados, sin "Revisado jurídicamente" (§23) | Siete estados en `CLAUDE.md` y `00-indice.md` | **Corregir** `CLAUDE.md`. Los documentos históricos de la Fase 0 no se reescriben |

### 2.2 Alcance y arquitectura

| # | Tema | V2.2 | Repositorio | Decisión |
|---|---|---|---|---|
| 5 | **Roles** | §16: tres roles fijos (administrador, auditor, lector), **un solo rol por usuario** | Seis roles web fijos (`org_admin`, `audit_lead`, `auditor`, `legal_reviewer`, `remediation_owner`, `reader`) más el operador de plataforma; un usuario puede tener varios roles, con combinaciones prohibidas (D-79, reconfirmada por el responsable el 29-10-2026). Implementado, probado y fusionado en 2B y 2C-1; las pantallas de 2C-2 lo usan | **Requiere decisión del responsable (P-15).** La V2.2 de hoy contradice una decisión suya anterior que ya está construida. Recomendación del orquestador: **aceptar lo construido** y ajustar la §16 de la especificación. Razones: ya está hecho y probado; la separación de funciones es más estricta que la de la V2.2; volver a tres roles exige rehacer 2B, 2C-1 y 2C-2, y no reduce riesgo. Mientras no se decida, **el PR #6 no se fusiona** |
| 6 | Aprobación de conclusiones | §16: las aprueba otro usuario con rol de auditor o administrador | D-06 (b): solo el rol Revisor jurídico de la organización fija "Conforme"/"No conforme" en obligaciones legales | Depende de P-15. Ambas reglas exigen una persona distinta de quien ejecutó |
| 7 | Mecanismos de "autenticación segura" | §16 deja que el orquestador los defina y documente | argon2id; sesiones de 30 min de inactividad y 12 h máximo; bloqueo por cuenta + origen (contraseña) y por cuenta (MFA); reautenticación MFA en acciones de alto riesgo; cookie `__Host-`/`Secure`; respuesta mínima de 300 ms (D-79, D-82, D-83, D-88, D-89) | **Aceptar.** Son los mecanismos concretos que pide la §16 (D-103) |
| 8 | MFA | Obligatoria, TOTP, códigos de recuperación, restablecimiento por otro administrador y recuperación por consola si ningún administrador puede acceder | TOTP obligatoria para todos (D-86); 10 códigos de recuperación (`packages/identity/src/tokens.ts`); restablecimiento por administrador. En la consola: `auditor-admin user unlock` (levanta un **bloqueo**, D-83) y `user invite-admin` (crea un administrador nuevo por enlace de activación). **No existe** un comando que restablezca la MFA de un administrador que perdió su celular y sus códigos [VERIFICADO: `apps/api/src/admin/cli.ts` en `main` y en `fase-2c2`] | **Aceptar** lo existente y **corregir** la falta: agregar `auditor-admin user reset-mfa`, registrado en la bitácora, después de resolver P-15 (D-107). Mientras tanto, la vía de recuperación es `user invite-admin` y que el administrador nuevo restablezca la MFA del anterior |
| 9 | Una sola organización | §5: una sola organización por instalación | Base de control y base propia de la organización (2A), con una sola organización por instalación (D-84) | **Aceptar** (ya decidido en D-84) |
| 10 | Modalidades B y C | Eliminadas | Postergadas (D-74). Hay diseño (D-10, D-43, `11-multiempresa.md`), sin código propio | **Corregir** la documentación: pasan de "postergadas" a "fuera de alcance" (D-99). Sin cambios de código |
| 11 | IA | Ollama por defecto, motor local intercambiable y DeepSeek opcional bajo las condiciones de §17.1 | D-07: IA local, desactivada por defecto, sin red. No implementada (Fase 10) | **Corregir** el diseño: D-100 modifica D-07 solo para el motor externo opcional. Se implementa en la Fase 10 |
| 12 | Herramientas de seguridad del código | §15.5: Gitleaks, CodeQL, OpenSSF Scorecard y Best Practices Badge | Gitleaks (historial completo), Semgrep CE, Trivy (bloqueo D-24), OSV-Scanner (informe), CodeQL (`security-extended`) y Scorecard. Sin Best Practices Badge | **Aceptar** las herramientas adicionales, porque la V2.2 no las prohíbe y quitarlas reduciría la protección (D-101). La insignia queda pendiente (P-17) |
| 13 | Bloqueo de integración | §15.5, regla 2: no integrar si Gitleaks detecta un secreto o CodeQL reporta alertas críticas o altas | `main` **no tiene protección de rama** [VERIFICADO vía API: "Branch not protected"]. Los jobs fallan, pero nada impide fusionar | **Corregir con el proceso** mientras no haya protección de rama: el orquestador no fusiona sin verificar por API los resultados (D-102). La protección de rama requiere permisos de administración (P-16) |
| 14 | Pruebas | §20 ya no exige pruebas de seguridad, multiempresa, resiliencia ni de cadena de suministro | Existen pruebas adversariales, de valores centinela, integración con motores reales, E2E, accesibilidad y ZAP | **Aceptar.** Se conservan (D-104). Quitarlas reduciría la calidad y la V2.2 no lo pide |
| 15 | Licencia | AGPLv3 | AGPL-3.0-or-later (D-01), `LICENSE`, cabeceras SPDX y `check-licenses.mjs` | Alineado |
| 16 | Fuentes normativas | Textos oficiales de las leyes 21.719 y 19.628 (§11) | `13-evaluacion-normativa.md`: el texto consolidado no se pudo consultar; varios epígrafes y los artículos transitorios vienen de una fuente secundaria | **Corregir.** Las fuentes oficiales quedan en `docs/normativa/fuentes/` con hashes (D-97, D-98). Los epígrafes marcados `[FUENTE SECUNDARIA]` se verifican contra el texto oficial en la Fase 5 |
| 17 | Fase 14 | Fuera del alcance de construcción | P-04 y P-08 bloqueaban la Fase 14 | **Corregir:** pasan a planificación separada (D-105) |

---

## 3. Decisiones pendientes del responsable

| ID | Pendiente | Por qué no la toma el orquestador | Bloquea |
|---|---|---|---|
| P-15 | **Roles:** tres roles de la V2.2 §16 o los seis roles más el operador ya construidos (D-79) | Revierte una decisión explícita del responsable, ya construida y reconfirmada | Fusión del PR #6 (2C-2), 2C-3 y la regla de aprobación de conclusiones (Fase 5) |
| P-16 | Activar la protección de la rama `main` con verificaciones obligatorias: Gitleaks, Verificación, Trivy y CodeQL | Requiere permisos de administración del repositorio | Nada; mientras tanto rige D-102 |
| P-17 | Registrar el proyecto en bestpractices.dev para la OpenSSF Best Practices Badge | Requiere iniciar sesión con la cuenta del responsable | Fase 13 (V2.2 §15.5) |

Sigue vigente **P-03** (incorporar un segundo mantenedor), que bloquea la publicación (Fase 13). La publicación de una versión requiere además la aprobación del responsable (V2.2 §22).

---

## 4. Riesgos nuevos

| ID | Riesgo | Tratamiento |
|---|---|---|
| R-39 | Sin revisión jurídica especializada, un error de interpretación del catálogo no se detecta | Cita literal del artículo en cada control; aprobación de conclusiones por otra persona; advertencia obligatoria en informes (D-96) |
| R-40 | El motor externo opcional (DeepSeek) recibe un dato personal que el filtro no detecta, o información confidencial sobre debilidades de seguridad de la institución | Desactivado por defecto; filtro con registro de bloqueos; sin evidencias ni muestras; registro de todo lo enviado; la institución elige qué tipos de informe lo usan (V2.2 §17.1) |
| R-41 | Sin protección de rama, las reglas de bloqueo dependen de que el orquestador las cumpla | D-102 y P-16 |

---

## 5. Documentos actualizados en esta entrega

| Documento | Cambio |
|---|---|
| `docs/especificacion/prompt-maestro-v2.2.md` | Nueva especificación vigente |
| `docs/normativa/fuentes/` | PDF oficiales, texto extraído, `SHA256SUMS` y README |
| `CLAUDE.md` | Estado real, reglas 1 y 4, estados de avance, referencia a la V2.2, pendiente P-15 |
| `.claude/agents/orquestador.md` y `qa.md` | Cierre de fase sin aprobación humana, referencias a la V2.2 |
| `docs/fase-0/21-decisiones.md` | D-94 a D-107 y P-15 a P-17; P-01, P-04 y P-08 actualizados |
| `docs/fase-0/17-matriz-de-riesgos.md` | R-39 a R-41; tratamiento de R-01 actualizado |
| `docs/fase-0/00-indice.md`, `11-multiempresa.md`, `12-ia-local.md`, `13-evaluacion-normativa.md`, `15-plan-por-fases.md` | Aviso al inicio con el cambio de la V2.2. El contenido histórico no se reescribe |
| `CHANGELOG.md` | Entrada en "Sin publicar" |

---

## 6. Próximo paso

1. Fusionar esta entrega después de su QA (§7).
2. Con la respuesta del responsable a P-15, ajustar la especificación o el código y hacer la QA independiente del PR #6 (2C-2).
3. Continuar con 2C-3 y la Fase 3.

---

## 7. Revisión QA independiente

`[PENDIENTE: se completa con el resultado de la revisión QA antes de fusionar]`
