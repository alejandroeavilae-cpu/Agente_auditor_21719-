# Fase 2 · Entrega 2B: Identidad y permisos. Registro

- **Aprobación de inicio:** Alejandro Ávila, 29-10-2026 14:07 (hora de Chile), después de aprobar el cierre de 2A (fusión del PR #3, 29-10-2026 13:32).
- **Rama:** `fase-2b`.
- **Estado:** en curso.
- **Orden de trabajo:**
  1. Corregir los hallazgos abiertos de 2A.
  2. Diseñar identidad y permisos y **presentar el diseño al responsable antes de implementarlo**.
  3. Implementar.
  4. Revisión QA independiente.
  5. Aprobación humana del cierre de 2B.

## 1. Hallazgos abiertos de 2A corregidos

| ID | Corrección | Prueba |
|---|---|---|
| X-01 | Un `CREATE` que falla con "ya existe" se trata como **no creado**, sin dudas sobre su autoría. Códigos: PostgreSQL 42P04/42710; SQL Server 1801/15025. Además, `cleanupProvisioning` comprueba que la base solo contenga tablas de la plataforma y que no declare otra organización antes de eliminarla. | `M-01/X-01` (la base ajena se conserva y el alta se revierte). `X-01: cleanupProvisioning no elimina una base con tablas ajenas`. |
| X-02 | `rotate-password` hace `RESET ALL` en **cada** base para la que el usuario fijó parámetros, no solo en la suya. | `M-02` ampliada con un parámetro fijado para la base de control. |
| Y-02 | `tenant check` distingue un fallo de descifrado: indica que la clave maestra no corresponde o que el registro fue alterado, y que `rotate-password` no lo resuelve. | `Y-02` (un administrador con otra clave maestra) |
| Y-03 | La prueba de FIFO se omite en Windows (`it.skipIf`). | `pnpm run verify` en Linux (crypto: 15 pruebas). [PENDIENTE: CI no se ejecuta en Windows; tampoco se verificaron allí las pruebas de permisos de archivo] |

**Evidencia local (29-10-2026, Node 24.22.1, PostgreSQL 18.4):**

- `pnpm run verify`: código 0. Pruebas: web 4, crypto 15, audit-log 44, api 15, persistence 23 más 1 omitida (la de integración, sin motores).
- Integración: **3 ejecuciones seguidas con 46 aprobadas, 0 fallidas y 0 omitidas** (postgresql=23). Informes en `docs/fase-2/evidencia-2b/hallazgos-2a-1.json` a `-3.json`.
- CI de `c696bf9` (mismo código que `e169e90`): **69 aprobadas, 0 fallidas y 0 omitidas** (postgresql=23, sqlserver=23), verificado por QA. En `e169e90` y `b67f602`, la integración y la prueba de humo quedaron canceladas porque llegó un push más nuevo.
- **QA independiente (29-10-2026): X-01, X-02, Y-02 e Y-03 aprobados**, sin regresiones en 2A. QA abrió tres hallazgos nuevos, todos Bajos: Z-01, Z-02 y Z-03 (§2).

## 2. Hallazgos de la verificación QA del 29-10-2026

| ID | Hallazgo | Corrección | Prueba |
|---|---|---|---|
| Z-01 | `cleanupProvisioning` solo revisaba tablas de `public` por nombre. Podía borrar una base con datos ajenos en otro esquema, en vistas materializadas, secuencias, funciones, tipos u objetos grandes | `Provisioner.foreignObjects` revisa todo el catálogo: en PostgreSQL `pg_class` (todo tipo), esquemas, `pg_proc`, tipos y `pg_largeobject_metadata`; en SQL Server `sys.objects`, tipos de usuario y esquemas. Solo se admiten las tablas de la plataforma en `public`/`dbo` y sus índices o restricciones | `X-01` ampliada. PostgreSQL: tabla `otro.audit_log`, vista materializada, secuencia, función, tipo enumerado y objeto grande. SQL Server: tabla y secuencia ajenas en `dbo`, y `otro.audit_log` |
| Z-02 | El mensaje de Y-02 decía que `rotate-password` no resolvía un registro alterado, pero sí lo resuelve | `tenant check` separa los dos casos. Si no abre la DEK, la clave maestra no corresponde y rotar no sirve. Si la DEK abre pero la contraseña guardada no, rotar sí lo resuelve | `Z-02` (sobre cifrado de otra organización → `check` recomienda rotar → rotar lo resuelve) |
| Z-03 | El diseño de 2B mantenía como `[PROPUESTA]` puntos ya decididos (D-75, D-76, D-78) | Etiquetas corregidas. Se citan D-18 y `09-seguridad.md` §10.3. Se agregaron las cabeceras de seguridad y los errores sin trazas internas (§10.4), que faltaban | — |

**Evidencia local (29-10-2026):**
- `pnpm run verify`: código 0.
- Integración con PostgreSQL: **3 ejecuciones seguidas con 47 aprobadas, 0 fallidas y 0 omitidas** (postgresql=24). Informes en `docs/fase-2/evidencia-2b/z-1.json` a `-3.json`.
- **Incidente:** las primeras ejecuciones fallaron por dos errores de la propia prueba.
  - Un operador SQL ambiguo (`text || "char"`).
  - La cuenta de aprovisionamiento no puede crear objetos grandes (`template1` endurecido).

  Se corrigieron antes de commitear. Las bases y los roles que dejaron esas ejecuciones fallidas se eliminaron a mano.
- **Incidente en CI:** el run de `e3f70ff` falló en SQL Server por un conflicto de intercalación (error 451) en la consulta de `foreignObjects`; esa consulta no se puede probar localmente. Se corrigió forzando `COLLATE DATABASE_DEFAULT` y armando el texto en JavaScript. También se cierran las sesiones antes de borrar el login de pruebas.
- CI de `94cb0d9`: los 7 jobs en verde; integración **71 aprobadas, 0 fallidas, 0 omitidas** (postgresql=24, sqlserver=24), job 123617274392.
- QA: [PENDIENTE].
