# 4. Propuesta de licencia open source

**Decisión D-01: GNU Affero General Public License v3.0 o posterior (SPDX: `AGPL-3.0-or-later`).**
Tomada por delegación del responsable del proyecto el 25-10-2026. El texto oficial está en `/LICENSE` (tomado del paquete npm `spdx-license-list` v6, que reproduce el texto con el formato de párrafos de SPDX; [PENDIENTE: comparar con el texto publicado en gnu.org en la Fase 1]).

> Nota de estado epistémico: la comparación siguiente resume el contenido de ambas licencias según conocimiento previo del equipo y el texto de la AGPL incluido en el repositorio. **No es asesoría jurídica.** [PENDIENTE: revisión jurídica de la elección, P-01]

## 4.1 Comparación

| Criterio | Apache-2.0 | AGPL-3.0 |
|---|---|---|
| 1. Libertad de uso | Total, para cualquier fin. | Total, para cualquier fin (incluido comercial). |
| 2. Modificación y redistribución | Permitida; las versiones modificadas pueden cerrarse. | Permitida; las versiones redistribuidas deben mantenerse bajo AGPL con código fuente disponible. |
| 3. Obligación de publicar modificaciones | Ninguna. | Si se distribuye **o si se ofrece a usuarios a través de una red**, debe ofrecerse el código fuente correspondiente a esos usuarios (sección 13). |
| 4. Uso por organismos públicos | Sin fricción. | Sin fricción para uso interno; si un organismo modifica y ofrece el servicio a terceros, debe compartir el código. Coherente con el interés público. |
| 5. Uso por empresas privadas | Sin fricción; algunas preferirán Apache por política interna. | Uso interno sin modificaciones: sin obligaciones de publicación. Si se **modifica** y se ofrece por red incluso a sus propios empleados, debe ofrecerse el código a esos usuarios (sección 13) [PENDIENTE P-01: confirmar alcance]. Algunas empresas tienen políticas que restringen la AGPL → **posible menor adopción**. |
| 6. Compatibilidad con dependencias | Compatible con MIT/BSD/Apache. | Puede incorporar dependencias MIT, BSD, ISC, Apache-2.0, MPL-2.0, LGPL y GPL-3.0. Incompatible con licencias no libres. |
| 7. Protección frente a apropiación | **Débil**: un proveedor puede crear un producto cerrado derivado y ofrecerlo como servicio pago. | **Fuerte**: un proveedor que ofrezca una versión modificada como servicio (p. ej. Modalidad B comercial) debe publicar sus cambios. |
| 8. Patentes y atribución | Licencia expresa de patentes y cláusula de terminación; archivo NOTICE para atribución. | Licencia expresa de patentes (sección 11) y avisos de copyright preservados. |
| 9. Ofrecer el software como servicio | Sin obligación alguna. | Obligación de ofrecer el código fuente a los usuarios remotos. |

## 4.2 Fundamento de la decisión

1. El principio final de la especificación privilegia el **interés público** y la **verificabilidad**. Con AGPL, cualquier organización que use una instancia operada por un tercero (Modalidad B) tiene derecho a recibir el código fuente que realmente se ejecuta, lo que refuerza el Centro de Confianza.
2. El riesgo principal de un proyecto gratuito de cumplimiento normativo es que un proveedor lo empaquete como servicio cerrado y pago. La AGPL lo impide sin restringir el uso comercial (la especificación pide no confundir "sin fines comerciales" con "prohibir uso comercial").
3. La pérdida de adopción en algunas empresas es aceptable: el público objetivo prioritario son municipalidades y organismos con recursos limitados.

## 4.3 Consecuencias operativas

- Cabecera SPDX en cada archivo fuente: `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- La interfaz web mostrará un enlace "Código fuente" que apunta a la versión exacta en ejecución (cumplimiento de la sección 13 de la AGPL y del Centro de Confianza).
- Contribuciones bajo **DCO** (Developer Certificate of Origin), sin CLA (D-02): al no haber cesión de derechos, el proyecto no puede relicenciar las contribuciones de terceros a una licencia cerrada sin su consentimiento; cada titular conserva sus propios aportes, y la cláusula "o posterior" permite usar versiones futuras de la AGPL publicadas por la FSF. [SUPUESTO — interpretación pendiente de revisión jurídica P-01]
- Las dependencias se inventarían con SBOM (Syft) y se verifican contra una lista de licencias permitidas en CI (Fase 1).
- **Reversibilidad:** mientras no existan contribuciones externas, el responsable puede cambiar la licencia sin costo. Después, el cambio requiere consentimiento de los contribuyentes.

## 4.4 Titularidad

Aviso de copyright inicial: `Copyright (C) 2026 Alejandro Ávila y colaboradores del proyecto`. [PENDIENTE P-02: evaluar transferir la titularidad a una fundación u organización sin fines de lucro para la continuidad del proyecto.]
