# Guía de contribución

Gracias por su interés. Este proyecto trata información sensible de terceros; por eso las reglas de contribución son estrictas.

## Antes de empezar

1. Lea la especificación (`docs/especificacion/`) y el registro de decisiones (`docs/fase-0/21-decisiones.md`).
2. Para cambios no triviales, abra primero un issue describiendo el problema y la propuesta.
3. **Nunca** incluya credenciales, datos personales reales ni volcados de bases de datos reales. Use solo datos sintéticos.

## Certificado de Origen del Desarrollador (DCO)

Todo commit debe firmarse con `git commit -s`, lo que agrega:

```
Signed-off-by: Nombre Apellido <correo@ejemplo.cl>
```

Con esa línea usted certifica que tiene derecho a enviar la contribución bajo la licencia del proyecto (AGPL-3.0-or-later), según el texto del DCO 1.1 publicado en https://developercertificate.org/. No se exige CLA.

## Reglas técnicas

- TypeScript estricto. Identificadores en inglés. Comentarios y documentación en español.
- Comentarios que expliquen **propósito, condiciones y razones**, no lo evidente. JSDoc en interfaces públicas.
- Cabecera en cada archivo fuente: `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- Pruebas para todo cambio de comportamiento. No se aceptan resultados de prueba sin la ejecución real en CI.
- Nuevas dependencias: justificar en el PR (necesidad, licencia compatible, mantenimiento, alternativa).

## Revisión

- Ningún cambio se fusiona sin revisión humana.
- Áreas sensibles (autenticación, cifrado, conectores, catálogo normativo, CI) requieren dos aprobaciones, una de un mantenedor distinto del autor.
- Cambios en el catálogo normativo requieren además revisión jurídica antes de marcarse como revisados.

## Estados de avance

Use estos términos con precisión en PR y documentación: Diseñado · Implementado · Probado · Validado · Revisado en seguridad · Revisado jurídicamente · Aprobado para publicación.
