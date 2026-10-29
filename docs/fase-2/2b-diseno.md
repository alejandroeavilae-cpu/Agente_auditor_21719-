# Fase 2 · Entrega 2B: Identidad y permisos. Diseño para aprobación

**Estado:** Diseñado. Pendiente de **aprobación del responsable antes de implementar**. Las decisiones marcadas `[PROPUESTA]` pasan a `[DECISIÓN]` (D-75 en adelante) solo con esa aprobación.

**Base:**
- Especificación §17.
- `docs/fase-0/09-seguridad.md` §10.3–10.4, `06-modelo-de-datos.md` §7.3–7.5 y `11-multiempresa.md`.
- Decisiones D-18 (argon2id + TOTP, OIDC opcional) y D-74 (v1 = instalación institucional local).

**Fuera de 2B:**
- Pantallas: se hacen en 2C. En 2B la API se prueba con pruebas automáticas.
- OIDC y WebAuthn: mejoras posteriores (D-18).
- Autorizaciones de auditoría y separación de funciones sobre ellas: Fase 3.

## 1. Quién es quién

| Identidad | Dónde vive | Para qué |
|---|---|---|
| **Usuario de una organización** | En la **base de la organización** (aislada, 2A) | Usar la plataforma: auditar, revisar y leer informes, según su rol |
| **Administrador técnico de la instalación** (el "operador de plataforma" de la especificación) | No es un usuario web: es quien tiene acceso al servidor y usa `auditor-admin` | Crear organizaciones y el **primer administrador** de cada una. No ve contenido de las organizaciones (C-09) |

**`[DECISIÓN D-76]` En la v1 el operador de plataforma no tiene cuenta web.** Con la instalación local (D-74), quien administra el servidor ya tiene acceso físico. Una cuenta web adicional solo agregaría superficie de ataque. Si se retoma la Modalidad B, se diseñará en ese momento.

## 2. Roles (RBAC)

Son los **7 roles base** de `06-modelo-de-datos.md` §7.5. El operador de plataforma no es un rol web.

- **Administrador de organización:** gestiona usuarios y roles de su organización. No audita (separación de funciones).
- **Responsable de auditoría:** crea autorizaciones de auditoría (Fase 3).
- **Auditor:** revisa clasificaciones y hallazgos.
- **Revisor jurídico:** el único que fija "Conforme" o "No conforme" en obligaciones legales (D-06).
- **Responsable de remediación:** gestiona las acciones asignadas.
- **Lector:** solo ve dashboards e informes.

**Reglas de permisos:**
- **`[PROPUESTA]` Roles fijos en la v1, sin roles personalizados.** Cada rol es una lista de permisos en el código, revisable y con pruebas. Los roles personalizados aumentan el riesgo de configuración y se pueden agregar después.
- **Denegar por defecto:** cada endpoint declara el permiso que exige. Una prueba automática falla si algún endpoint no declara permiso.
- **Varios roles por usuario:** se permite. Hay combinaciones prohibidas por separación de funciones; por ejemplo, Administrador + Revisor jurídico. `[PROPUESTA]`
- **Condiciones** (p. ej. "solo hallazgos asignados a mí"): el mecanismo queda preparado y se usa cuando existan esos objetos (Fases 7–8).
- **No quedarse sin administrador:** siempre debe quedar al menos un administrador activo con MFA.

## 3. Inicio de sesión

1. El usuario entra con **organización + correo + contraseña**.
   - **`[DECISIÓN D-75]` La organización se indica de forma explícita.** No existe una lista global de correos que revele en qué organización está cada persona.
   - Si la instalación tiene una sola organización, se configura como predeterminada y el usuario no la escribe.
2. **Contraseña:**
   - Se guarda con **argon2id**, usando la función incorporada en Node.js 24 (`crypto.argon2`). Así no se agrega ninguna dependencia [VERIFICADO: disponible en Node 24.22.1 local, sin advertencia de función experimental; `PENDIENTE` confirmar su nivel de estabilidad en la documentación oficial].
   - Parámetros iniciales: memoria 19 MiB, 2 pasadas, paralelismo 1 [ESTIMACIÓN: valores habituales de referencia; `PENDIENTE` verificar contra la recomendación vigente de OWASP antes de fijarlos]. Se guardan junto al hash para poder subirlos después.
   - Política: **mínimo 12 caracteres** y sin máximo bajo (128). Sin reglas de composición forzada. Se rechazan las contraseñas comunes usando una lista incluida en el paquete, sin consultas externas [`PENDIENTE`: elegir la lista y verificar que su licencia sea compatible].
3. **MFA TOTP:**
   - Códigos de 6 dígitos cada 30 s (RFC 6238), implementado con `node:crypto`, sin dependencia nueva.
   - **Obligatorio** para Administrador, Responsable de auditoría y Revisor jurídico; opcional para los demás. D-18 exige MFA en los "roles con privilegios"; la lista concreta está en `09-seguridad.md` §10.3. Confirmado por el responsable en D-77.
   - El secreto TOTP se guarda **cifrado con la DEK de la organización** (2A).
   - Se entregan **10 códigos de recuperación** de un solo uso, guardados como hash.
   - Un mismo código TOTP no se acepta dos veces.
4. **Bloqueo progresivo:**
   - Los intentos fallidos aumentan la espera por cuenta; además hay un límite de tasa por IP.
   - El mensaje de error es siempre el mismo, para no revelar si el correo existe.
5. **Sesión:**
   - Token aleatorio en una cookie `HttpOnly`, `Secure` y `SameSite=Strict`. En la base solo se guarda su **hash**.
   - Se renueva al autenticarse.
   - Expira por inactividad a los **30 min** y como máximo a las **12 h** `[PROPUESTA]`.
   - Cerrar sesión, cambiar la contraseña o desactivar al usuario revoca sus sesiones.
6. **Acciones de alto riesgo:** exigen volver a ingresar el código MFA dentro de los últimos 5 min `[PROPUESTA]`. Por ejemplo: cambiar roles, desactivar MFA de otro usuario o exportar la bitácora.
7. **CSRF:** además de `SameSite=Strict`, las peticiones que modifican algo llevan un token anti-CSRF.
8. **Cabeceras y errores** (`09-seguridad.md` §10.4): todas las respuestas de la API incluyen:
   - CSP estricta sin `unsafe-inline`;
   - `frame-ancestors 'none'`;
   - `X-Content-Type-Options: nosniff`;
   - `Referrer-Policy: no-referrer`;
   - `Cache-Control: no-store` en respuestas autenticadas.

   Los errores devuelven un código y un mensaje genérico, sin trazas internas.

## 4. Primer administrador de cada organización

- Comando: `auditor-admin user invite-admin --tenant <id> --email <correo>`.
- Imprime un **enlace de activación de un solo uso**, válido 24 h `[PROPUESTA]`.
- Con ese enlace la persona fija su contraseña y **debe** configurar MFA antes de poder hacer cualquier otra cosa.
- La plataforma no envía correos en la v1: no se agrega un servidor de correo. El administrador técnico entrega el enlace por un canal seguro.
- Los demás usuarios los invita el administrador de la organización con el mismo mecanismo, a través de la API (las pantallas llegan en 2C).

## 5. Registro de accesos y datos personales de los usuarios

La plataforma también trata datos personales: los de sus propios usuarios (O-01). Por eso:

- **Qué se registra en la bitácora de la organización:**
  - inicio y cierre de sesión;
  - intentos fallidos;
  - cambios de contraseña, MFA y roles;
  - invitaciones y desactivaciones.
- **Qué NO se registra nunca:** contraseñas, códigos MFA ni tokens.
- **`[DECISIÓN D-78]` Dirección IP:** se guarda en el registro de accesos con retención configurable (valor inicial: 90 días [SUPUESTO: valor operativo, no es una recomendación legal; `PENDIENTE` de revisión jurídica]). En la bitácora inmutable solo queda un identificador de la IP con clave HMAC, porque esa bitácora no permite borrar entradas.
- **Navegador:** se guarda la familia (p. ej. "Firefox"), sin huella digital del navegador (A-04).
- **Aviso de nuevo dispositivo o IP:** queda **registrado**. No se envía correo en la v1.

## 6. API en 2B (sin pantallas)

Son los primeros endpoints autenticados.

**Autenticación:**
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/mfa/verify`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/password`
- `POST /api/v1/auth/mfa/enroll` y `POST /api/v1/auth/mfa/confirm`
- `POST /api/v1/auth/activate`

**Gestión de usuarios** (solo Administrador de organización):
- `GET /api/v1/users`
- `POST /api/v1/users/invitations`
- `PATCH /api/v1/users/:id/roles`
- `POST /api/v1/users/:id/deactivate`

**Reglas comunes:**
- Toda entrada se valida con zod y se rechazan los campos no declarados.
- Se aplica un límite de tasa.
- Cada petición se resuelve contra **la base de su organización**. La organización sale de la sesión, nunca de un parámetro que el cliente pueda cambiar.

## 7. Pruebas previstas (criterios de aceptación de 2B)

- **Contraseñas:** hash argon2id verificable; la contraseña no aparece en logs ni en la base (búsqueda de un valor centinela).
- **TOTP:**
  - vectores de prueba del RFC 6238 [`PENDIENTE`: incorporarlos desde el texto del RFC];
  - rechazo de un código reutilizado y de un código fuera de la ventana de tiempo.
- **Bloqueo progresivo y límite de tasa:** comprobados.
- **Respuestas uniformes:** el mensaje no revela si un correo existe.
- **Sesión:**
  - expira por inactividad y por tiempo máximo;
  - se revoca al cerrar sesión, al cambiar la contraseña y al desactivar al usuario;
  - una sesión anterior no sirve después de autenticarse de nuevo (fijación de sesión).
- **CSRF:** una petición sin token se rechaza.
- **Cabeceras y errores:** las cabeceras de §3.8 están en todas las respuestas, y un error interno no expone trazas al cliente.
- **Permisos:**
  - matriz de cada rol frente a cada endpoint (denegar por defecto);
  - un endpoint sin permiso declarado hace fallar la prueba.
- **Aislamiento:** con una sesión de la organización A no se puede leer ni modificar nada de la organización B, ni siquiera alterando identificadores. Va en PostgreSQL y SQL Server. La suite completa de aislamiento se cierra en 2C.
- **Primer administrador:** el enlace de activación es de un solo uso, vence y obliga a configurar MFA.
- **Bitácora:** los eventos de acceso quedan registrados y verificables con `auditor-log verify`.

## 8. Decisiones del responsable

Respondidas el 29-10-2026 con la opción recomendada en las cuatro preguntas. Quedaron registradas como **D-75 a D-78**.

| # | Pregunta | Recomendación |
|---|---|---|
| 1 | ¿Cómo se identifica la organización al iniciar sesión? | Organización + correo, con una organización predeterminada si hay una sola |
| 2 | ¿El operador de plataforma tiene cuenta web en la v1? | No: solo la CLI en el servidor |
| 3 | ¿MFA obligatorio para todos o solo para los roles privilegiados? | Solo los privilegiados, según la especificación (D-18). Opcional para Auditor, Remediación y Lector |
| 4 | ¿Se guarda la IP en el registro de accesos? | Sí, con retención configurable (90 días por defecto) y solo un identificador con HMAC en la bitácora inmutable |
