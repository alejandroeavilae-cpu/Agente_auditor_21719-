# 12. Modelo de aislamiento multiempresa

Estado: **Diseñado**. Decisión **D-04: una base de datos por tenant**.

## 12.1 Alternativas evaluadas

| Alternativa | Aislamiento | Costo operativo | Funciona igual en PostgreSQL y SQL Server | Decisión |
|---|---|---|---|---|
| Filas con `tenantId` (BD compartida) | Depende de que nunca falte un filtro; un error expone a todos | Bajo | Sí, pero RLS difiere entre motores | Descartada |
| Esquema por tenant | Medio; mismos usuarios de BD | Medio | Parcial; Prisma maneja esquemas de forma distinta en SQL Server (sin `search_path`) [VERIFICADO] | Descartada |
| **Base de datos por tenant** | **Alto**; credenciales de BD propias por tenant | Medio–alto | Sí | **Elegida** |
| Instancia completa por tenant | Máximo | Alto | Sí | Disponible de hecho: es la Modalidad A |

Fundamento: la especificación exige "aislamiento de bases de datos" de forma literal (Modalidad B), retención y destrucción por organización, y protección contra acceso cruzado. La BD por tenant permite respaldar, restaurar, exportar y destruir un tenant completo sin tocar a los demás.

## 12.2 Aislamiento por capa

| Capa | Mecanismo |
|---|---|
| Base de datos | BD y usuario de BD propios por tenant; el usuario de un tenant no tiene permisos sobre otra BD |
| Aplicación | El tenant se resuelve desde la sesión (nunca desde parámetros del cliente); el cliente Prisma se obtiene de un registro por tenant; ningún repositorio acepta consultas sin contexto de tenant |
| Archivos | Carpeta por tenant + clave de cifrado por tenant (D-38) |
| Caché y colas | Prefijo de claves por tenant + usuario ACL de Valkey por tenant para workers dedicados; los trabajos llevan `tenantId` firmado (HMAC) |
| Registros (logs) | Campo `tenantId` obligatorio; la bitácora de auditoría vive en la BD del tenant |
| Reportes | Generados por worker con contexto de tenant; archivo cifrado con la clave del tenant |
| Agentes (Modalidad B/C) | Certificado de cliente mTLS por tenant; un agente solo puede publicar en su tenant |
| Operador de plataforma | Sin acceso a contenido; break-glass con aprobación del tenant y registro en su bitácora (C-09) |

## 12.3 Ciclo de vida del tenant

1. Alta: crear BD, usuario, clave DEK, aplicar migraciones, crear administrador inicial con MFA obligatorio.
2. Migraciones: el orquestador de migraciones aplica versiones tenant por tenant con registro de resultado; un fallo detiene el despliegue de esa versión para ese tenant.
3. Suspensión: sesiones revocadas, agentes revocados, datos intactos.
4. Baja: exportación firmada opcional → destrucción de BD, archivos y clave → acta de destrucción (O-09).

## 12.4 Pruebas de aislamiento (Fase 2, obligatorias en CI)

- Usuario del tenant A intenta leer, por cada endpoint, recursos del tenant B → 404/403 en el 100 % de los casos.
- Trabajo de cola con `tenantId` manipulado → rechazado por firma.
- Agente con certificado del tenant A publica en tenant B → rechazado.
- Búsqueda de valores centinela del tenant A en artefactos del tenant B → ninguno.
