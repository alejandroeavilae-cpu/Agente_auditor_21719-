# 16. Plan de desarrollo por fases

> **Ajuste por D-74 (28-10-2026):** la v1 se concentra en la **Modalidad A**: una institución, con instalación local. Las Modalidades B (multiempresa) y C (híbrida) se postergan.
> - **Fase 2:** se mantiene el aislamiento por organización ya construido. El "operador de plataforma" corresponde al administrador técnico de la propia institución.
> - **Fase 3:** el egress-gateway se mantiene, porque protege la red de la institución.
> - **Fase 11:** el paquete offline se mantiene.
> - **Fuera de la v1:** el panel central y el agente remoto de la Modalidad C; sin fase asignada.
> - **Corrección automática:** fuera de la v1 (D-72).

Estado: **Diseñado**. Se mantienen las 15 fases de la especificación con los ajustes de la revisión crítica. **Cada fase termina en una puerta de aprobación humana**; ningún agente avanza a la siguiente fase sin ella.

Tamaño relativo: S < M < L < XL. **No se dan duraciones en semanas**: dependen del número de personas disponibles, aún desconocido. [ESTIMACIÓN relativa]

| Fase | Contenido (con ajustes) | Tamaño | Salida verificable | Puerta adicional |
|---|---|---|---|---|
| 0 | Análisis y arquitectura | M | Este conjunto de documentos | Aprobación del responsable |
| 1 | Monorepo, CI/CD, Gitleaks/Semgrep/OSV/Trivy, SBOM, firma Cosign, Docker Compose base, **bitácora encadenada** (adelantada), política de licencias de dependencias, verificación de firmas offline | L | Pipeline verde, imagen firmada, SBOM publicado | Repo pasa a público (D-23) |
| 2 | Identidad (argon2id, MFA TOTP, sesiones, RBAC), tenants con BD por tenant, operador de plataforma, pruebas de aislamiento, datos propios de la plataforma (O-01) | XL | Suite de aislamiento 100 % en verde en PostgreSQL y SQL Server | Revisión de seguridad |
| 3 | Registro de sistemas, credenciales cifradas, autorizaciones de auditoría, egress-gateway, **registro de consultas** (adelantado), conectores PostgreSQL, SQL Server, MySQL, CSV, Excel, REST | XL | Conectores probados contra BD sintéticas; prueba de valores centinela | Revisión de seguridad |
| 4 | Inventario, clasificador determinístico (incl. RUT), evidencias con hash, conectores PDF y DOCX | L | Métricas del clasificador sobre conjunto sintético etiquetado | — |
| 5 | Catálogo normativo v0.1 (esquema, validador, firma), motor de evaluación, aplicabilidad | L | Catálogo publicado **con todos los controles en revisión pendiente** | **Revisión jurídica humana** antes de marcar cualquier control como revisado |
| 6 | Metodología de riesgo configurable, recomendaciones | M | Cálculos probados unitariamente | — |
| 7 | Flujo de auditoría completo, estados, aprobaciones, RAT y evaluación de impacto (O-03) | L | Prueba E2E de auditoría completa | — |
| 8 | Remediación, responsables, alertas, reevaluación | M | Prueba E2E de cierre de hallazgo | — |
| 9 | Dashboards con denominadores explícitos, reportes PDF/Excel/CSV | L | Reportes generados desde datos sintéticos | **Hito MVP publicable** |
| 10 | IA local (opcional), banco de pruebas de modelos, agente de exploración web | XL | Informe de métricas IA; pruebas de prompt injection | Revisión de seguridad |
| 11 | Centro de confianza completo: guía de verificación independiente, controles institucionales, paquete offline | L | Verificación independiente ejecutada por un tercero | — |
| 12 | QA integral y revisión de seguridad independiente | L | Informe de pruebas con evidencia | Revisión independiente |
| 13 | Publicación: 24 manuales, licencias de terceros, versión 1.0 firmada | L | Release firmada | ≥ 2 mantenedores (P-03) |
| 14 | Piloto institucional controlado | L | Informe del piloto | Institución piloto (P-04) |

## Asignación de los 28 módulos (sección 7) a fases

| Módulo | Fase | Módulo | Fase |
|---|---|---|---|
| 1. Administración general | 2 | 15. Hallazgos | 7 |
| 2. Organizaciones y tenants | 2 | 16. Recomendaciones | 6 |
| 3. Usuarios, roles y permisos | 2 | 17. Planes correctivos | 8 |
| 4. Registro de sistemas auditables | 3 | 18. Seguimiento de compromisos | 8 |
| 5. Conectores | 3–4, 10 | 19. Dashboards | 9 |
| 6. Gestión de credenciales | 3 | 20. Reportes | 9 |
| 7. Descubrimiento de datos | 4 | 21. Orquestación de agentes | 3, 10 |
| 8. Clasificación | 4, 10 | 22. Seguridad y trazabilidad | 1–3 |
| 9. Inventario de activos | 4 | 23. Centro de confianza | 1–3, 11 |
| 10. Registro de actividades de tratamiento | 7 | 24. Administración de normativa | 5 |
| 11. Evaluación normativa | 5 | 25. Actualizaciones verificables | 1, 11 |
| 12. Evaluación de riesgos | 6 | 26. Gestión de incidentes | 8 |
| 13. Gestión de evidencias | 4 | 27. Configuración institucional | 2 |
| 14. Auditorías | 7 | 28. Exportación e importación segura | 11 |

Documentos de gobernanza aún no escritos y asignados a la Fase 1: guía de revisión de código, política de soporte detallada, política de versiones detallada, inventario de licencias de terceros.

## Criterios de aceptación transversales (sección 24 + ajustes)

Los 12 criterios de la sección 24, más: WCAG 2.2 AA en pantallas nuevas (desde Fase 2), CI con ambos motores de BD (desde Fase 2), y prueba de valores centinela (desde Fase 3).

## Estado de las fases

| Fase | Estado |
|---|---|
| 0 | Aprobada (25-10-2026) |
| 1 | Aprobada y cerrada (26-10-2026, PR #1) |
| 2 | Aprobada 26-10-2026, en 3 entregas: 2A aprobada y cerrada (29-10-2026, PR #3); 2B en curso (aprobada 29-10-2026); 2C no iniciada |

## Primer paso de la Fase 1 (ejecutado)

1. Estructura de monorepo y configuración TypeScript estricta.
2. Workflows de CI con escaneos y política de licencias.
3. Docker Compose perfil "local" con PostgreSQL y Valkey.
4. Paquete `audit-log` con verificación independiente por CLI.
5. Firma y SBOM de la primera imagen de prueba.
