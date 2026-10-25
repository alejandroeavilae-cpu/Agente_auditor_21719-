# 16. Plan de desarrollo por fases

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

## Criterios de aceptación transversales (sección 24 + ajustes)

Los 12 criterios de la sección 24, más: WCAG 2.2 AA en pantallas nuevas (desde Fase 2), CI con ambos motores de BD (desde Fase 2), y prueba de valores centinela (desde Fase 3).

## Primer paso propuesto de la Fase 1 (requiere aprobación)

1. Estructura de monorepo y configuración TypeScript estricta.
2. Workflows de CI con escaneos y política de licencias.
3. Docker Compose perfil "local" con PostgreSQL y Valkey.
4. Paquete `audit-log` con verificación independiente por CLI.
5. Firma y SBOM de la primera imagen de prueba.
