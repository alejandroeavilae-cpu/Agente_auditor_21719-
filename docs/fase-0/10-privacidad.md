# 11. Modelo de privacidad

Estado: **Diseñado**. La plataforma audita tratamientos de datos personales y, al mismo tiempo, **es ella misma un tratamiento** (O-01). Ambos planos se diseñan.

## 11.1 Plano 1 — Datos que la plataforma toca de los sistemas auditados

| Principio de diseño | Aplicación concreta |
|---|---|
| Minimización | Solo metadatos por defecto (D-09). El muestreo requiere autorización explícita, tiene tamaño máximo y nunca persiste valores. |
| Limitación de finalidad | Lo descubierto solo se usa para la auditoría autorizada; no se usa para entrenar modelos (sección 18) salvo autorización específica y base jurídica. |
| Procesamiento local | Sin telemetría, sin servicios externos por defecto; IA local (D-07). |
| Seguridad | Cifrado de evidencias por tenant; capturas de pantalla con campos enmascarados antes de guardarse. |
| Transparencia hacia la organización | La organización ve exactamente qué consultas se ejecutaron (registro de consultas) y qué se guardó. |
| Prueba de no fuga | Pruebas automatizadas con **valores centinela sintéticos**: se siembran en las BD de prueba y se verifica que no aparezcan en logs, BD de la plataforma, evidencias ni reportes. |

## 11.2 Plano 2 — Datos personales propios de la plataforma

Titulares: usuarios de la plataforma (funcionarios, auditores, abogados). Datos: nombre, correo, rol, registros de acceso, IP.

Entregables previstos (Fase 2 y Fase 13):
- Registro de actividades de tratamiento propio (plantilla precargada en el tenant).
- Aviso de privacidad modelo para la organización que instala.
- Procedimiento de ejercicio de derechos de los usuarios (acceso, rectificación, supresión, oposición, portabilidad, bloqueo — [VERIFICADO por los epígrafes de los arts. 5 a 9 y 8° ter; contenido de cada derecho pendiente de revisión jurídica]) con funciones de exportación y supresión de cuenta.
- Plantilla de evaluación de impacto de la propia plataforma.

La bitácora de auditoría conserva identidad de actores incluso tras la supresión de una cuenta, por su finalidad de trazabilidad; esta tensión con el derecho de supresión requiere **[PENDIENTE] revisión jurídica** (P-01). Propuesta técnica: seudonimizar el actor (identificador estable) y guardar el vínculo identidad↔seudónimo en una tabla que sí puede suprimirse.

## 11.3 Roles jurídicos según modalidad [PENDIENTE revisión jurídica]

| Modalidad | Responsable de los datos auditados | Rol de quien opera la plataforma |
|---|---|---|
| A | La organización que instala | La misma organización |
| B | Cada organización cliente | El operador probablemente actúa como encargado (art. 15 bis — epígrafe verificado); requiere contrato de encargo (O-10) |
| C | La organización | El panel central recibe solo resultados autorizados; su rol depende de qué se comparta |

El proyecto de software libre **no** es responsable ni encargado de ningún tratamiento: no opera instancias.

## 11.4 Privacidad de la IA (sección 18)

- Se envía al modelo solo lo imprescindible: nombres de campos, etiquetas, comentarios de esquema; nunca valores de registros.
- Prompts y versiones de modelo versionados y registrados por clasificación.
- La IA puede desactivarse completamente sin pérdida de funciones esenciales (reglas determinísticas independientes).

## 11.5 Privacidad por defecto en la interfaz

- Dashboards muestran agregados; el detalle por campo requiere rol Auditor.
- Exportaciones marcadas con clasificación de confidencialidad y registradas en bitácora.
