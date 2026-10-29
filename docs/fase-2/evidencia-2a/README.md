# Evidencia local de la entrega 2A

Informes JSON de Vitest. Se generaron con `--reporter=json` en `packages/persistence`, contra PostgreSQL 18.4 local, el 28-10-2026. En las rutas, el directorio del repositorio se reemplazó por `<repo>`. Los archivos no contienen credenciales.

| Archivo | Commit | Resultado |
|---|---|---|
| `incidente-2119a8c.json` | `2119a8c` | 41 aprobadas, **3 fallidas**: la prueba de suspensión era inestable (ver `2a-registro.md` §7) |
| `vi-1.json` … `vi-5.json` | `2119a8c` + corrección de `fefab6f` (antes de su commit) | 44 aprobadas, 0 fallidas, 0 omitidas en cada una de las 5 ejecuciones seguidas |

La evidencia de CI de `fefab6f` y `930b5cd` (PostgreSQL y SQL Server) está en los runs citados en `2a-registro.md`.
