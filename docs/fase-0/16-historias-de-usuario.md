# 17. Historias de usuario

Formato: *Como [rol], quiero [acción], para [beneficio].* Las historias de las Fases 1–3 tienen criterios de aceptación (CA) aquí; el resto recibirá sus CA al planificar su fase (regla: CA escritos antes de implementar). IDs `HU-xx` referenciados en la matriz de trazabilidad.

## Instalación y confianza

**HU-01** Como encargado de TI municipal, quiero instalar la plataforma sin Internet desde un paquete, para operar sin depender de servicios externos.
- CA1: instalación limpia completa sin conexión de red saliente (verificado con la red bloqueada).
- CA2: la firma del paquete se verifica antes de instalar, con instrucciones offline.

**HU-02** Como encargado de seguridad, quiero verificar que la versión instalada corresponde al código publicado, para confiar en el software sin creer en la palabra de sus autores.
- CA1: el hash de la imagen en ejecución coincide con el publicado y firmado.
- CA2: la guía permite verificarlo con herramientas propias (sin usar la interfaz de la plataforma).

**HU-03** Como responsable institucional, quiero ver cada consulta que el agente ejecutó en mis sistemas, para comprobar que se respetó el alcance.
- CA1: todas las consultas aparecen en el registro antes de su ejecución.
- CA2: el registro es exportable y su integridad verificable con la CLI.

**HU-04** Como responsable institucional, quiero pausar o detener al agente en cualquier momento, para controlar el impacto en mis sistemas.
- CA1: la cancelación detiene nuevas consultas en menos del tiempo máximo por consulta configurado.

## Identidad y organizaciones

**HU-05** Como administrador, quiero exigir MFA a los roles con privilegios, para reducir el riesgo de suplantación.
**HU-06** Como operador de una instalación multiempresa, quiero crear organizaciones aisladas, para atender a varias entidades sin riesgo de acceso cruzado.
- CA1: ninguna petición de un tenant obtiene datos de otro (suite de aislamiento).
**HU-07** Como administrador de una organización, quiero que el operador de la plataforma no pueda ver mis datos sin mi aprobación, para mantener el control sobre mi información.

## Sistemas y conectores

**HU-08** Como responsable de auditoría, quiero registrar una autorización con alcance y vigencia, para que el agente solo actúe dentro de lo permitido.
- CA1: sin autorización vigente, el inicio de ejecución es rechazado.
**HU-09** Como encargado de BD, quiero que el conector me avise si la cuenta tiene permisos de escritura, para corregirla antes de auditar.
**HU-10** Como responsable de auditoría, quiero que las credenciales se guarden cifradas y nunca se muestren, para proteger el acceso a mis sistemas.

## Descubrimiento y clasificación

**HU-11** Como auditor, quiero un inventario de campos con datos personales y su categoría, método y confianza, para priorizar la revisión.
**HU-12** Como auditor, quiero validar o corregir cada clasificación, para que el resultado final tenga revisión humana.
**HU-13** Como encargado de privacidad, quiero que por defecto no se lean valores de registros, para minimizar el acceso a datos personales.

## Normativa y evaluación

**HU-14** Como revisor jurídico, quiero ver la referencia exacta y la versión normativa de cada control, para validar su aplicación.
**HU-15** Como revisor jurídico, quiero ser el único rol que puede confirmar "No conforme" en obligaciones legales, para evitar conclusiones jurídicas automáticas.
**HU-16** Como responsable de cumplimiento, quiero que la fecha de vigencia se actualice con una nueva versión del catálogo, para reflejar cambios legales sin reinstalar el software.

## Riesgos, hallazgos y remediación

**HU-17** Como auditor, quiero un riesgo inherente y residual por hallazgo con su incertidumbre, para priorizar.
**HU-18** Como responsable de remediación, quiero acciones con responsable, fecha, criterio de aceptación y evidencia de cierre, para gestionar la corrección.
**HU-19** Como jefe de servicio, quiero alertas de acciones vencidas, para hacer seguimiento.

## Reportes

**HU-20** Como directivo, quiero un informe ejecutivo en PDF con indicadores que muestren su denominador, para entender el estado sin interpretaciones engañosas.
**HU-21** Como auditor, quiero exportar inventarios y hallazgos a Excel y CSV, para trabajarlos en otras herramientas.

## IA

**HU-22** Como administrador, quiero activar o desactivar la IA, para decidir según mis recursos y política.
**HU-23** Como auditor, quiero ver cuándo una clasificación fue sugerida por IA, con qué modelo y versión, para evaluarla críticamente.

## Comunidad

**HU-24** Como desarrollador externo, quiero contribuir un conector siguiendo un contrato documentado, para extender la plataforma.
**HU-25** Como investigador de seguridad, quiero reportar una vulnerabilidad de forma privada, para que se corrija antes de su divulgación.
