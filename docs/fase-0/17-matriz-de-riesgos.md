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
| R-18 | Seg | Operador de Modalidad B accede a datos de un tenant (quien controla el host y la clave maestra puede leer todo: el control es lógico, no técnico) | 3 | 4 | 12 | C-09: rol sin acceso + break-glass registrado; **riesgo residual explícito** comunicado a los tenants; D-43 deja fuera las credenciales | Backend |
| R-19 | Org | Baja adopción empresarial por AGPL | 3 | 2 | 6 | Aceptado (D-01) | Responsable |
| R-20 | Tec | Cambios de licencia o costo en herramientas de CI (p. ej. GitHub Actions) | 2 | 3 | 6 | S-05; CI portable | DevOps |
| R-21 | Priv | Capturas de pantalla del agente web contienen datos personales | 3 | 4 | 12 | Enmascaramiento antes de guardar; capturas opcionales | Backend |
| R-22 | Seg | Sobrecarga de sistemas productivos por consultas del agente | 2 | 4 | 8 | Límites, ventanas horarias, un trabajo por sistema | Backend |
| R-23 | Leg | Afirmaciones del proyecto sobre la ley resultan inexactas | 3 | 4 | 12 | Etiquetas epistémicas; fuentes citadas; revisión jurídica | Responsable |
| R-24 | Tec | Pérdida de la clave maestra impide recuperar datos | 2 | 5 | 10 | Procedimiento de respaldo de claves (O-07) | DevOps |
| R-25 | Priv | Hashes de valores de baja entropía (p. ej. RUT) revertidos por fuerza bruta | 3 | 4 | 12 | D-09: solo estadísticas agregadas; HMAC con clave fuera de la BD si se deduplica | Backend |
| R-26 | Seg | Quien controla la BD reescribe la bitácora completa y la cadena sigue siendo válida | 2 | 5 | 10 | D-31: anclaje externo periódico firmado; PT-21 | Backend/DevOps |
| R-27 | Seg | Compromiso de la API o del worker central en Modalidad B expone a todos los tenants | 2 | 5 | 10 | D-43 (credenciales fuera del centro), DEK por tenant, opción de worker por tenant a evaluar en Fase 2, endurecimiento del host | DevOps |
| R-28 | Seg | Archivos maliciosos (bomba zip, XXE, exploits de parsers) | 3 | 4 | 12 | D-45: parseo aislado con límites; PT-22 | Backend |
| R-29 | Seg | Contenido hostil de sistemas auditados en reportes (XSS/SSRF en el renderizador, inyección de fórmulas CSV) | 3 | 3 | 9 | D-45: renderizado sin red, escape, neutralización; PT-23 | Backend/Frontend |
| R-30 | Seg | Credenciales del agente web con privilegios excesivos o con MFA personal en la aplicación auditada | 3 | 4 | 12 | D-46: cuentas dedicadas de mínimo privilegio | Responsable institucional |
| R-31 | Seg | El usuario de una organización cambia su propia contraseña o parámetros de sesión y deja a la plataforma sin acceso a esa base | 2 | 3 | 6 | D-68: `tenant check` lo detecta, `tenant rotate-password` lo corrige; `search_path` fijado en cada conexión | Backend |
| R-32 | Priv | El usuario de una organización ve el catálogo del motor (nombres de bases y roles) | 3 | 2 | 6 | D-66: nombres opacos aleatorios; en SQL Server `DENY VIEW ANY DATABASE` | Backend/DevOps |
| R-33 | Seg | Compromiso de la API en la Modalidad A: con la clave maestra y las credenciales de cada organización, el atacante puede leer datos, crear administradores y agregar entradas a las bitácoras de todas las organizaciones (D-80) | 2 | 5 | 10 | Cuenta `auditor_api` solo de lectura del registro; la API no tiene la cuenta de aprovisionamiento; las bitácoras son solo-anexar y se verifican con anclajes externos; contenedor de solo lectura y sin privilegios. [PENDIENTE: proceso de descifrado separado (2C)] **Mitigación decidida (D-84 y D-87, 29-10-2026):** una sola organización por instalación y, desde 2C, API sin clave maestra; el alcance queda limitado a la propia institución. [PENDIENTE: implementar y verificar en 2C] | DevOps/Backend |
| R-34 | Seg | Denegación de servicio por bloqueo de cuentas: quien conoce la organización y el correo de una persona puede mantener su cuenta bloqueada con un intento por ventana | 3 | 3 | 9 | D-83: los intentos durante un bloqueo no cuentan; desbloqueo por administrador (API) o por operador (CLI); los bloqueos quedan en la bitácora; límite por IP. [PENDIENTE: bloqueo por cuenta e IP o por dispositivo (2C)] **Aceptado por el responsable el 29-10-2026 22:44 (D-83, opción A)**, con mitigación de fondo al inicio de 2C | Backend |
| R-35 | Seg | Instalación institucional configurada sin HTTPS (`COOKIE_SECURE=false` fuera del perfil local de un solo equipo): contraseñas y cookies de sesión viajan sin cifrar por la red interna | 2 | 4 | 8 | D-81 reconfirmada (opción A, 29-10-2026): la configuración queda a criterio de quien instala. Mitigación solo documental: la guía de instalación de 2C advierte que fuera de `127.0.0.1` se debe usar HTTPS. Valores P/I/Sev `[ESTIMACIÓN]`. Alternativa no elegida: impedir el arranque en ese caso | DevOps |

**Riesgos más altos (≥ 15):** R-01, R-15, R-09. Los dos primeros no son técnicos y dependen de decisiones humanas pendientes.
