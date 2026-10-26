# Guía de revisión de código

Aplica a toda revisión de pull requests, humana o asistida por agentes de IA. El objetivo no es solo encontrar errores, sino garantizar que el software siga siendo **verificable** (principio final de la especificación).

## 1. Antes de revisar

- El PR enlaza un issue o una tarea de la fase aprobada; cambios fuera de la fase en curso se rechazan.
- CI en verde (verificación, Compose, seguridad). Un CI rojo no se revisa: se devuelve.
- Todos los commits tienen `Signed-off-by` (DCO).

## 2. Lista de verificación

**Alcance y diseño**
- [ ] Resuelve lo que dice la tarea, nada más (sin funcionalidades no pedidas).
- [ ] Respeta las decisiones registradas (`docs/fase-0/21-decisiones.md`); si se aparta, registra una decisión nueva.

**Seguridad y privacidad**
- [ ] Toda entrada externa se valida con zod; se rechazan campos no declarados.
- [ ] No se registran (logs, bitácora, errores) valores de datos personales, credenciales ni secretos.
- [ ] Nuevas conexiones de red: ¿están justificadas y limitadas? (sin telemetría, D-30).
- [ ] Contenido de sistemas auditados se trata como hostil (D-45).
- [ ] Acceso a datos con contexto de tenant (desde la Fase 2).

**Calidad**
- [ ] TypeScript estricto sin `any` ni aserciones injustificadas.
- [ ] Comentarios en español que explican el porqué; JSDoc en interfaces públicas.
- [ ] Cabecera SPDX en archivos nuevos.
- [ ] Pruebas que fallarían si el cambio se revirtiera; casos negativos incluidos.

**Dependencias**
- [ ] Toda dependencia nueva: necesidad real, licencia permitida (CI lo comprueba), mantenimiento activo, versión exacta.
- [ ] Acciones de GitHub fijadas por SHA de commit con comentario de versión.

**Documentación y estado**
- [ ] Documentación actualizada en español.
- [ ] El estado declarado es real (Diseñado/Implementado/Probado/…); no se afirman resultados no ejecutados.

## 3. Áreas sensibles

Autenticación, cifrado, conectores, bitácora, catálogo normativo y workflows de CI requieren dos aprobaciones, una de un mantenedor distinto del autor ([PENDIENTE P-03] mientras haya un solo mantenedor; ver `docs/fase-0/14-gobernanza.md`). Cambios en `catalog/` requieren además revisión jurídica humana.

## 4. Cómo comentar

Distinga **bloqueante** (debe corregirse), **sugerencia** (mejora opcional) y **pregunta**. Explique el riesgo concreto, no solo la preferencia.
