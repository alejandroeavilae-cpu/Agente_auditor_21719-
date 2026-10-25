# 10. Arquitectura de seguridad

Estado: **Diseñado**. Ninguna afirmación de este documento implica que el software sea invulnerable.

## 10.1 Activos a proteger

1. Credenciales de los sistemas auditados (el activo más sensible: dan acceso a datos personales de terceros).
2. Inventario de datos personales y hallazgos (revelan dónde están los datos sensibles de una organización y sus debilidades).
3. Evidencias.
4. Cuentas de usuarios de la plataforma.
5. Integridad del propio software y del catálogo normativo.
6. Bitácora de auditoría.

## 10.2 Modelo de amenazas (STRIDE resumido)

| Amenaza | Ejemplo | Control principal |
|---|---|---|
| Suplantación | Robo de sesión de un responsable de auditoría | MFA TOTP obligatorio para roles con privilegios; sesiones con cookie `HttpOnly`, `Secure`, `SameSite=Strict`; rotación de sesión al autenticarse |
| Manipulación | Alterar hallazgos o la bitácora | Bitácora encadenada por hash (D-31) con anclaje externo periódico del último hash firmado; la cadena por sí sola **no** protege contra quien reescribe toda la BD (R-26) |
| Repudio | Negar haber autorizado una auditoría | Autorización sellada en bitácora con identidad, fecha y hash del documento |
| Divulgación | Exfiltración de credenciales o inventario | Cifrado de sobre por tenant (D-12), aislamiento por BD (D-04), minimización (D-09), sin telemetría |
| Denegación de servicio | Agente sobrecarga un sistema productivo | Límites duros por conector, un trabajo por sistema, ventanas horarias configurables |
| Elevación de privilegios | Usuario de un tenant accede a otro | BD separadas, verificación de tenant en cada petición, pruebas automatizadas de acceso cruzado |
| SSRF | Conector usado para alcanzar servicios internos no autorizados | Lista de destinos, egress-gateway, rechazo de redirecciones, bloqueo de direcciones de metadatos de nube y loopback |
| Prompt injection | Texto en una aplicación auditada instruye a la IA | IA sin herramientas ni red; salida JSON validada; la IA solo sugiere |
| Cadena de suministro | Dependencia comprometida | Lockfile, versiones fijadas, OSV-Scanner, Trivy, revisión de nuevas dependencias, SBOM, firmas |
| Insider (operador Modalidad B) | Operador lee datos de un tenant | Rol de operador sin acceso a contenido; break-glass con aprobación del tenant |

## 10.3 Gestión de identidad y acceso (sección 17)

- Contraseñas con **argon2id**; política de longitud mínima y comprobación contra lista de contraseñas comunes empaquetada (sin consulta externa).
- **MFA TOTP** obligatorio para Administrador, Responsable de auditoría y Revisor jurídico; opcional para el resto. WebAuthn como mejora posterior (D-18).
- **OIDC opcional** para instituciones con proveedor de identidad propio; no se empaqueta un proveedor de identidad (D-18).
- **RBAC + condiciones** (p. ej. "solo hallazgos asignados a mí").
- **Separación de funciones**: quien crea una autorización de alcance amplio no puede aprobarla.
- **Acciones de alto riesgo** (revelar ruta de evidencia, ampliar alcance, desactivar límites, exportar tenant) requieren reautenticación con MFA.
- Bloqueo progresivo tras intentos fallidos y registro de accesos.
- **Autenticación adaptativa mínima** (A-04): solo nuevo dispositivo e IP; sin huella digital del navegador.

## 10.4 Protección de la API y del frontend

- Validación de toda entrada con zod; rechazo de campos no declarados.
- Protección CSRF (cookie `SameSite=Strict` + token para métodos con efecto).
- Cabeceras: CSP estricta sin `unsafe-inline`, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`.
- Límite de tasa por usuario e IP.
- Errores sin trazas internas hacia el cliente.
- Escape por defecto de React; prohibido `dangerouslySetInnerHTML` salvo componente revisado.

## 10.5 Gestión de secretos y claves (D-12)

- Clave maestra de instalación en archivo montado de solo lectura (`/run/secrets/...`).
- Por tenant: clave de datos (DEK) cifrada con la clave maestra; credenciales y evidencias cifradas con AES-256-GCM.
- Rotación de claves con versión (`keyVersion`) y recifrado en segundo plano.
- Integración opcional con OpenBao como gestor externo. [SUPUESTO — licencia MPL-2.0 según conocimiento previo; verificar en Fase 1]. No se exige ningún gestor con licencia no libre.

## 10.6 Centro de confianza (sección 15) — controles técnicos

| Control | Implementación | Fase |
|---|---|---|
| Registro de consultas | `QueryLogEntry` encadenado | 3 (adelantado, D-32) |
| Bitácora encadenada | `AuditLogEntry` con hash anterior; herramienta CLI de verificación independiente | 1–2 |
| Firmas de artefactos | Cosign (Sigstore) sobre imágenes y paquete offline | 1 |
| SBOM | Syft en formato CycloneDX en cada versión | 1 |
| Procedencia | Atestaciones de compilación en CI | 1 |
| Verificación independiente | Guía para comprobar procesos (`docker top`), conexiones (`ss`, logs del egress-gateway), consultas (logs del motor de BD auditado), archivos e integridad sin depender de la UI | 11 |
| Pausa/detención | Interfaz + CLI local + detener contenedor del agente | 3 |
| Bloqueo de conexiones externas | Red Docker interna sin salida + egress-gateway | 1–3 |

## 10.7 Seguridad automatizada en CI (sección 16)

| Herramienta | Uso | Bloquea publicación |
|---|---|---|
| Gitleaks | Secretos en cada push | Sí, siempre |
| Semgrep CE | Análisis estático | Sí, en hallazgos de severidad alta |
| OSV-Scanner | Vulnerabilidades en dependencias | Sí (D-24) |
| Trivy | Imágenes de contenedor | Sí (D-24) |
| Syft | SBOM | No (genera artefacto) |
| Cosign | Firma | No (paso obligatorio de publicación) |
| OWASP ZAP (baseline) | DAST sobre entorno efímero | Sí, en alertas altas (desde Fase 2) |
| OpenSSF Scorecard | Prácticas del repositorio | No; informe público |
| CodeQL | Análisis semántico | Solo si el repositorio es público o el plan lo permite (S-07) |

**D-24 — Regla de bloqueo**: una vulnerabilidad crítica o alta **con corrección disponible** bloquea la publicación. Sin corrección disponible, se requiere una excepción documentada (análisis de explotabilidad, mitigación, fecha de revisión) aprobada por un mantenedor distinto del autor.

Ejecutar estas herramientas **no certifica** el software (sección 16).
