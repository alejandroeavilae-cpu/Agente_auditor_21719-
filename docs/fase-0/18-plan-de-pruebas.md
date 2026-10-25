# 19. Plan de pruebas

Estado: **Diseñado**. Ningún resultado de prueba existe aún; **no se informa ningún resultado** (sección 21: no inventar resultados).

## 19.1 Niveles y herramientas

| Tipo (sección 21) | Herramienta | Desde fase | Entorno |
|---|---|---|---|
| Unitarias | Vitest | 1 | CI |
| Integración (BD, colas, conectores) | Vitest + Testcontainers (PostgreSQL, SQL Server, MySQL, Valkey) | 2 | CI |
| Funcionales E2E | Playwright Test | 7 | Compose efímero |
| Seguridad | Pruebas propias (authz, aislamiento, SSRF, XSS, CSRF), Semgrep, ZAP baseline, Gitleaks | 2 | CI |
| Multiempresa | Suite de aislamiento (11-multiempresa §12.4) | 2 | CI, ambos motores |
| IA | Banco de pruebas sobre datos sintéticos etiquetados | 10 | CI (modelo pequeño) + manual |
| Resiliencia | Caída de BD, reinicio de worker, cancelación, corte de red del agente | 3 | Compose efímero |
| Rendimiento | k6 (o equivalente libre) + medición de carga sobre BD auditada | 9 | Entorno dedicado |
| Instalación | Instalación limpia, actualización, offline, desinstalación con acta | 1 (básica), 11 (completa) | VM limpia |
| Cadena de suministro | Verificación de firmas, SBOM, OSV/Trivy, intento de reproducción de build | 1 | CI |

## 19.2 Registro obligatorio por prueba

Objetivo · caso · datos utilizados · resultado esperado · resultado obtenido · evidencia (salida del comando, artefacto) · fecha · versión (commit) · estado. Los resultados se generan automáticamente desde CI en formato JUnit/JSON y se archivan como artefactos de la versión.

## 19.3 Casos de prueba derivados de requisitos (selección; el total se mantiene en la matriz de trazabilidad)

| ID | Requisito | Caso | Resultado esperado |
|---|---|---|---|
| PT-01 | §5 A offline | Instalar con red saliente bloqueada | Instalación y uso completos sin errores de red |
| PT-02 | §15.1 | Verificar firma de imagen con Cosign usando el material offline | Verificación exitosa; imagen alterada → falla |
| PT-03 | §15.2 registro | Ejecutar auditoría; comparar consultas en log del motor auditado vs `QueryLogEntry` | Coincidencia 1:1 |
| PT-04 | Bitácora | Alterar un registro de la bitácora en la BD | La CLI de verificación detecta la ruptura de la cadena |
| PT-05 | §9 solo lectura | Cuenta de BD con permisos de escritura | Preflight detiene y genera hallazgo |
| PT-06 | §9 web | Página con botón "Eliminar" y formulario POST | No se hace clic ni se envía; registro de bloqueo |
| PT-07 | §9 SSRF | Configurar destino `169.254.169.254` o redirección a host no autorizado | Rechazado y registrado |
| PT-08 | §10 minimización | Valores centinela en BD sintética; muestreo desactivado | Ningún centinela en BD de plataforma, logs, evidencias, reportes |
| PT-09 | §10 RUT | Columnas con RUT válidos, inválidos y nombres engañosos | Clasificación según reglas; métricas registradas |
| PT-10 | §12 | Control legal pendiente de revisión con indicio de incumplimiento | Resultado = "Requiere validación" (no "No conforme") |
| PT-11 | §12 | Sistema sin hallazgos | Ningún control queda "Conforme" sin evidencia validada |
| PT-12 | §5 B | Usuario tenant A solicita recursos tenant B en todos los endpoints | 403/404 en todos |
| PT-13 | §17 | Acceso a acción de alto riesgo sin reautenticación MFA | Rechazado |
| PT-14 | §18 prompt injection | Etiqueta de campo con instrucciones maliciosas | Salida de IA validada o descartada; ninguna acción adicional |
| PT-15 | §18 | Respuesta de IA con artículo inexistente | Respuesta invalidada |
| PT-16 | §19 | Dashboard con controles "No evaluado" | Denominador y exclusiones visibles |
| PT-17 | §16 | Dependencia con vulnerabilidad alta con corrección | Pipeline de publicación bloqueado |
| PT-18 | §5 C | Agente con política por defecto | Ningún dato sale; registro de transmisiones vacío |
| PT-19 | §14 | IA solicita ejecutar cambio en sistema auditado | No existe camino de código; prueba de arquitectura (sin cliente de escritura en el agente) |
| PT-20 | §21 resiliencia | Cancelar ejecución en curso | Se detiene, estado "cancelled", cobertura parcial documentada |
| PT-21 | D-31 | Reescribir toda la cadena de la bitácora en la BD | La verificación contra el último anclaje externo detecta la alteración |
| PT-22 | D-45 | Ingerir bomba zip (.xlsx/.docx), XML con entidad externa y PDF malformado | Límites cortan el proceso; sin lectura de archivos locales ni red; error registrado |
| PT-23 | D-45 | Nombre de campo con `<script>` y valor CSV que empieza con `=` | Reporte PDF sin ejecución ni peticiones de red; celda exportada neutralizada |
| PT-24 | §1.1-12 | Iniciar ejecución sin autorización vigente o con autorización vencida | Rechazo y registro en bitácora |
| PT-25 | C-10 | Configurar proveedor de IA remoto sin habilitación explícita | Bloqueado por la lista de destinos; aviso al administrador |
| PT-26 | §5-C | Revocar certificado del agente y ejecutar desconexión permanente | Envíos rechazados; credenciales y configuración del destino eliminadas |
| PT-27 | §13 | Cálculo de riesgo inherente/residual con matriz configurada | Valores según tabla de prueba; sin traducción a montos |
| PT-28 | §14 | Cerrar acción correctiva sin evidencia de cierre | Rechazado |
| PT-29 | §22 | Regenerar datos sintéticos con la misma semilla | Salida idéntica (hash); sin datos reales |
| PT-30 | D-43 | Intentar obtener credenciales de un sistema desde la plataforma central (Modalidad B) | No existen en el centro; solo referencia opaca |

Esta lista es una **selección inicial**: el conjunto completo de casos por módulo se escribe al planificar cada fase, antes de implementar, y se incorpora a la matriz de trazabilidad.

## 19.4 Datos sintéticos (sección 22)

Cinco sistemas ficticios (municipalidad, empresa privada, institución educativa, organización financiera, organización de salud) generados con scripts reproducibles y semilla fija. Cada uno incluye escenarios positivos y negativos: datos bien protegidos, permisos excesivos, datos innecesarios, ausencia de políticas, conservación no justificada, controles correctos, casos ambiguos, datos distribuidos, datos sensibles, evidencia insuficiente. Nunca se usan datos reales. Advertencia: un RUT generado con dígito verificador válido **puede coincidir numéricamente con el de una persona real**; por eso los RUT sintéticos nunca se combinan con nombres u otros datos reales, y el generador documenta este riesgo residual.
