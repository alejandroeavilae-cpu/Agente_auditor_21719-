# 18. Matriz de riesgos del proyecto

Escala cualitativa 1–5 para probabilidad (P) e impacto (I); severidad = P × I. Valores **[ESTIMACIÓN]** del equipo de análisis, a revisar en cada puerta de fase. Categorías: Seg (seguridad), Priv (privacidad), Leg (legal), Tec (técnico), Org (organizacional).

| ID | Cat. | Riesgo | P | I | Sev. | Tratamiento | Dueño |
|---|---|---|---|---|---|---|---|
| R-01 | Leg | Sin revisión jurídica, el catálogo induce conclusiones legales erróneas | 4 | 5 | 20 | D-06: sin revisión no hay "No conforme/Conforme" legal; P-01 | Responsable |
| R-02 | Leg | Cambio de fecha de vigencia (boletín 18.623-07) o reglamentos alteran reglas | 4 | 3 | 12 | D-05: vigencia parametrizada; seguimiento normativo | Mant. catálogo |
| R-03 | Seg | Robo de credenciales de sistemas auditados almacenadas en la plataforma | 2 | 5 | 10 | Cifrado de sobre, MFA, mínimo privilegio, preflight | Backend/DevOps |
| R-04 | Seg | Acceso cruzado entre tenants | 2 | 5 | 10 | D-04 + suite de aislamiento obligatoria | Backend/QA |
| R-05 | Seg | Agente web provoca cambios en un sistema auditado | 3 | 4 | 12 | D-08; riesgo residual comunicado; recomendar ambientes de prueba | Backend |
| R-06 | Seg | Prompt injection manipula la clasificación | 3 | 3 | 9 | IA sin herramientas, salida validada, validación humana | Backend/QA |
| R-07 | Seg | Dependencia comprometida (cadena de suministro) | 3 | 4 | 12 | Lockfiles, escaneos, SBOM, revisión de dependencias, firmas | DevOps |
| R-08 | Seg | SSRF a través de conectores | 2 | 4 | 8 | Lista de destinos + egress-gateway | Backend |
| R-09 | Priv | Valores personales terminan en logs, evidencias o reportes | 3 | 5 | 15 | D-09; pruebas de valores centinela; enmascaramiento | QA |
| R-10 | Priv | La plataforma incumple obligaciones sobre sus propios datos | 3 | 3 | 9 | O-01: RAT propio, avisos, derechos | Responsable |
| R-11 | Leg | La organización interpreta los reportes como certificación de cumplimiento | 3 | 4 | 12 | Avisos en reportes; distinción de estados; sin lenguaje de certificación | Frontend |
| R-12 | Leg | Uso de la herramienta sobre sistemas sin autorización | 2 | 5 | 10 | Autorización obligatoria y sellada; avisos legales | Responsable |
| R-13 | Tec | Diferencias PostgreSQL/SQL Server producen errores en uno de los motores | 3 | 3 | 9 | CI con ambos motores desde Fase 2 | DevOps |
| R-14 | Tec | Rendimiento insuficiente de IA en CPU | 4 | 2 | 8 | IA opcional; reglas independientes | Backend |
| R-15 | Org | Único mantenedor: abandono o sobrecarga | 4 | 5 | 20 | P-03; documentación; alojamiento institucional (P-02) | Responsable |
| R-16 | Org | Alcance excesivo retrasa una versión útil | 4 | 3 | 12 | MVP en Fase 9 | Orquestador |
| R-17 | Tec | Verificación de firmas no funciona offline | 3 | 3 | 9 | Prueba temprana en Fase 1 | DevOps |
| R-18 | Seg | Operador de Modalidad B accede a datos de un tenant | 2 | 4 | 8 | C-09: rol sin acceso + break-glass registrado | Backend |
| R-19 | Org | Baja adopción empresarial por AGPL | 3 | 2 | 6 | Aceptado (D-01) | Responsable |
| R-20 | Tec | Cambios de licencia o costo en herramientas de CI (p. ej. GitHub Actions) | 2 | 3 | 6 | S-05; CI portable | DevOps |
| R-21 | Priv | Capturas de pantalla del agente web contienen datos personales | 3 | 4 | 12 | Enmascaramiento antes de guardar; capturas opcionales | Backend |
| R-22 | Seg | Sobrecarga de sistemas productivos por consultas del agente | 2 | 4 | 8 | Límites, ventanas horarias, un trabajo por sistema | Backend |
| R-23 | Leg | Afirmaciones del proyecto sobre la ley resultan inexactas | 3 | 4 | 12 | Etiquetas epistémicas; fuentes citadas; revisión jurídica | Responsable |
| R-24 | Tec | Pérdida de la clave maestra impide recuperar datos | 2 | 5 | 10 | Procedimiento de respaldo de claves (O-07) | DevOps |

**Riesgos más altos (≥ 15):** R-01, R-15, R-09. Los dos primeros no son técnicos y dependen de decisiones humanas pendientes.
