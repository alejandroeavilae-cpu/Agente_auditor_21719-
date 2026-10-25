# 21. Estimación de recursos y costos operativos

**Advertencia (sección 25):** ninguna instalación tiene costo total cero. Requiere servidor, electricidad, respaldo, mantenimiento y tiempo de personas. Lo que el proyecto garantiza es **ausencia de costos de licencia obligatorios**.

Estado epistémico de las licencias: solo la de SQL Server se verificó en fuente oficial durante esta fase. Las demás provienen de conocimiento previo y se marcan **[SUPUESTO]**; la Fase 1 genera el inventario de dependencias con SBOM y verificación automática de licencias, que sustituye a esta tabla.

## 21.1 Tecnologías y servicios

| Componente | Licencia | Costo de licencia | Dependencia externa | Alternativa gratuita | Limitaciones / riesgo de sostenibilidad |
|---|---|---|---|---|---|
| PostgreSQL | PostgreSQL License [SUPUESTO] | 0 | No | — | Requiere administración de BD |
| SQL Server Express 2025 | Propietaria, gratuita [VERIFICADO] | 0 | No | PostgreSQL | 50 GB por BD, 1.410 MB buffer pool, ≤ 4 núcleos, sin Agent, sin backups cifrados ni TDE [VERIFICADO] |
| SQL Server Standard/Enterprise | Propietaria | Pago (a cargo de la organización) | No | PostgreSQL | Solo si la institución ya tiene licencia |
| Node.js | MIT [SUPUESTO] | 0 | No | — | Ciclo de soporte LTS |
| NestJS, React, Vite | MIT [SUPUESTO] | 0 | No | — | — |
| Prisma ORM | Apache-2.0 [SUPUESTO] | 0 | No (sin servicios en la nube requeridos) | Drizzle/Kysely | Cambios mayores entre versiones (v6→v7) [VERIFICADO: cambios de timeouts del adaptador] |
| Valkey | BSD-3-Clause [SUPUESTO] | 0 | No | — | — |
| BullMQ | MIT [SUPUESTO] | 0 | No | Cola en BD | — |
| Playwright | Apache-2.0 [SUPUESTO] | 0 | Descarga de navegadores en build | — | Imagen pesada; se empaqueta para offline |
| Ollama | MIT [SUPUESTO] | 0 | Descarga de modelos (empaquetables) | llama.cpp | Opcional |
| Modelos de IA | Según modelo (criterio D-21) | 0 | No | — | Licencias de modelos heterogéneas |
| Caddy | Apache-2.0 [SUPUESTO] | 0 | No | nginx | — |
| Docker Engine / Compose | Apache-2.0 [SUPUESTO] | 0 | Registro de imágenes al actualizar | Podman | Docker Desktop tiene condiciones distintas; se recomienda Docker Engine en Linux |
| GitHub Actions | Servicio | 0 en repos públicos [SUPUESTO S-05] | Sí | Forgejo Actions / Woodpecker | Cambio de condiciones del proveedor (R-20) |
| Gitleaks, Trivy, OSV-Scanner, Syft, Cosign, Semgrep CE, ZAP | Libres [SUPUESTO] | 0 | Bases de vulnerabilidades en línea en CI | — | Semgrep CE tiene reglas con licencias propias: verificar |
| OpenBao (opcional) | MPL-2.0 [SUPUESTO] | 0 | No | Archivo de clave | Opcional |

## 21.2 Requisitos de hardware [ESTIMACIÓN — validar en pruebas de rendimiento (Fase 9) y piloto (Fase 14)]

| Perfil | Uso | CPU | RAM | Disco |
|---|---|---|---|---|
| Mínimo sin IA (Modalidad A) | 1 organización, pocos sistemas | 2 vCPU | 4–8 GB | 50 GB |
| Recomendado sin IA | Organización mediana | 4 vCPU | 8–16 GB | 100 GB+ |
| Con IA local en CPU | Agrega modelo pequeño cuantizado | +4 vCPU | +8 GB o más | +10 GB por modelo |
| Multiempresa (Modalidad B) | Depende del número de tenants | Escala horizontal del worker | — | — |

Son cifras de partida para dimensionar, **no mediciones**. Se reemplazarán por valores medidos.

## 21.3 Recursos humanos (por institución que instala) [ESTIMACIÓN]

| Rol | Dedicación |
|---|---|
| Administrador de sistemas | Instalación inicial, actualizaciones verificadas, respaldos |
| Responsable de auditoría / privacidad | Configurar autorizaciones, revisar resultados |
| Revisor jurídico | Validar conclusiones legales |

## 21.4 Recursos del proyecto (desarrollo)

Mínimo para avanzar con riesgo aceptable: responsable/mantenedor, un segundo mantenedor con perfil de seguridad (P-03) y un revisor jurídico (P-01). Agentes de IA de desarrollo pueden acelerar la implementación, pero no reemplazan las revisiones humanas exigidas.

## 21.5 Optimización para instituciones con pocos recursos

- IA desactivada por defecto; todas las funciones esenciales sin IA.
- Una sola máquina en Modalidad A; sin Kubernetes (D-29).
- PostgreSQL por defecto (sin límites de edición).
- Reportes generados bajo demanda, no precalculados.
