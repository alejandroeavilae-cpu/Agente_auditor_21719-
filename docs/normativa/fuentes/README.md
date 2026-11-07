# Fuentes normativas primarias

Textos oficiales usados para construir el catálogo normativo (Prompt Maestro V2.2, sección 11; decisiones D-97 y D-98).

Los documentos los entregó el responsable del proyecto el 07-11-2026. Los generó la Biblioteca del Congreso Nacional de Chile (www.leychile.cl) ese mismo día.

## Archivos

| Archivo | Norma | Versión del documento | Uso |
|---|---|---|---|
| `ley-21719_generada-2026-11-07.pdf` | Ley 21.719, que regula la protección y el tratamiento de los datos personales y crea la Agencia de Protección de Datos Personales | Publicada el 13-12-2024. "Con vigencia diferida por fecha de: 01-DIC-2026". Última modificación: 05-02-2026, Ley 21.806. Url corta: https://bcn.cl/gJo3hf [VERIFICADO: encabezado del documento] | Modificaciones a la Ley 19.628 (artículo primero) y disposiciones transitorias |
| `ley-19628_version-2023-05-09_generada-2026-11-07.pdf` | Ley 19.628, sobre protección de la vida privada | "Última versión de: 09-MAY-2023". Fin de vigencia: 30-11-2026. Url corta: https://bcn.cl/3a0ih [VERIFICADO: encabezado del documento] | Texto base sobre el que se aplican las modificaciones de la Ley 21.719 |
| `*.txt` | Las mismas normas | Texto extraído de cada PDF con `pdftotext -layout` (poppler) | **Solo apoyo de lectura.** Ante cualquier diferencia, prevalece el PDF |
| `SHA256SUMS` | — | Hashes SHA-256 de los cuatro archivos | Verificación de integridad |

## Reglas de uso

1. **La versión de la Ley 19.628 de este directorio deja de regir el 30-11-2026.** No se usa para evaluar cumplimiento desde el 01-12-2026 (V2.2 §11, regla 3).
2. El texto aplicable desde el 01-12-2026 se reconstruye aplicando el artículo primero de la Ley 21.719 sobre la Ley 19.628. Para cada artículo se registra el texto de origen y la modificación aplicada (V2.2 §11, regla 2). Si se obtiene el texto refundido oficial con vigencia desde el 01-12-2026, se agrega a este directorio con su hash y pasa a ser la fuente preferente (regla 1).
3. Ningún control del catálogo puede citar una norma que no esté en este directorio (V2.2 §1).
4. Los archivos no se modifican. Una versión nueva se agrega con otro nombre y su hash, y se registra en el registro de decisiones.

## Verificación

```sh
cd docs/normativa/fuentes
sha256sum -c SHA256SUMS
```

Resultado esperado: `OK` en las cuatro líneas.

## Advertencia

El catálogo construido con estas fuentes **no tiene revisión jurídica especializada** (D-96). Los informes de la plataforma deben indicar: "Este informe no constituye asesoría legal ni ha sido validado por un abogado".
