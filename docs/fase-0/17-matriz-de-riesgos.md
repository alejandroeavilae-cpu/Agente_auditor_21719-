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
| R-33 | Seg | Compromiso de la API en la Modalidad A. **Desde 2C-1 (D-87/D-88):** el atacante obtiene la contraseña de la base de *su* organización y su DEK; puede leer y modificar los datos de esa organización, crear administradores y anexar (no modificar) entradas en su bitácora. Sin clave maestra, sin `auditor_api` y sin acceso a la base de control (verificado QA 2C-1) | 2 | 4 | 8 | Una sola organización (D-84); API sin clave maestra (D-87/D-88); `rotate-password` y la suspensión cierran las conexiones abiertas; bitácoras solo-anexar con anclajes externos; contenedor de solo lectura y sin privilegios. Valores reevaluados por QA 2C-1 `[ESTIMACIÓN]` (antes 2·5=10) | DevOps/Backend |
| R-34 | Seg | Bloqueo de inicio de sesión por terceros. **Desde 2C-1 (D-88):** el bloqueo de contraseña es por cuenta + origen, y quien no conoce la contraseña solo bloquea su propio origen. Residual: origen compartido (NAT o proxy institucional) y configuración errónea de `TRUST_PROXY` | 2 | 3 | 6 | Aceptado por el responsable el 29-10-2026 (D-83). Mitigado en 2C-1: bloqueo por cuenta + origen, alerta `account.attack_suspected`, límite por IP, desbloqueo por API y CLI, documentación de `TRUST_PROXY`. Valores reevaluados por QA 2C-1 `[ESTIMACIÓN]` (antes 3·3=9) | Backend |
| R-38 | Seg | Con la contraseña comprometida, un tercero puede mantener bloqueada la MFA de la cuenta (D-89) con unos 4 códigos por hora, cada uno con su inicio de sesión | 2 | 3 | 6 | Desbloqueo por API o CLI **más cambio de contraseña** (verificado por QA, R2-05); evento en la bitácora una vez por hora. **2C-2 (implementado y probado en PostgreSQL local; `[PENDIENTE: CI en ambos motores, QA y aprobación]`):** `GET /users` informa el bloqueo de MFA y `passwordCompromiseSuspected`; desbloquear o restablecer la MFA tras un bloqueo de MFA marca `must_change_password` y, tras la siguiente verificación MFA, la sesión solo permite cambiar la contraseña (distinta de la actual) (`docs/fase-2/2c2-registro.md` §1). Valores `[ESTIMACIÓN]` de QA | Backend |
| R-35 | Seg | Instalación institucional configurada sin HTTPS (`COOKIE_SECURE=false` fuera del perfil local de un solo equipo): contraseñas y cookies de sesión viajan sin cifrar por la red interna | 2 | 4 | 8 | D-81 reconfirmada (opción A, 29-10-2026): la configuración queda a criterio de quien instala. Mitigación solo documental: la guía de instalación de 2C advierte que fuera de `127.0.0.1` se debe usar HTTPS. Valores P/I/Sev `[ESTIMACIÓN]`. Alternativa no elegida: impedir el arranque en ese caso | DevOps |
| R-36 | Seg | La consola del operador (2C-3) es el objetivo de mayor valor: tiene la clave maestra y la cuenta de aprovisionamiento | 2 | 5 | 10 | D-85 y D-88: servicio separado; lista de IP permitidas (vacía por defecto: solo el propio servidor) aplicada en Caddy y en el servicio; MFA y código en cada acción crítica; sesión de 15 min / 4 h; bitácora con el nombre del operador; sin acceso al contenido de la organización. Valores P/I/Sev `[ESTIMACIÓN]` | DevOps/Backend |
| R-37 | Cal | Accesibilidad declarada sin revisión manual suficiente (las herramientas automáticas detectan solo una parte de los problemas) | 3 | 3 | 9 | D-88: axe-core en CI más revisión manual de QA con teclado y lector de pantalla, registrada con su alcance; nunca se declara "certificado WCAG". Valores P/I/Sev `[ESTIMACIÓN]` | QA/Frontend |

**Riesgos más altos (≥ 15):** R-01, R-15, R-09. Los dos primeros no son técnicos y dependen de decisiones humanas pendientes.
