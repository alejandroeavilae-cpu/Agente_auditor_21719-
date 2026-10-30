# Fase 2 · Entrega 2C: Pantallas, permisos entre roles y consola del operador. Diseño para aprobación

**Estado:** Diseñado y **aprobado por el responsable el 29-10-2026 a las 23:31 (D-88)**, con las cinco recomendaciones de §6. Las marcas `[PROPUESTA]` de este documento quedan aprobadas como `[DECISIÓN D-88]`.

**Base:**
- Especificación §6 (React, Vite, componentes accesibles) y §17.
- Diseño de 2B (`2b-diseno.md`) y su registro (`2b-registro.md` §6 y §7).
- Decisiones:
  - D-16: React, Vite, React Aria Components y TanStack Query; WCAG 2.2 AA; sin CDN;
  - D-37: Caddy con CA interna;
  - D-74: instalación institucional local;
  - D-75 ajustada, D-84, D-85, D-86, D-87 y D-81 con R-35;
  - D-83 con R-34 aceptado y mitigación al inicio de 2C.
- `docs/fase-0/09-seguridad.md` (ZAP baseline desde Fase 2) y `15-plan-por-fases.md` (WCAG 2.2 AA en pantallas nuevas desde Fase 2).

**Fuera de 2C:**
- OIDC y WebAuthn (D-18).
- Envío de correos: la v1 no tiene servidor de correo.
- Todo lo de la Fase 3 en adelante: sistemas, conectores, autorizaciones de auditoría.
- La Modalidad B (varias organizaciones).
- La suite de aislamiento entre organizaciones (D-84).

---

## 0. Cómo se entrega: tres partes con aprobación separada `[PROPUESTA]`

2C es más grande que 2B. Para que cada revisión sea manejable, se divide igual que la Fase 2:

| Parte | Contenido | Cierre |
|---|---|---|
| **2C-1 Ajustes de identidad y despliegue** | D-75 ajustada, D-86, D-87, mitigación de R-34, pruebas de la cookie pedidas por QA, perfil institucional con HTTPS | PR propio, QA y aprobación del responsable |
| **2C-2 Pantallas de usuarios** | Inicio de sesión, MFA, activación, gestión de usuarios y roles, exportación de la bitácora, registro de accesos; pruebas E2E, de accesibilidad y ZAP | PR propio, QA y aprobación del responsable |
| **2C-3 Consola del operador** | Servicio separado, cuentas de operador con nombre y MFA, funciones de operación (D-85) | PR propio, QA y aprobación del responsable |

El orden importa: 2C-2 se construye sobre la identidad ya ajustada en 2C-1, y 2C-3 necesita que la API ya no tenga la clave maestra (D-87). Así, la cuenta de aprovisionamiento y la clave maestra quedan solo en el servicio del operador.

---

## 1. Parte 2C-1: ajustes de identidad y despliegue

### 1.1 Inicio de sesión solo con correo y contraseña (D-75 ajustada)

- `POST /api/v1/auth/login` recibe `{ email, password }`. El campo `organization` deja de existir. Si se envía, la petición se rechaza, como cualquier campo no declarado.
- Lo mismo aplica a `POST /api/v1/auth/activate`: recibe `{ token, password }`.
- La organización queda fija en la configuración de la API. **Precisado por D-90:** los datos de la organización se toman del archivo `organization.json` que escribe la CLI; `ORGANIZATION_SLUG` queda como comprobación opcional.
- La cookie de sesión deja de llevar el prefijo `<slug>.`: contiene solo el token aleatorio.
- El mensaje de error pasa a ser "Correo o contraseña incorrectos".
- Se mantiene la respuesta mínima de 300 ms (D-82). Ahora protege contra adivinar qué correos tienen cuenta.

### 1.2 MFA obligatoria para todos (D-86)

- Todos los usuarios deben tener MFA. **Precisado por QA 2C1-06:** `requiresMfa()` devuelve verdadero sin consultar los roles, incluso para un usuario sin roles.
- Quien no tiene MFA configurada entra en la etapa `mfa_enroll` y no puede hacer nada más hasta configurarla. Este mecanismo ya existe en 2B para los roles privilegiados.
- La regla "no quedarse sin administrador activo con MFA" no cambia.

### 1.3 La API sin la clave maestra (D-87)

**Precisión técnica que requiere confirmación (pregunta 2 de §6).** D-87 habla de "una llave derivada de la clave maestra". Al revisar el código de 2B se ve que hoy los secretos MFA y el HMAC de la IP usan la **llave de la organización** (DEK), no la clave maestra directamente. La DEK es una llave propia de la organización, guardada envuelta (cifrada) por la clave maestra. Por eso se propone:

| Secreto | Hoy | Con 2C-1 `[PROPUESTA]` |
|---|---|---|
| Clave maestra | La tiene la API | **Solo** el servicio del operador y la CLI |
| Cuenta `auditor_api` (lectura de la base de control) | La tiene la API | **Se elimina** |
| Contraseña de la base de la organización | La API la descifra con la clave maestra | Archivo de secreto propio de la API |
| Llave de la organización (DEK) | La API la desenvuelve con la clave maestra | Archivo de secreto propio de la API, ya desenvuelto |
| Datos de la organización (id, slug, nombre) | Se leen de la base de control | Configuración de la API |

- **Por qué la DEK y no una llave nueva derivada:** los secretos MFA ya cifrados se siguen abriendo sin que nadie reconfigure su MFA. Además, la DEK solo abre datos de esta organización, que la API ya maneja. Una llave derivada nueva obligaría a reconfigurar la MFA y no reduce el alcance real. Hoy no hay usuarios reales, así que ambas opciones son posibles.
- **Nuevo comando** `auditor-admin api-secrets write`: escribe los dos archivos (contraseña y DEK) en el directorio de secretos con permisos restringidos. Lo usa la instalación, y también el cambio de contraseña: `auditor-admin tenant rotate-password` los reescribe.
- **Cambio de contraseña:** después de reescribir los secretos hay que **reiniciar la API**. Las sesiones no se pierden porque viven en la base, pero las peticiones en curso durante el reinicio (unos segundos) fallan. `[SUPUESTO: la duración se medirá en la prueba de humo]`
- **Suspensión de la organización.** La API ya no lee el estado en la base de control. Por eso suspender pasa a hacer dos cosas: quitar el permiso de conexión al usuario de la base (como hoy) y **cerrar sus conexiones abiertas**. La API falla de forma segura en la siguiente petición. Se prueba en PostgreSQL y SQL Server.
- R-33 se actualiza: el compromiso de la API ya no expone la clave maestra.

### 1.4 Bloqueo por cuenta y origen (mitigación de fondo de R-34)

**Hoy:** 5 fallos bloquean **la cuenta**, sin importar desde dónde vengan. Un atacante que conoce un correo puede impedir que esa persona entre.

**Propuesta `[PROPUESTA]`:**
- El bloqueo progresivo (hasta 15 min) se aplica al par **cuenta + origen** (IP, guardada como HMAC). Los fallos desde el equipo del atacante bloquean solo ese origen, y la persona sigue entrando desde el suyo.
- Se mantiene el límite por IP (20 intentos sensibles cada 5 min).
- **Contra el ataque distribuido** (muchos orígenes adivinando una misma contraseña):
  - la defensa principal es que la **MFA es ahora obligatoria para todos** (D-86): adivinar la contraseña no basta para entrar;
  - además, si una cuenta acumula muchos fallos desde orígenes distintos (umbral inicial: 20 en 1 hora `[ESTIMACIÓN]`, configurable), se registra un evento **`account.attack_suspected`** en la bitácora y se muestra al administrador en el registro de accesos (2C-2). No se bloquea la cuenta, para no recrear R-34.
- ~~El contador de MFA usa el mismo mecanismo de cuenta + origen.~~ **Modificado por D-89 (30-10-2026, hallazgo QA 2C1-04):** el contador de MFA (verificación del inicio de sesión y reautenticación) es **por cuenta**. Al 5.º código errado se bloquea la MFA de la cuenta desde cualquier origen, con la espera progresiva de D-82 y el desbloqueo de D-83 (API, CLI y restablecer la MFA). El de contraseña sigue por cuenta + origen. Con el conteo por origen, quien ya conocía la contraseña tenía 5 códigos por cada IP. Contar por cuenta no recrea R-34 para quien no conoce la contraseña (queda el residual R-38), porque llegar a la MFA exige la contraseña. Implementación: `2c1-registro.md` §7.
- Se conserva el desbloqueo por el administrador y por la CLI (D-83).
- **Datos personales:** el par se guarda con la IP en HMAC y se borra con la retención del registro de accesos (D-78).
- R-34 se reevalúa después de la verificación de QA.

### 1.5 Pruebas de la cookie (observaciones de QA, `2b-registro.md` §7)

- El token de sesión se agrega a la prueba de valores centinela, que comprueba que nunca aparece en la base.
- Una prueba de integración verifica la cabecera `Set-Cookie`: `HttpOnly`, `SameSite=Strict` y, con `COOKIE_SECURE=true`, `Secure` y el prefijo `__Host-`.

### 1.6 Perfil institucional con HTTPS (D-37; advierte R-35)

Nuevo archivo `deploy/compose/compose.institucional.yaml`, que se suma al perfil base:
- Caddy escucha en el puerto **443 de la red interna** (configurable). El perfil local sigue en `127.0.0.1:8080` sin cambios.
- Dos formas de obtener el certificado `[PROPUESTA]` (pregunta 4 de §6):
  - **a) el certificado de la propia institución** (archivos montados);
  - **b) la CA interna de Caddy:** sin Internet. Hay que instalar el certificado raíz en los equipos de los usuarios; la guía explica cómo.
- `COOKIE_SECURE` queda en `true`, su valor por defecto.
- Nueva guía `docs/fase-2/instalacion-institucional.md`, con la **advertencia de R-35**: fuera de `127.0.0.1` se debe usar HTTPS, porque sin él las contraseñas viajan sin cifrar por la red interna.
- La prueba de humo agrega un recorrido con este perfil usando la CA interna.

---

## 2. Parte 2C-2: pantallas de usuarios

### 2.1 Tecnología

| Pieza | Elección | Estado |
|---|---|---|
| Componentes | React Aria Components (Adobe) | Ya decidido en D-16. `[PENDIENTE: verificar versión y licencia (se espera Apache-2.0) al instalar]` |
| Datos del servidor | TanStack Query | Ya decidido en D-16. `[PENDIENTE: verificar licencia (se espera MIT)]` |
| Navegación entre pantallas | **React Router**, dependencia nueva `[PROPUESTA]` | `[PENDIENTE: verificar licencia (se espera MIT)]` |
| Código QR para configurar MFA | **qrcode**, dependencia nueva `[PROPUESTA]`. Genera el QR en el navegador, sin servicios externos | `[PENDIENTE: verificar licencia (se espera MIT)]` |
| Pruebas E2E | Playwright Test (D-39) | `[PENDIENTE: verificar licencia (se espera Apache-2.0)]` |
| Accesibilidad automática | axe-core con su integración para Playwright, solo para pruebas | `[PENDIENTE: verificar licencia (se espera MPL-2.0, permitida por check-licenses)]` |

Las licencias se confirman contra los metadatos del paquete al instalar. Si alguna no fuera compatible, se busca una alternativa y se informa.

### 2.2 Pantallas

| Pantalla | Quién | Notas |
|---|---|---|
| Inicio de sesión | Todos | Correo y contraseña. Mensaje único de error |
| Código MFA | Todos | Código de 6 dígitos o código de recuperación |
| Configurar MFA | Todos, la primera vez | Muestra el QR y la clave en texto para ingresarla a mano. Los **códigos de recuperación** se muestran **una sola vez**, con opción de descargarlos como archivo de texto |
| Activar cuenta | Invitados | Abierta desde el enlace de activación. Pide contraseña, con indicador de fortaleza, y luego obliga a configurar la MFA |
| Mi cuenta | Todos | Cambiar contraseña y cerrar sesión |
| Usuarios | Administrador | Lista con estado: activo, bloqueado, sin MFA, desactivado |
| Invitar usuario | Administrador | Muestra el **enlace de activación una sola vez**, con botón de copiar |
| Editar roles | Administrador | Explica por qué una combinación está prohibida (separación de funciones, D-79) |
| Desactivar, desbloquear y reiniciar MFA | Administrador | Piden confirmación y, si pasaron más de 5 min, el código MFA (reautenticación). **Modificado por D-92 (30-10-2026):** reiniciar la MFA invalida la contraseña y las sesiones de la persona y muestra **una sola vez** un enlace de activación (un solo uso, 24 h), igual que "Invitar usuario"; la persona fija una contraseña nueva y configura su MFA desde ese enlace (`2c2-api.md` §3.1) |
| Registro de accesos | Administrador | `[PROPUESTA]` Ver pregunta 3 de §6 |
| Exportar bitácora | Administrador | Ver §2.4 |
| Inicio | Todos | Página de bienvenida según el rol. Indica que las funciones de auditoría llegan en fases posteriores |

**Seguridad en el navegador:**
- **El enlace de activación lleva el token después de `#`** (`https://servidor/activar#<token>`). Esa parte de la URL no viaja al servidor, ni queda en los registros del proxy ni en la cabecera `Referer`.
- No se usa `localStorage` para nada sensible. El token anti-CSRF vive en memoria y se recupera con `GET /me` al recargar.
- La CSP actual de Caddy no cambia: sin scripts ni estilos en línea y sin recursos externos.
- Se avisa antes de que la sesión expire por inactividad, con opción de continuar.

**Idioma y redacción:** español de Chile, mensajes claros y sin jerga. Los errores dicen qué hacer, no solo qué falló.

### 2.3 Accesibilidad (WCAG 2.2 AA)

- Toda pantalla se puede usar solo con teclado y el foco siempre es visible.
- Los formularios tienen etiquetas y los errores se anuncian a los lectores de pantalla.
- El contraste cumple AA y no se usa solo el color para transmitir información.
- Se cumplen los criterios nuevos de 2.2 aplicables: **3.3.8 Autenticación accesible**, que permite pegar la contraseña y usar gestores de contraseñas, y **2.5.8 Tamaño del objetivo**.
- Las pruebas automáticas con axe-core corren en CI sobre cada pantalla y fallan ante cualquier infracción.

**Límite honesto:** las herramientas automáticas detectan solo una parte de los problemas de accesibilidad `[FUENTE SECUNDARIA: lo reconoce la propia documentación de axe-core; PENDIENTE citar]`. QA hará además una revisión manual con teclado y lector de pantalla (NVDA u Orca) sobre los flujos principales. El resultado se registrará como "probado automáticamente" y "revisado manualmente en X", nunca como "certificado WCAG".

### 2.4 Exportación de la bitácora

- `GET /api/v1/audit-log/export`: solo el administrador, con reautenticación MFA.
- El formato es JSON Lines con la cadena de hashes completa, **verificable con `auditor-log verify`** fuera de la plataforma.
- La IP aparece solo como HMAC, igual que en la bitácora.
- La exportación queda registrada en la bitácora (`audit_log.exported`).

### 2.5 Pruebas de 2C-2

- **E2E con Playwright** sobre Compose efímero:
  - activación → configurar MFA → inicio de sesión;
  - invitación → cambio de roles → desactivación;
  - bloqueo y desbloqueo;
  - expiración de la sesión;
  - exportación y verificación de la bitácora.
- **Permisos entre roles desde la interfaz:** cada rol ve solo lo que le corresponde. Que la interfaz oculte un botón no cuenta como control: la matriz de permisos de la API (2B) sigue siendo la que decide.
- **Accesibilidad:** axe-core en cada pantalla, más la revisión manual (§2.3).
- **ZAP baseline** contra el Compose efímero, que bloquea ante alertas altas (`09-seguridad.md`).

---

## 3. Parte 2C-3: consola del operador (D-85)

### 3.1 Arquitectura

```
Red interna de la institución
 ├── :443  Caddy ── SPA de usuarios ── API de usuarios (DEK + contraseña de la base, sin clave maestra)
 └── :8443 Caddy ── SPA del operador ── servicio del operador (clave maestra + cuenta de aprovisionamiento)
           (solo IP de la lista permitida)
```

- **Servicio separado** (`operator`): es un segundo punto de entrada de la imagen de la API, con sus propios módulos. Es **el único** que monta la clave maestra y la cuenta de aprovisionamiento, además de la CLI (D-85.1).
- **Interfaz separada:** un segundo paquete de la SPA, servido solo en el puerto del operador. La SPA de usuarios no contiene código del operador.
- **Lista de IP permitidas** (D-85.2), con defensa en dos capas:
  - Caddy rechaza las IP no permitidas antes de llegar al servicio;
  - el propio servicio lo vuelve a comprobar.
- **Lista vacía por defecto:** solo se puede entrar desde el propio servidor.

### 3.2 Cuentas de operador

- Nueva tabla `platform_operator` en la **base de control**, separada de los usuarios de la organización.
- Usa los mismos mecanismos de 2B: argon2id, TOTP con códigos de recuperación, bloqueo por cuenta y origen, CSRF y cabeceras.
- **MFA obligatoria** (D-86) y **reautenticación con código en cada acción crítica** (D-85.4), sin ventana de 5 min.
- Sesión más corta `[PROPUESTA]`: **15 min** de inactividad y **4 h** como máximo.
- **El primer operador** se crea con la CLI: `auditor-admin operator invite --email <correo>`, que imprime un enlace de activación.
- Cada operador tiene nombre propio. La bitácora registra `operador:<correo>` en vez de `operador-plataforma:cli` (D-85.3).
- No se puede desactivar al último operador activo con MFA.

### 3.3 Qué puede hacer el operador

| Función | Acción crítica (pide código) |
|---|---|
| Ver el estado de la instalación: versión, organización, salud de la base y verificación de la bitácora de control | No |
| Crear la organización, si aún no existe | Sí |
| Invitar a un administrador de la organización (recuperación si no queda ninguno) | Sí |
| Desbloquear a un usuario o reiniciar su MFA (recuperación). **Modificado por D-92:** el reinicio de MFA entrega un enlace de activación de un solo uso, no reabre la configuración de MFA a quien tenga la contraseña | Sí |
| Suspender o reactivar la organización | Sí |
| Cambiar la contraseña de la base de la organización y reescribir los secretos de la API (D-87) | Sí |
| Ver la bitácora de la plataforma (control) | No |
| Gestionar operadores: invitar y desactivar | Sí |

**El operador NO ve contenido de la organización** (C-09): ni usuarios con sus datos, ni roles, ni informes. Para desbloquear o reiniciar la MFA indica el correo. La acción queda en la bitácora de la organización con su nombre, y el administrador de la organización la ve.

**La CLI se mantiene** como vía de emergencia: por ejemplo, si se pierde el acceso de todos los operadores.

### 3.4 Pruebas de 2C-3

- Una IP fuera de la lista se rechaza en Caddy y en el servicio.
- La API de usuarios no tiene la clave maestra ni la cuenta de aprovisionamiento: se verifica inspeccionando los secretos montados en Compose.
- Cada acción crítica sin código reciente se rechaza.
- La bitácora registra al operador por su nombre.
- No se puede desactivar al último operador.
- E2E, axe-core y ZAP sobre la consola, igual que en 2C-2.

---

## 4. Riesgos nuevos o actualizados

| ID | Riesgo | Tratamiento propuesto |
|---|---|---|
| R-33 (actualizado) | Compromiso de la API | Sin la clave maestra (2C-1). El alcance queda en la propia organización |
| R-34 (actualizado) | Bloqueo de cuentas como denegación de servicio | Bloqueo por cuenta y origen (2C-1). Se reevalúa tras QA |
| **R-36 (nuevo)** | La consola del operador es el objetivo de mayor valor: tiene la clave maestra y la cuenta de aprovisionamiento | Servicio separado, lista de IP (vacía por defecto), MFA, código en cada acción, sesión corta, bitácora con nombre, sin acceso al contenido |
| **R-37 (nuevo)** | Accesibilidad declarada sin revisión manual suficiente | Revisión manual de QA registrada con su alcance. Nunca se declara "certificado" |

---

## 5. Lo que NO cambia

- Los roles, los permisos y la separación de funciones (D-79).
- La retención de la IP (D-78) y las reglas de bloqueo y registro (D-82).
- El perfil local de prueba sin HTTPS (D-81). La guía advierte R-35.
- La arquitectura de 2A: base de control y base propia de la organización (D-84).

---

## 6. Preguntas para el responsable

| # | Pregunta | Recomendación |
|---|---|---|
| 1 | ¿2C en tres partes con aprobación separada (§0)? | **Sí.** Revisiones más pequeñas y un punto de control en cada parte |
| 2 | ¿La API recibe la llave de la organización (DEK) en vez de una llave derivada nueva (§1.3)? | **Sí, la DEK.** Nadie reconfigura su MFA y el alcance es el mismo |
| 3 | ¿El administrador ve el registro de accesos (intentos, bloqueos y alertas de ataque, con la IP) en una pantalla de solo lectura (§2.2)? | **Sí,** con reautenticación. Es la forma de investigar un ataque como R-34. La IP ya se guarda con ese fin (D-78) |
| 4 | ¿El perfil institucional admite tanto el certificado propio de la institución como la CA interna de Caddy (§1.6)? | **Sí, ambos.** Así funciona en instituciones con y sin infraestructura de certificados |
| 5 | ¿Las nuevas dependencias React Router y qrcode (§2.1)? | **Sí,** sujeto a verificar que su licencia sea compatible |
