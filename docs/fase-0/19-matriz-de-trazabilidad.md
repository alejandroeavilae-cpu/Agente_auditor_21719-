# 20. Matriz de trazabilidad

Requisito (sección de la especificación) → decisión/diseño → historia de usuario → fase → prueba. Estado de todos los requisitos: **Diseñado**.

| Req. | Requisito | Diseño / decisión | HU | Fase | Prueba |
|---|---|---|---|---|---|
| §1.1-1,3,5,16 | Gratuidad total | D-01, D-03, 20-recursos | — | 1 | Política de licencias en CI |
| §1.1-2,9 | Código público e inspeccionable | D-23, AGPL | HU-02 | 1, 13 | PT-02 |
| §1.1-6 | Sin APIs comerciales obligatorias | C-10, D-07 | HU-22 | 10 | PT-25 |
| §1.1-10 | Minimización | D-09, 10-privacidad | HU-13 | 3–4 | PT-08 |
| §1.1-11 | Mínimo privilegio | Preflight conectores, RBAC | HU-09 | 2–3 | PT-05 |
| §1.1-12 | Autorización explícita | A-01 `AuditAuthorization` | HU-08 | 3 | PT-24 |
| §1.1-13 | Trazabilidad verificable | D-31, D-32 | HU-03 | 1–3 | PT-03, PT-04, PT-21 |
| §1.1-14 | IA sin operaciones destructivas | 12-ia-local, 08-agentes | — | 10 | PT-19 |
| §2 | Equipo multiagente | 08-agentes Parte B, CLAUDE.md | — | 0–14 | Revisión QA por fase |
| §3 | Reglas de desarrollo | CLAUDE.md, lint, TS estricto | — | 1 | Lint en CI |
| §4 | Licencia | D-01, D-02, 04-licencia | — | 0–1 | Política de licencias |
| §5-A | Instalación local offline | 05-arquitectura §6.3 | HU-01 | 1, 11 | PT-01, PT-02 |
| §5-B | Multiempresa | D-04, 11-multiempresa | HU-06, HU-07 | 2 | PT-12 |
| §5-C | Híbrida | D-10, D-43 | — | 11 | PT-18, PT-26, PT-30 |
| §6 | Stack tecnológico | 05-arquitectura §5.2 | — | 1 | Compilación en CI |
| §7 | 28 módulos | 15-plan-por-fases §asignación de módulos | varias | 2–11 | Se definen al planificar cada fase |
| §8 | Conectores | 07-conectores, D-45 | HU-09, HU-10, HU-24 | 3–4 | PT-05, PT-07, PT-22 |
| §9 | Agente de exploración | 08-agentes A.3, D-08 | — | 10 | PT-06, PT-07, PT-14 |
| §10 | Clasificación | 12-ia-local, classifier | HU-11, HU-12 | 4, 10 | PT-09 |
| §11 | Motor normativo | 13-evaluacion-normativa, D-05, D-06 | HU-14, HU-15, HU-16 | 5 | PT-10, PT-15 |
| §12 | Motor de evaluación | 13 §14.2 | HU-15 | 5 | PT-10, PT-11 |
| §13 | Riesgos | D-25 | HU-17 | 6 | PT-27 |
| §14 | Remediación | 06-modelo `RemediationAction` | HU-18, HU-19 | 8 | PT-28 |
| §15 | Centro de confianza | 09-seguridad §10.6, D-11, D-32 | HU-02, HU-03, HU-04 | 1–3, 11 | PT-02, PT-03, PT-04, PT-20 |
| §16 | Seguridad automatizada | 09-seguridad §10.7, D-24 | — | 1 | PT-17 |
| §17 | IAM | 09-seguridad §10.3, D-18 | HU-05 | 2 | PT-13 |
| §18 | Seguridad y privacidad de IA | 12-ia-local | HU-22, HU-23 | 10 | PT-14, PT-15 |
| §19 | Dashboards y reportes | A-08, D-19, D-45 | HU-20, HU-21 | 9 | PT-16, PT-23 |
| §20 | Gobernanza | 14-gobernanza, archivos raíz | HU-24, HU-25 | 0–1 | Revisión documental |
| §21 | Pruebas | 18-plan-de-pruebas | — | todas | — |
| §22 | Datos sintéticos | 18 §19.4 | — | 3 | PT-29 |
| §23 | Fases | 15-plan-por-fases | — | — | Puertas humanas |
| §24 | Criterios de aceptación | 15 §criterios transversales | — | todas | Lista de verificación QA |
| §25 | Costos | 20-recursos-y-costos | — | 0 | — |
| §26 | Documentación final | Fase 13 | — | 13 | Revisión documental |
| §27 | Validación previa | 03-revision-critica | — | 0 | Este documento |
| §28 | Entregables de inicio | 00-indice | — | 0 | Este documento |
| O-01…O-12 | Omisiones agregadas | 03 §3.3 | — | 2–7 | Por definir en cada fase |
