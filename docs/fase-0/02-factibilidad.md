# 2. Análisis de factibilidad

Escala: **Alta** (sin bloqueos conocidos), **Media** (factible con condiciones), **Baja** (requiere cambiar el requisito).

## 2.1 Factibilidad técnica

| Dimensión | Evaluación | Fundamento |
|---|---|---|
| Stack Node.js + TypeScript + NestJS + React | Alta | Tecnologías maduras y libres. [SUPUESTO — licencias MIT de NestJS y React según conocimiento previo; se verificarán en el inventario de dependencias de Fase 1]. |
| Persistencia en SQL Server con Prisma | Alta | Prisma soporta SQL Server (`provider = "sqlserver"`) mediante el adaptador `@prisma/adapter-mssql`; en Prisma 7 los adaptadores de driver son el valor por defecto. [VERIFICADO, fuente 1] |
| Persistencia en PostgreSQL | Alta | Soporte nativo de Prisma. [SUPUESTO — conocimiento previo] |
| Mismo esquema en ambos motores | Media | Prisma abstrae la mayoría de diferencias, pero hay limitaciones propias de SQL Server (relaciones cíclicas solo con `NoAction`, conversiones `NVARCHAR` en consultas raw, cambios destructivos en migraciones). [VERIFICADO, fuente 1] Requiere CI con ambos motores desde la Fase 2. |
| IA local (Ollama) en CPU | Media | Viable para clasificación asistida con modelos pequeños cuantizados; latencia alta en CPU. Mitigación: la IA es opcional y asíncrona; las reglas determinísticas no dependen de ella. [ESTIMACIÓN — validar en Fase 10] |
| Exploración web con Playwright en modo solo lectura | Media | Playwright permite interceptar y abortar peticiones; pero "solo lectura" en aplicaciones web no es garantizable al 100 % (una aplicación puede mutar estado con GET). Ver revisión crítica C-04. |
| Funcionamiento sin Internet (Modalidad A) | Media | Viable si las imágenes, modelos y catálogo normativo se distribuyen en un paquete offline. La verificación de firmas Sigstore sin conexión requiere distribuir los "bundles" de verificación. [PENDIENTE — probar en Fase 1] |
| Multiempresa con aislamiento estricto | Media | Viable con base de datos por tenant (D-04). Aumenta costo operativo por tenant; se acepta por seguridad. |
| Compilaciones reproducibles | Baja–Media | Difícil en ecosistema Node + imágenes de contenedor. Se adopta como objetivo progresivo, no como criterio de bloqueo (la especificación lo pide "cuando sea técnicamente viable"). |

## 2.2 Factibilidad económica (gratuidad)

- Todo el stack recomendado es software libre o gratuito sin licencia de pago. [DECISIÓN D-03, D-17, D-12]
- **SQL Server no es software libre**. La edición Express 2025 es gratuita pero limitada: 50 GB por base de datos, 1.410 MB de buffer pool, el menor entre 1 socket o 4 núcleos, y no incluye SQL Server Agent, backups comprimidos ni cifrados, ni TDE. Las ediciones Developer no pueden usarse en producción. [VERIFICADO, fuente 2] Por eso PostgreSQL es el motor por defecto (D-03).
- La instalación **nunca tiene costo total cero**: requiere servidor, electricidad, respaldo y personal. Ver `20-recursos-y-costos.md`.

## 2.3 Factibilidad normativa

| Aspecto | Evaluación |
|---|---|
| Base legal identificada | Alta. Texto oficial publicado (Diario Oficial 13-12-2024). [VERIFICADO] |
| Fecha de vigencia | Media. Incertidumbre por el boletín 18.623-07 (posible traslado a 01-12-2027). Mitigación: parámetro versionado (D-05). |
| Reglamentos y criterios de la Agencia | Baja–Media. La ley remite a reglamentos (p. ej. art. 26 "Reglamento") y a la Agencia (arts. 30 y siguientes) [VERIFICADO, índice del texto oficial]; su contenido futuro es desconocido. El catálogo debe poder actualizarse sin nueva versión del software. |
| Interpretación jurídica | **Baja sin apoyo humano.** El proyecto no puede producir conclusiones jurídicas confiables sin revisión de un profesional del derecho. Es el principal riesgo de factibilidad (R-01). |

## 2.4 Factibilidad organizacional y comunitaria

- Hoy existe un responsable (persona natural). Un proyecto de seguridad con un solo mantenedor tiene riesgo alto de continuidad ("bus factor" = 1). [PENDIENTE P-03]
- La AGPL puede reducir la adopción por algunas empresas que evitan esa licencia; se acepta a cambio de la protección frente a apropiación. Ver `04-licencia.md`.
- El alcance completo (28 módulos, 9 conectores, 24 manuales) es grande para un equipo pequeño. Se recomienda un **MVP publicable** al cierre de la Fase 9 sin agente web autónomo, y luego iterar.

## 2.5 Conclusión

**Factible con condiciones.** Las condiciones bloqueantes son: revisión jurídica humana del catálogo (antes de la Fase 5), al menos un segundo mantenedor antes de la publicación (Fase 13) y una institución piloto (Fase 14). Ninguna condición técnica es bloqueante.

## Fuentes (consultadas el 25-10-2026)

1. Prisma, documentación SQL Server: https://docs.prisma.io/docs/v6/orm/overview/databases/sql-server
2. Microsoft Learn, ediciones y componentes de SQL Server 2025: https://learn.microsoft.com/en-us/sql/sql-server/editions-and-components-of-sql-server-2025
