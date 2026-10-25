# 14. Estrategia de evaluación normativa y matriz normativa preliminar

Estado: **Diseñado. Ningún control está revisado jurídicamente.** Este documento no es asesoría legal.

## 14.1 Reglas de la estrategia

1. **Fuente primaria**: texto oficial de la Ley 21.719 publicado en el Diario Oficial (13-12-2024) y la versión consolidada de la Ley 19.628 en LeyChile (idNorma 1209272). La versión consolidada no pudo consultarse directamente desde el entorno de análisis; se usó el PDF del Diario Oficial. [VERIFICADO parcialmente: el PDF consultado está truncado después del art. 30 quáter]
2. **Catálogo versionado** (`catalog/` en el repositorio), en YAML validado por esquema, firmado al publicar. Cada versión declara: fuente, fecha de consulta, fecha de vigencia normativa aplicable y estado de revisión jurídica.
3. **Vigencia como parámetro** (D-05): valor actual 01-12-2026. Si el boletín 18.623-07 se convierte en ley, se publica una nueva versión del catálogo con la fecha que fije la ley publicada. El catálogo puede actualizarse sin nueva versión del software.
4. **Tipos de control** (sección 11): obligación legal · recomendación técnica · buena práctica · requisito condicionado · no aplicable.
5. **Referencia exacta obligatoria**: cada control de tipo "obligación legal" cita artículo e inciso/literal. Un control sin referencia verificada no puede ser de tipo obligación legal.
6. **Prohibido inventar**: artículos, plazos, montos de sanciones o interpretaciones. Los montos de multas **no se incluyen** en esta fase porque no se verificaron en fuente oficial. [PENDIENTE]
7. **Revisión jurídica** (D-06): atributo `legalReviewStatus` = `pending | reviewed | rejected`, con nombre del revisor y fecha. Mientras esté `pending`, el motor no puede emitir "No conforme" ni "Conforme" para obligaciones legales; emite "Requiere validación".
8. **Aplicabilidad**: condiciones por tipo de organización (órgano público, privado), tamaño (art. 14 septies) y actividades (p. ej. trata datos de NNA, biométricos, transferencias).

## 14.2 Motor de evaluación (sección 12)

| Resultado | Cuándo |
|---|---|
| Conforme | Evidencia suficiente validada por humano con rol habilitado |
| No conforme | Evidencia de incumplimiento validada por humano con rol habilitado |
| Requiere validación | El sistema encontró indicios o el control no es verificable automáticamente (ver 03-revision-critica §3.18) |
| No evaluado | Fuera de alcance o falta de acceso; **nunca se cuenta como conforme** |
| No aplicable | Condición de aplicabilidad no se cumple, con justificación registrada |

Reglas explícitas: ausencia de hallazgos ≠ conforme; presencia de datos personales ≠ infracción.

## 14.3 Matriz normativa preliminar (índice de disposiciones)

Numeración y epígrafes de la Ley 19.628 según queda modificada por la Ley 21.719.

**Fuente A** = Diario Oficial 13-12-2024 (oficial) [VERIFICADO epígrafes]. **Fuente B** = ley.leydedatos.com (secundaria) [FUENTE SECUNDARIA — confirmar en texto oficial].

| Disposición | Epígrafe | Fuente | Tema del catálogo | Verificable por la plataforma |
|---|---|---|---|---|
| Art. 1° | Objeto y ámbito de aplicación | A | Aplicabilidad | Humano |
| Art. 1° bis | Ámbito de aplicación territorial | A | Aplicabilidad | Humano |
| Art. 2° | Definiciones | A | Taxonomía de clasificación | Base del clasificador |
| Art. 3° | Principios | A | Principios de tratamiento | Parcial (indicios) |
| Art. 4° | Derechos del titular de datos | A | Derechos | Humano + cuestionario |
| Art. 5° | Derecho de acceso | A | Derechos | Humano |
| Art. 6° | Derecho de rectificación | A | Derechos | Humano |
| Art. 7° | Derecho de supresión | A | Supresión | Humano |
| Art. 8° | Derecho de oposición | A | Derechos | Humano |
| Art. 8° bis | Decisiones individuales automatizadas, incluida la elaboración de perfiles | A | Decisiones automatizadas (O-04) | Indicios |
| Art. 8° ter | Derecho de bloqueo del tratamiento | A | Derechos | Humano |
| Art. 9° | Derecho a la portabilidad | A | Derechos | Humano |
| Art. 10 | Forma y medios de ejercer los derechos | A | Derechos | Humano |
| Art. 11 | Procedimiento ante el responsable | A | Derechos | Humano |
| Art. 12 | Regla general del tratamiento de datos | A | Bases jurídicas | Humano |
| Art. 13 | Otras fuentes de licitud | A | Bases jurídicas | Humano |
| Art. 14 | Obligaciones del responsable | A | Obligaciones de responsables | Parcial |
| Art. 14 bis | Deber de secreto o confidencialidad | A | Confidencialidad | Humano |
| Art. 14 ter | Deber de información y transparencia | A | Transparencia | Parcial (existencia de aviso en app web) |
| Art. 14 quáter | Protección desde el diseño y por defecto | A | Seguridad / diseño | Parcial |
| Art. 14 quinquies | Deber de adoptar medidas de seguridad | A | Seguridad | Parcial (permisos, exposición) |
| Art. 14 sexies | Deber de reportar vulneraciones | A | Gestión de incidentes | Humano |
| Art. 14 septies | Diferenciación de estándares de cumplimiento | A | Aplicabilidad por tamaño (O-05) | Configuración |
| Art. 15 | Cesión de datos personales | A | Comunicación de datos | Humano |
| Art. 15 bis | Tratamiento a través de tercero mandatario o encargado | A | Encargados | Humano |
| Art. 15 ter | Evaluación de impacto | A | Evaluaciones de impacto (O-03) | Humano + flujo |
| Art. 16 | Regla general datos sensibles | A | Datos sensibles | Clasificador + humano |
| Art. 16 bis | Datos de salud y perfil biológico | A | Datos sensibles | Clasificador + humano |
| Art. 16 ter | Datos biométricos | A | Datos sensibles | Clasificador + humano |
| Art. 16 quáter | Datos de niños, niñas y adolescentes | A | Menores de edad | Clasificador + humano |
| Art. 16 quinquies | Fines históricos, estadísticos, científicos | A | Requisito condicionado | Humano |
| Art. 16 sexies | Datos de geolocalización | A | Geolocalización | Clasificador + humano |
| Arts. 17–19 | Obligaciones financieras, bancarias o comerciales | A | Información financiera | Clasificador + humano |
| Art. 20 | Tratamiento por órganos públicos | A | Organismos públicos | Humano |
| Art. 21 | Principios y normas aplicables a órganos públicos | A | Organismos públicos | Humano |
| Art. 22 | Comunicación o cesión por órgano público | A | Organismos públicos | Humano |
| Art. 23 | Derechos del titular ante órganos públicos | A | Organismos públicos | Humano |
| Art. 24 | Regímenes especiales | A | Aplicabilidad | Humano |
| Art. 25 | Datos sobre infracciones penales, civiles, administrativas y disciplinarias | A | Datos sensibles (categoría especial) | Clasificador + humano |
| Art. 26 | Reglamento | A | Seguimiento normativo | — |
| Art. 27 | Regla general de autorización (transferencia internacional) | A | Transferencias internacionales | Humano |
| Art. 28 | Países adecuados y transferencia internacional | A | Transferencias internacionales | Humano |
| Arts. 29–30 quáter | Fiscalización y Agencia | A | Contexto institucional | — |
| Arts. 33–40 | Responsabilidad, infracciones, sanciones, registro, prescripción | B | Contexto (sin montos en esta fase) | — |
| Arts. 47–49 | Prevención de infracciones y modelo de prevención | B | Modelo de prevención (O-02) | Humano |
| Art. 50 | Atribuciones del delegado | B | Delegado (O-02) | Humano |
| Arts. 51–53 | Certificación del modelo de prevención | B | Modelo de prevención | Humano |
| Art. 54 | Congreso, Poder Judicial y órganos autónomos | B | Aplicabilidad | Humano |
| Arts. transitorios 1°–8° | Disposiciones transitorias | B (solo encabezados) | Vigencia y plazos | [PENDIENTE: contenido no verificado] |

## 14.4 Ejemplo de control (formato del catálogo)

```yaml
# Ejemplo ilustrativo. Estado: pendiente de revisión jurídica.
code: SEG-001
title: Cuentas de acceso a bases con datos personales aplican mínimo privilegio
type: technical-recommendation        # no se declara obligación legal sin revisión
legalReferences:
  - norm: "Ley 19.628 (mod. Ley 21.719)"
    article: "14 quinquies"
    verifiedAgainst: "Diario Oficial 13-12-2024"
    note: "Relación temática con el deber de seguridad; no se afirma que este control sea exigido literalmente."
applicability: { always: true }
evaluation:
  method: automated-indicator          # preflight del conector detecta permisos de escritura
  automatedMaxResult: requires-validation
legalReviewStatus: pending
catalogVersion: 0.1.0
```

## 14.5 Proceso de mantenimiento del catálogo (O-12)

Responsable: mantenedor del catálogo + revisor jurídico. Revisión ante: publicación de ley modificatoria, reglamentos, criterios de la Agencia. Cada versión pasa por: borrador → revisión jurídica → firma → publicación.

## Fuentes (consultadas el 25-10-2026)

- A: https://www.diariooficial.interior.gob.cl/publicaciones/2024/12/13/44023/01/2583630.pdf
- B: https://ley.leydedatos.com/ley-21719/vk2CTQx4n1jzdJTXFE5f8i
- Fuente primaria declarada en la especificación (no accesible desde el entorno de análisis): https://nuevo.leychile.cl/navegar?idNorma=1209272
