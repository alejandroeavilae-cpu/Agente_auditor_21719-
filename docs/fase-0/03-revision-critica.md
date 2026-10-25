# 3. Revisión crítica de la especificación (sección 27)

Este documento cubre los 18 puntos de la sección 27. **No se afirma que la especificación sea exhaustiva** ni que el software resultante será invulnerable.

## 3.1 Contradicciones identificadas (punto 1)

| ID | Contradicción | Resolución |
|---|---|---|
| C-01 | La portada declara **SQL Server** como tecnología principal, pero los principios 1, 7 y 15 exigen gratuidad, software libre y accesibilidad para instituciones con pocos recursos. SQL Server es propietario y su edición gratuita (Express 2025) está limitada a 50 GB por base, sin backups cifrados ni TDE. [VERIFICADO, ver 02-factibilidad] | **D-03:** PostgreSQL por defecto; SQL Server como adaptador oficial para quien ya tenga licencias. |
| C-02 | La sección 15 declara el Centro de Confianza "obligatorio y prioritario", pero el plan lo ubica en la **Fase 11**, después de que el agente ya accede a sistemas (Fases 3–4). | **D-32:** registro de consultas, bitácora encadenada, firmas y SBOM se implementan desde las Fases 1–3; la Fase 11 consolida y agrega la verificación independiente completa. |
| C-03 | La sección 4 prohíbe seleccionar la licencia "sin aprobación del responsable"; el responsable delegó todas las decisiones el 25-10-2026. | Resuelta por delegación expresa; queda registrada (D-01) y es reversible sin costo mientras no haya contribuciones externas. |
| C-04 | "Solo lectura" (sección 9) choca con la realidad web: una aplicación puede modificar estado con una petición GET o al iniciar sesión (POST). | **D-08:** "solo lectura" se define operativamente: solo se permiten métodos GET y HEAD (lista permitida), salvo el inicio de sesión explícitamente autorizado; no se envían formularios; no se hace clic en controles cuyo texto o atributos indiquen acción destructiva; se documenta como **riesgo residual** que una aplicación mal diseñada mute estado con GET. |
| C-05 | "Funcionamiento sin Internet" (Modalidad A) frente a "verificar la vigencia de la norma" y a la verificación de firmas con registros de transparencia en línea. | Catálogo normativo y artefactos de verificación se distribuyen como **paquetes firmados descargables**; la verificación offline se prueba en Fase 1 [PENDIENTE]. La vigencia normativa la verifica el equipo del proyecto al publicar cada versión del catálogo, no cada instalación. |
| C-06 | "Priorizar metadatos y evitar leer registros personales" frente a la detección por "patrones" (que requiere leer valores). | **D-09:** muestreo de valores **desactivado por defecto**; si la organización lo activa: tamaño máximo de muestra, procesamiento en memoria y persistencia **solo de estadísticas agregadas**, nunca del valor ni de hashes por valor (un hash de un RUT se revierte por fuerza bruta por su baja entropía). Si se necesitara deduplicar, se usaría HMAC con clave por tenant guardada fuera de la base (R-25). |
| C-07 | La sección 12 permite el estado "No conforme", pero la sección 11 exige revisión humana para conclusiones jurídicas relevantes. | **D-06:** el motor emite "Requiere validación"; solo el rol Revisor jurídico de la organización fija "Conforme/No conforme" en obligaciones legales, y los controles del catálogo sin revisión jurídica del proyecto se muestran con advertencia. |
| C-08 | QA debe revisar cada fase (criterio 10), pero la Fase 12 concentra "QA y seguridad". | QA revisa cada fase (puerta de salida); la Fase 12 es la campaña integral y la revisión independiente externa. |
| C-09 | Modalidad B pide una "administración central con privilegios limitados", pero el módulo "Administración general" sugiere un superadministrador. | Se separa el rol **Operador de plataforma** (gestiona tenants, sin acceso a contenido) de los administradores de cada organización. El acceso de emergencia requiere aprobación del tenant y queda en su bitácora. |
| C-10 | "Proveedores de IA intercambiables" frente a "no enviar datos personales a modelos externos". | El núcleo solo admite endpoints de inferencia locales; un proveedor remoto requiere configuración explícita del administrador, aviso destacado y queda bloqueado por la lista de destinos de red por defecto. |
| C-11 | Principio 1.1-2 ("todo el código propio será público") frente a mantener el repositorio privado durante la Fase 1 (D-23). | Contradicción temporal aceptada: se publica al cerrar la Fase 1, una vez activos el escaneo de secretos y las políticas, para no exponer errores de configuración iniciales. |

## 3.2 Requisitos ambiguos (punto 2)

| ID | Ambigüedad | Propuesta |
|---|---|---|
| A-01 | ¿Qué constituye la "autorización explícita" de una auditoría? | Entidad `AuditAuthorization`: alcance (sistemas, conectores, operaciones), vigencia, firmante interno, documento adjunto. Sin autorización vigente el agente no se ejecuta. |
| A-02 | "Esfuerzo estimado" sin unidad. | Escala S/M/L/XL con equivalencia configurable por organización. |
| A-03 | "Volumen máximo de consultas" sin valor. | Valores por defecto conservadores por conector, configurables por autorización [ESTIMACIÓN — calibrar en pruebas de rendimiento]. |
| A-04 | "Autenticación adaptativa" sin señales definidas. | Solo señales mínimas (IP de origen, nuevo dispositivo vía cookie firmada, hora); sin huella digital del navegador. |
| A-05 | "Exportación e importación segura": ¿entre instancias, a otros sistemas, o respaldo? | Paquete firmado y cifrado entre instancias de la plataforma; exportes de reportes son otro módulo. |
| A-06 | Políticas de retención sin valores por defecto. | Cada tenant define su retención; la plataforma propone valores por defecto que deben confirmarse al configurar el tenant. |
| A-07 | "Revisión independiente cuando esté disponible": ¿quién? | Persona u organización sin participación en el desarrollo de la fase revisada; registrar identidad y alcance. |
| A-08 | "Cumplimiento por control" en dashboards: ¿sobre qué denominador? | Denominador = controles aplicables evaluados; se muestran aparte los "No evaluado" y "No aplicable" (sección 19 exige exponer denominadores). |
| A-09 | ¿Quién opera el "panel central" de la Modalidad C? | Cualquier entidad autohospedada; el proyecto no opera un panel central propio. |
| A-10 | "Información de menores de edad": la plataforma no puede saber la edad sin leer datos. | Detección por metadatos (campos de fecha de nacimiento, curso, apoderado) y contexto del sistema (p. ej. institución educativa), nunca por cálculo sobre registros salvo muestreo autorizado. |

## 3.3 Funcionalidades omitidas (punto 3)

| ID | Omisión | Propuesta |
|---|---|---|
| O-01 | La plataforma **también trata datos personales** (usuarios, evidencias, credenciales). No se especifica su propio cumplimiento. | Agregar: registro de actividades de tratamiento propio, aviso de privacidad modelo, plantilla de evaluación de impacto y procedimiento de derechos del titular para los usuarios de la plataforma. |
| O-02 | Modelo de prevención de infracciones y delegado de protección de datos (arts. 47–49 prevención y modelo de prevención; art. 50 atribuciones del delegado, según fuente secundaria). | Controles en el catálogo y campos en "Configuración institucional". [FUENTE SECUNDARIA — confirmar numeración en texto oficial] |
| O-03 | Flujo de **evaluación de impacto** (art. 15 ter) solo aparece como tema del catálogo. [VERIFICADO epígrafe] | Submódulo dentro de "Registro de actividades de tratamiento". |
| O-04 | Decisiones automatizadas y perfiles (art. 8° bis). [VERIFICADO epígrafe] | Categoría de hallazgo y pregunta de cuestionario. |
| O-05 | Diferenciación de estándares de cumplimiento (art. 14 septies). [VERIFICADO epígrafe] | El catálogo debe soportar aplicabilidad por tamaño y tipo de organización. |
| O-06 | Cadena de custodia de evidencias. | Hash SHA-256 de cada evidencia al ingresar, sellado en bitácora encadenada. |
| O-07 | Gestión de claves (rotación, respaldo, pérdida). | Procedimiento en el manual de seguridad; claves por tenant. |
| O-08 | Estándar de accesibilidad objetivo. | WCAG 2.2 nivel AA. [DECISIÓN D-16] |
| O-09 | Desinstalación con destrucción verificable de datos. | Procedimiento y acta de destrucción generada por la plataforma. |
| O-10 | Relación jurídica cuando un tercero opera la Modalidad B para otras organizaciones (actúa como encargado, art. 15 bis). [VERIFICADO epígrafe] | Plantilla de contrato de encargo y advertencia en la documentación de Modalidad B. |
| O-11 | Validación de identificadores chilenos (RUT, dígito verificador). | Regla determinística específica en el clasificador. |
| O-12 | Seguimiento de cambios normativos (proyectos de ley, reglamentos, criterios de la Agencia). | Proceso de mantenimiento del catálogo con responsable y periodicidad. |

## 3.4 Dependencias técnicas (punto 4)

Núcleo: Node.js LTS, TypeScript, NestJS, Prisma (adaptadores PostgreSQL y SQL Server), React, Vite, Valkey + BullMQ (colas), Playwright (exploración web y generación de PDF), Ollama (opcional), exceljs, lectores de PDF/DOCX. Herramientas: pnpm, Vitest, ESLint, Docker/Compose, Syft, Cosign, Gitleaks, Trivy, OSV-Scanner, Semgrep CE, OWASP ZAP. Detalle y licencias en `20-recursos-y-costos.md`. El inventario exacto con versiones fijadas se produce en la Fase 1.

## 3.5 Licencias (punto 5)

Ver `04-licencia.md`. Regla de compatibilidad [SUPUESTO — lista basada en conocimiento previo, a verificar en la política de licencias de la Fase 1]: toda dependencia empaquetada debe tener licencia compatible con AGPL-3.0 (MIT, BSD, Apache-2.0, ISC, MPL-2.0, LGPL, GPL-3.0). Se excluyen dependencias con licencias no libres o "source-available" (p. ej. BSL, SSPL) como requisito obligatorio.

## 3.6 – 3.8 Riesgos de seguridad, privacidad y legales (puntos 6–8)

- **Seguridad:** el activo crítico son las credenciales de sistemas auditados y el inventario de debilidades; los vectores principales son acceso cruzado entre tenants, compromiso del servidor central (Modalidad B), SSRF, parsers de archivos no confiables, contenido hostil en reportes y la cadena de suministro.
- **Privacidad:** la plataforma podría convertirse en un concentrador de datos personales que debía solo inventariar (fugas de valores a logs, capturas o hashes reversibles); además trata datos de sus propios usuarios.
- **Legales:** conclusiones jurídicas erróneas sin revisión, interpretación de reportes como certificación, uso sobre sistemas no autorizados e inexactitudes sobre una ley con vigencia en discusión.

Detalle y tratamiento:

Ver `17-matriz-de-riesgos.md` (registros R-01 a R-24) y `09-seguridad.md` (modelo de amenazas).

## 3.9 Compatibilidad tecnológica (punto 9)

| Combinación | Estado |
|---|---|
| Prisma + SQL Server | Soportado vía `@prisma/adapter-mssql` [VERIFICADO] |
| Prisma + PostgreSQL | Soportado [SUPUESTO — conocimiento previo] |
| Node.js 24 LTS | Fin de vida 30-04-2028; Node.js 26 pasa a LTS en octubre de 2026 [FUENTE SECUNDARIA]. D-14: iniciar con 24 y evaluar 26 al arrancar la Fase 1. |
| Ollama en contenedor sin GPU | Funciona en CPU con menor rendimiento [ESTIMACIÓN — medir en Fase 10] |

## 3.10 Viabilidad offline (punto 10)

Viable. Requisitos: registro de imágenes exportado (`docker save`), modelos de IA empaquetados, catálogo normativo como archivo firmado, documentación incluida, sin dependencias de CDN en el frontend, sin telemetría (D-30). Riesgo: la verificación Sigstore offline debe probarse [PENDIENTE].

## 3.11 Viabilidad multiempresa (punto 11)

Viable con base de datos por tenant (D-04). Ver `11-multiempresa.md`. Costo: más bases de datos que mantener; mitigado con automatización de migraciones por tenant.

## 3.12 Sostenibilidad comunitaria (punto 12)

Riesgo alto: un único mantenedor. Ver `14-gobernanza.md` y P-03.

## 3.13 – 3.14 Trazabilidad y casos de prueba (puntos 13–14)

Ver `19-matriz-de-trazabilidad.md` y `18-plan-de-pruebas.md`.

## 3.15 Decisiones que requieren aprobación humana (punto 15)

Ver `21-decisiones.md` §3 (pendientes que no pueden delegarse a un sistema de IA).

## 3.16 Correcciones y mejoras propuestas (punto 16)

1. Cambiar la portada: "SQL Server" → "PostgreSQL (por defecto) y SQL Server".
2. Agregar los módulos omitidos O-01 a O-12.
3. Reordenar el Centro de Confianza (C-02).
4. Definir operativamente "solo lectura" (C-04) y "autorización de auditoría" (A-01).
5. Agregar el estado de control **"Pendiente de revisión jurídica"** como atributo del control (no como resultado de evaluación).
6. Definir un MVP publicable al cierre de la Fase 9.
7. Agregar como criterio de aceptación transversal: WCAG 2.2 AA en frontend.

## 3.17 Supuestos registrados (punto 17)

| ID | Supuesto |
|---|---|
| S-01 | Las organizaciones usuarias pueden crear cuentas de solo lectura en sus bases de datos. |
| S-02 | Existe al menos un servidor Linux con Docker disponible en cada institución que instale la Modalidad A. |
| S-03 | El responsable del proyecto conseguirá revisión jurídica pro bono o institucional del catálogo. |
| S-04 | El texto oficial de la ley publicado el 13-12-2024 es la base; las modificaciones posteriores se incorporarán como nuevas versiones del catálogo. |
| S-05 | GitHub seguirá ofreciendo Actions gratuito para repositorios públicos; si cambia, el CI debe poder migrar a Forgejo/Woodpecker. |
| S-07 | CodeQL es gratuito para repositorios públicos; en el repositorio privado actual podría no estar disponible. |
| S-06 | Los usuarios finales son profesionales (TI, cumplimiento, auditoría), no titulares de datos. |

## 3.18 Controles imposibles de verificar automáticamente (punto 18)

La plataforma **no puede** verificar por sí sola y siempre marcará estos controles como "Requiere validación" con evidencia aportada por personas:

- Existencia y validez de la base de licitud (consentimiento válido, interés legítimo, mandato legal) de cada tratamiento.
- Adecuación de la finalidad y proporcionalidad de los datos respecto de esa finalidad.
- Justificación del plazo de conservación.
- Veracidad y aplicación real de políticas, avisos de privacidad y procedimientos documentados.
- Existencia y contenido de contratos con encargados y cesionarios.
- Adecuación de países de destino en transferencias internacionales.
- Designación efectiva y funciones reales del delegado de protección de datos.
- Capacitación del personal, deber de confidencialidad y seguridad física.
- Efectividad real del procedimiento de respuesta a incidentes y de notificación de vulneraciones.
- Respuesta efectiva a solicitudes de titulares dentro de los plazos legales.
- Permisos de acceso en sistemas que el conector no puede observar.
