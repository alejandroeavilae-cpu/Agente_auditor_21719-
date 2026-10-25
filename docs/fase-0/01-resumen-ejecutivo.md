# 1. Resumen ejecutivo

## Qué es

Una plataforma de software libre, gratuita y autohospedable que ayuda a organizaciones chilenas —municipalidades, servicios públicos, empresas y organizaciones de cualquier tamaño— a:

1. **Descubrir** qué datos personales procesan sus sistemas (bases de datos, archivos, APIs y aplicaciones web), priorizando metadatos y evitando leer registros personales.
2. **Clasificarlos** por categoría (identificación, contacto, salud, biometría, menores de edad, geolocalización, etc.) con un motor híbrido: reglas determinísticas primero, IA local como apoyo opcional y validación humana al final.
3. **Evaluarlos** frente a un catálogo normativo versionado basado en la Ley 19.628 modificada por la Ley 21.719, distinguiendo obligación legal, recomendación técnica y buena práctica.
4. **Gestionar riesgos, hallazgos y planes correctivos**, con evidencias, responsables, fechas y reevaluación.
5. **Demostrar su propia confiabilidad**: el software debe poder verificarse (firmas, SBOM, registros encadenados, control institucional del agente), no solo afirmarse seguro.

## Contexto normativo (a la fecha de este análisis)

- La Ley 21.719 fue publicada en el Diario Oficial el 13-12-2024 y modifica la Ley 19.628. **[VERIFICADO]** (fuente 1)
- Su entrada en vigencia legal es el **1 de diciembre de 2026**. **[VERIFICADO]** (fuentes 2, 3)
- El Ejecutivo ingresó el 01-09-2026 un proyecto (boletín 18.623-07) que propone trasladar la vigencia al **1 de diciembre de 2027**. Al 21–22 de octubre de 2026 seguía en primer trámite en el Senado; según las mismas fuentes, la Comisión de Constitución aprobó en general la idea de legislar y el Ejecutivo hizo presente urgencia de discusión inmediata. **No es ley.** **[FUENTE SECUNDARIA]** (fuentes 4, 5, 6; coincidentes entre sí, no contrastadas con la ficha oficial del Senado)
- Consecuencia de diseño: la fecha de vigencia no se escribe en el código; es un **parámetro del catálogo normativo versionado** (decisión D-05).

## Decisiones estructurales tomadas (detalle en `21-decisiones.md`)

| Ámbito | Decisión |
|---|---|
| Licencia | **AGPL-3.0-or-later** (protege contra apropiación en modalidad "como servicio"; permite uso público y privado sin pagar). |
| Base de datos | **PostgreSQL por defecto**; SQL Server como adaptador oficialmente soportado. |
| Multiempresa | **Una base de datos por organización (tenant)** + base de control separada. |
| IA | **Local (Ollama), desactivada por defecto**; la IA solo sugiere, nunca decide ni ejecuta. |
| Normativa | Todo control nace **"pendiente de revisión jurídica"**; sin revisión, el sistema no emite "No conforme" legal, emite "Requiere validación". |
| Confianza | Partes del Centro de Confianza (firmas, SBOM, registro de consultas, bitácora encadenada) se **adelantan a las Fases 1–3**. |

## Factibilidad (síntesis)

Técnicamente factible con el stack propuesto, con tres condiciones: (a) reducir el alcance de la primera versión publicable (MVP) a conectores SQL y archivos, dejando la exploración web autónoma para la Fase 10; (b) contar con **revisión jurídica humana** del catálogo normativo —es el mayor cuello de botella y no puede automatizarse—; y (c) asegurar **más de un mantenedor** para la sostenibilidad comunitaria. Ver `02-factibilidad.md`.

## Qué falta para avanzar

Aprobación humana del responsable del proyecto para iniciar la **Fase 1 (infraestructura base)**. Las decisiones pendientes que no pueden tomarse por delegación (revisión jurídica, mantenedores, institución piloto) están en `21-decisiones.md` §3.

## Fuentes (consultadas el 25-10-2026)

1. Diario Oficial, edición 13-12-2024, Ley 21.719: https://www.diariooficial.interior.gob.cl/publicaciones/2024/12/13/44023/01/2583630.pdf
2. Academia Judicial, actualización normativa Ley 21.719: https://academiajudicial.cl/recursos/actualizaciones-normativas/ley-21-719-que-regula-la-proteccion-y-el-tratamiento-de-los-datos-personales-y-crea-la-agencia-de-proteccion-de-datos-personales/
3. Diario Constitucional, 12-06-2026: https://www.diarioconstitucional.cl/2026/06/12/la-ley-21-719-entra-en-vigor-el-1-de-diciembre-y-expone-vacios-en-regulacion-de-pequenas-empresas/
4. Cuatrecasas, proyecto que modifica la ley: https://www.cuatrecasas.com/es/latam/art/proyecto-que-modifica-ley-proteccion-datos-personales
5. Surtika, estado boletín 18.623-07 (verificación manual 21-10-2026): https://surtika.cl/prorroga-ley-21719
6. TheNextSecurity, 21-10-2026: https://www.thenextsecurity.cl/insights/ley-21719-comision-senado-propone-postergar-2027/

Las fuentes 3 a 6 son secundarias; el estado de tramitación debe confirmarse en la ficha oficial del Senado antes de cada versión del catálogo normativo.
