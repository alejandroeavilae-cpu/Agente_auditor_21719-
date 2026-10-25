# 8. Diseño de conectores

Estado: **Diseñado**.

## 8.1 Contrato común

Cada conector implementa la interfaz del paquete `connector-sdk` y publica un **manifiesto declarativo** que la plataforma muestra a la organización antes de autorizar una auditoría. Nada fuera del manifiesto puede ejecutarse.

```ts
// Boceto de contrato (no es código de producción).
interface ConnectorManifest {
  id: string;                       // p. ej. "postgresql"
  version: string;                  // SemVer del conector
  capabilities: Capability[];       // "list-schemas" | "list-columns" | "sample-values" | ...
  auth: AuthMethod[];               // "password" | "token" | "oauth-client" | "none"
  requiredPermissions: string[];    // texto legible: "SELECT sobre INFORMATION_SCHEMA"
  allowedOperations: Operation[];   // siempre de lectura
  limitations: string[];            // lo que el conector NO puede observar
  defaults: {
    maxQueries: number;             // por ejecución
    maxDurationSeconds: number;
    maxSampleRows: number;          // 0 = muestreo desactivado (D-09)
    queryTimeoutSeconds: number;
  };
  extractionPolicy: "metadata-only" | "metadata-and-sampling";
  risks: string[];                  // riesgos asociados declarados
}

interface Connector {
  manifest(): ConnectorManifest;
  /** Verifica privilegios reales; advierte si la cuenta tiene permisos de escritura. */
  preflight(ctx: ScopedContext): Promise<PreflightReport>;
  discover(ctx: ScopedContext): AsyncIterable<DiscoveredAsset>;
  /** Solo si la autorización vigente incluye muestreo. */
  sample?(ctx: ScopedContext, field: FieldRef): Promise<SampleStats>;
}
```

`ScopedContext` entrega: credenciales descifradas en memoria (nunca a disco), límites ya calculados desde la autorización, un registrador de consultas obligatorio (`QueryLogEntry`) y una señal de cancelación.

## 8.2 Reglas transversales

1. **Preflight obligatorio**: antes de descubrir, el conector comprueba los privilegios de la cuenta. Si detecta permisos de escritura, la ejecución se detiene y se genera un hallazgo sobre la propia cuenta (mínimo privilegio, principio 11) salvo que el responsable acepte explícitamente continuar.
2. **Solo metadatos por defecto** (D-09). El muestreo, si se autoriza, devuelve estadísticas (p. ej. proporción de valores que cumplen el patrón de RUT válido) y nunca valores.
3. **Toda consulta se registra** antes de ejecutarse (texto normalizado, sin parámetros con valores).
4. **Límites duros**: número de consultas, duración, filas por muestra y tiempo por consulta; al excederlos se cancela y se documenta la cobertura parcial.
5. **Anti-SSRF**: resolución DNS controlada, rechazo de direcciones fuera de la lista de destinos autorizada, sin seguir redirecciones a otros hosts, y todo tráfico a través del egress-gateway.
6. **Sin evasión**: prohibido implementar técnicas para eludir autenticación, captchas, controles de acceso o límites de tasa (sección 8).
7. **Archivos hostiles** (D-45): todo archivo se parsea dentro del agente aislado con límites de tamaño, razón de descompresión, profundidad y tiempo; sin resolución de entidades XML externas; macros y fórmulas nunca se ejecutan.
8. **Credenciales** (D-43): en Modalidades B y C se descifran solo en el agente local de la organización.
9. **Errores**: cada error se clasifica (autenticación, permiso, red, límite, datos) y se registra sin incluir credenciales ni valores.

## 8.3 Conectores iniciales

| Conector | Fase | Fuente de metadatos | Muestreo | Limitaciones declaradas |
|---|---|---|---|---|
| PostgreSQL | 3 | `information_schema`, `pg_catalog`, comentarios de columna | Opcional (`TABLESAMPLE` o `LIMIT`) | No ve datos en columnas JSON salvo muestreo; no ve vistas sin permiso. |
| SQL Server | 3 | `INFORMATION_SCHEMA`, `sys.*`, propiedades extendidas | Opcional (`TOP n`) | Requiere permiso `VIEW DEFINITION`; no ve bases sin acceso. |
| MySQL / MariaDB | 3 | `information_schema` | Opcional (`LIMIT`) | Similar a PostgreSQL. |
| CSV | 3 | Encabezados, tipos inferidos sobre muestra | Inherente (se lee el archivo) | El archivo se procesa en memoria y no se almacena; se guarda el hash del **archivo completo** (no de valores). |
| Excel (.xlsx) | 3 | Hojas, encabezados | Inherente | Macros nunca se ejecutan; fórmulas no se evalúan. |
| PDF | 4 | Texto extraíble, campos de formulario | Inherente | Sin OCR en v1 (D-34): PDFs escaneados se reportan como "no analizables". |
| Documentos (.docx) | 4 | Texto, tablas | Inherente | Sin macros. |
| API REST | 3 | Especificación OpenAPI si existe; respuestas de endpoints GET autorizados | Por diseño la respuesta contiene valores → procesamiento en memoria, sin persistencia de valores | Solo endpoints listados en la autorización; solo GET. |
| Aplicación web (Playwright) | 10 | DOM de formularios, etiquetas, atributos `name`/`autocomplete`, flujo de navegación | No aplica | Ver `08-agentes.md`; riesgo residual de mutación por GET (C-04). |

## 8.4 Interfaces preparadas (sin implementación en v1)

Oracle, SAP, SharePoint, Salesforce y sistemas legacy: solo se define el manifiesto esperado y los puntos de extensión. Su implementación queda abierta a la comunidad, sujeta a la misma revisión de seguridad.

## 8.5 Pruebas de conectores

Cada conector debe pasar: pruebas contra bases sintéticas en contenedores (Testcontainers), prueba de que una cuenta con permisos de escritura dispara el preflight, prueba de límites, prueba de cancelación y prueba de que ningún valor aparece en logs, base de datos ni evidencias (búsqueda de valores sintéticos centinela).
