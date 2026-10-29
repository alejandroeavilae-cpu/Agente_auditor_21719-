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
- CI: [PENDIENTE].
- QA: [PENDIENTE].
