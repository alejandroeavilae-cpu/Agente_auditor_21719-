# Fase 2 · Entrega 2C-2: contrato de la API para las pantallas

- **Para:** el agente frontend de 2C-2 (pantallas de `2c-diseno.md` §2.2).
- **Estado:** `[DISEÑADO]` `[IMPLEMENTADO]` `[PROBADO en PostgreSQL 16 local]`. `[PENDIENTE: CI con PostgreSQL 18 y SQL Server, verificación QA independiente y aprobación del responsable]`.
- **Por qué este archivo:** el proyecto no genera OpenAPI todavía `[VERIFICADO: no hay dependencias ni código OpenAPI/Swagger en el repositorio, 30-10-2026]`. Este documento es el contrato; si se agrega OpenAPI en una fase posterior, debe coincidir con él.
- **Detalle de implementación y pruebas:** `2c2-registro.md`.

Se documentan **solo** los endpoints nuevos o cambiados en 2C-2. Los de 2B y 2C-1 (inicio de sesión, MFA, activación, invitación, roles, desactivación, desbloqueo) no cambian su forma salvo lo indicado en §2 y §3. **El reinicio de MFA sí cambia (D-92, §3.1).**

## 0. Reglas comunes

| Tema | Regla |
|---|---|
| Sesión | Cookie `HttpOnly`, `SameSite=Strict`; `__Host-auditor_session` con HTTPS. La SPA no la lee ni la toca |
| Anti-CSRF | Toda petición que no sea `GET`/`HEAD`/`OPTIONS` lleva `X-CSRF-Token: <csrfToken>`. El token llega en las respuestas de inicio de sesión, MFA, activación y cambio de contraseña, y en `GET /api/v1/auth/me`. Se guarda **en memoria**, nunca en `localStorage` (2C §2.2) |
| Errores | Siempre `{ "error": "<código>", "message": "<texto en español apto para mostrar>" }`. Errores de validación: `400 invalid_request`, con `fields` (rutas de los campos) |
| Alto riesgo | Rutas marcadas "MFA reciente": si la última verificación MFA tiene más de 5 min, responden `403 reauth_required`. La interfaz pide el código, llama `POST /api/v1/auth/reauth { code }` (204) y repite la acción |
| Autorización | Ocultar un botón **no** es un control: la API vuelve a decidir en cada ruta (`403 forbidden`). `permissions` de `/me` sirve solo para no mostrar opciones inútiles |
| Etapas | `mfa_pending`, `mfa_enroll`, `password_change` (nueva, §3), `full`. Una ruta que no admite la etapa responde `403` con `mfa_required`, `mfa_enrollment_required` o `password_change_required` |
| Límite de tasa | `429 rate_limited` (general: 600/min por IP; intentos sensibles: 20 cada 5 min por IP, configurable) |
| Base no disponible | `503 unavailable` (organización suspendida o base caída). Mostrar el mensaje tal cual |

## 1. `GET /api/v1/auth/me` (cambiado)

Estado de la sesión al cargar o recargar la SPA. **Renueva la inactividad**: no usarlo para sondear (eso mantendría la sesión viva sin la persona).

- **Política:** sesión en cualquier etapa. Sin permiso específico.
- **Respuesta 200, etapas distintas de `full`** (`mfa_pending`, `mfa_enroll`, `password_change`): solo lo necesario para continuar el flujo; ningún dato del usuario (QA 2B-07):

```json
{
  "organization": { "slug": "muni-sintetica", "name": "Municipalidad Sintética" },
  "stage": "password_change",
  "csrfToken": "<64 hex>",
  "session": { "expiresAt": "2026-10-30T12:10:00.000Z" }
}
```

- **Respuesta 200, etapa `full`:**

```json
{
  "organization": { "slug": "muni-sintetica", "name": "Municipalidad Sintética" },
  "stage": "full",
  "csrfToken": "<64 hex>",
  "session": {
    "expiresAt": "2026-10-31T00:00:00.000Z",
    "idleExpiresAt": "2026-10-30T12:30:00.000Z",
    "reauthValidUntil": "2026-10-30T12:05:00.000Z"
  },
  "user": { "id": "<uuid>", "email": "persona@ejemplo.cl", "displayName": "Persona Sintética", "mfaEnabled": true },
  "roles": [{ "id": "org_admin", "label": "Administrador de organización" }],
  "permissions": ["access_log.read", "audit_log.export", "reports.read", "users.manage", "users.read"]
}
```

| Campo nuevo | Uso en la interfaz |
|---|---|
| `session.expiresAt` | Vencimiento absoluto (12 h en `full`, 10 min en etapas previas) |
| `session.idleExpiresAt` | Vence por inactividad (30 min desde la última petición). Para el aviso "su sesión está por expirar" (2C §2.2): contar desde aquí en el cliente. "Continuar" = cualquier petición autenticada (p. ej. `GET /me`) |
| `session.reauthValidUntil` | Hasta cuándo no se pedirá el código para acciones de alto riesgo; `null` si no hay verificación. Permite pedir el código **antes** de la acción en vez de esperar `reauth_required` |
| `permissions` | Permisos efectivos, ordenados. Valores posibles hoy: `users.read`, `users.manage`, `access_log.read`, `audit_log.export`, `audits.authorize`, `audits.run`, `findings.review`, `controls.legal_decision`, `remediation.manage`, `reports.read` |

**Errores:** `401 unauthenticated`, `401 session_expired`, `503 unavailable`.

## 2. `GET /api/v1/users` (cambiado: estado de bloqueo, R-38)

- **Política:** sesión `full`, permiso `users.read` (solo Administrador de organización). Sin MFA reciente.
- **Respuesta 200:**

```json
{
  "users": [
    {
      "id": "<uuid>",
      "email": "persona@ejemplo.cl",
      "displayName": "Persona Sintética",
      "status": "active",
      "roles": ["reader"],
      "mfaEnabled": true,
      "passwordLock": { "lockedOrigins": 2, "lockedUntil": "2026-10-30T12:01:00.000Z" },
      "mfaLock": { "locked": true, "lockedUntil": "2026-10-30T12:00:30.000Z", "failedAttempts": 5 },
      "passwordCompromiseSuspected": true,
      "mustChangePassword": false,
      "mfaResetPending": false
    }
  ]
}
```

| Campo | Significado | Qué mostrar `[PROPUESTA para el frontend]` |
|---|---|---|
| `status` | `invited`, `active`, `disabled` | "Invitado", "Activo", "Desactivado" |
| `mfaEnabled` | Tiene la MFA configurada | Si es `false` y `status = active`: "Sin MFA" |
| `passwordLock.lockedOrigins` | Orígenes (IP) con bloqueo de contraseña **vigente** (D-88). Suelen ser de alguien que **no** conoce la contraseña | "Bloqueado en N origen(es)". Aclarar que la persona puede seguir entrando desde su equipo |
| `passwordLock.lockedUntil` | El vencimiento más lejano entre esos orígenes, o `null` | Hora de fin |
| `mfaLock.locked` / `lockedUntil` | Bloqueo de MFA **vigente** de la cuenta (D-89) | "MFA bloqueada hasta …" |
| `mfaLock.failedAttempts` | Códigos errados desde el último éxito, desbloqueo o restablecimiento | No es necesario mostrarlo |
| `passwordCompromiseSuspected` | `true` si la cuenta llegó a 5 códigos MFA errados y no hubo éxito, desbloqueo ni restablecimiento después. **Llegar a la MFA exige la contraseña correcta**: alguien la conoce (R-38). Sigue en `true` aunque la espera haya vencido | **Aviso destacado** (no solo color): "Alguien que conoce la contraseña de esta cuenta intentó adivinar su código. Contacte a la persona por otro medio. Al desbloquear, deberá cambiar su contraseña." |
| `mustChangePassword` | La persona deberá cambiar su contraseña en su próximo ingreso (§3) | "Debe cambiar su contraseña" |
| `mfaResetPending` | Se reinició su MFA (D-92) y aún no usa el enlace: su contraseña anterior no sirve y solo puede entrar con el enlace | "Reinicio pendiente: entregue el enlace o reinicie de nuevo si se perdió o venció" |

**"Bloqueado"** en la lista de 2C §2.2 = `passwordLock.lockedOrigins > 0` **o** `mfaLock.locked`. El contrato entrega los datos por separado porque el significado es distinto (contraseña: probable tercero sin la contraseña; MFA: contraseña comprometida). La API no entrega un estado combinado: la interfaz lo deduce con esa regla.

**Errores:** `403 forbidden` (sin `users.read`), los comunes.

## 3. Cambio de contraseña obligatorio (R-38): etapa `password_change`

**Regla `[DECISIÓN técnica 2C-2, D-93]`:** si `POST /api/v1/users/:id/unlock` (o `auditor-admin user unlock`) levanta un **bloqueo de MFA** (contador de MFA en 5 o más), la cuenta queda con `mustChangePassword = true`. Desbloquear un bloqueo **solo de contraseña** no lo hace. (El reinicio de MFA ya no usa esta marca: desde D-92 invalida la contraseña directamente, §3.1.)

La respuesta de `unlock` **no cambia** (204 sin cuerpo): tras la acción, la interfaz vuelve a pedir `GET /api/v1/users` y muestra `mustChangePassword`.

Flujo de la persona afectada:

1. `POST /api/v1/auth/login` → `{ stage: "mfa_pending" }`.
2. `POST /api/v1/auth/mfa/verify` → `{ stage: "password_change", csrfToken }` en vez de `full`. (Si en esa etapa se llegara por `mfa/confirm`, la respuesta sigue entregando `recoveryCodes`, que **deben mostrarse**.)
3. En esta etapa **solo** se admiten: `POST /api/v1/auth/password`, `GET /api/v1/auth/me`, `POST /api/v1/auth/logout`. Cualquier otra ruta: `403 password_change_required`.
4. `POST /api/v1/auth/password { currentPassword, newPassword }` → `200 { stage: "full", csrfToken }`. Cierra todas las demás sesiones de la persona.

Una sesión `full` **ya abierta** de la persona pasa a comportarse como `password_change` desde el momento del desbloqueo (`/me` informa `stage: "password_change"`).

**Cambio en `POST /api/v1/auth/password` (para todos, no solo en esta etapa):** la nueva contraseña debe ser distinta de la actual → `400 password_reused` ("La nueva contraseña debe ser distinta de la actual."). Los demás errores no cambian: `401 invalid_credentials` (contraseña actual incorrecta o bloqueo de ese origen), `400 weak_password`.

Pantalla sugerida `[PROPUESTA]`: "Cambiar contraseña" con explicación ("Por seguridad, la administración le pide cambiar su contraseña antes de continuar"), mismos campos e indicador de fortaleza que "Mi cuenta".

## 3.1 `POST /api/v1/users/:id/mfa/reset` (cambiado por D-92): reinicio con enlace de un solo uso

Antes (2B): 204 sin cuerpo, y el siguiente inicio de sesión con la contraseña abría la configuración de MFA a quien la conociera. **Desde D-92** funciona como una invitación.

- **Política:** sesión `full`, permiso `users.manage`, **MFA reciente**, `X-CSRF-Token`. Sin cuerpo.
- **Efecto, en una sola transacción:** invalida la contraseña actual (deja de servir para iniciar sesión), borra el secreto MFA y los códigos de recuperación, revoca **todas** las sesiones de la persona, levanta sus bloqueos de contraseña y MFA y reemplaza cualquier enlace anterior por uno nuevo (un solo uso, vence en 24 h).
- **Respuesta 200** (el token se entrega **una sola vez**; no se puede volver a consultar):

```json
{ "activationToken": "<43 caracteres base64url>", "expiresAt": "2026-10-31T12:00:00.000Z" }
```

- **Interfaz `[PROPUESTA]`:** igual que "Invitar usuario": mostrar el enlace `https://<servidor>/activar#<activationToken>` una vez, con botón de copiar y el aviso de entregarlo por un canal seguro y verificar la identidad de la persona por otro medio (sobre todo si `passwordCompromiseSuspected` era verdadero). Tras la acción, refrescar `GET /api/v1/users` (`mfaResetPending: true`).
- **Errores:** `409 self_mfa_reset` (nadie se reinicia a sí mismo), `409 user_not_active` (invitado o desactivado), `409 last_admin` (dejaría la organización sin administrador activo con MFA; p. ej. dos administradores que se reinician mutuamente a la vez), `409 conflict` (cambio simultáneo; reintentar), `404 user_not_found`, `403 reauth_required`, `403 forbidden`.
- **Bitácora:** `user.mfa.reset` con `passwordInvalidated: true` y el vencimiento del enlace, **sin** el token.
- **Sin equivalente en la CLI** `[VERIFICADO: auditor-admin no tiene un comando de reinicio de MFA]`. Si no queda ningún administrador con MFA, la recuperación es `auditor-admin user invite-admin`.

### Activación tras el reinicio: `POST /api/v1/auth/activate` (sin cambios de forma)

La persona usa el mismo endpoint y la misma pantalla que un invitado: `{ token, password }` → `200 { stage: "mfa_enroll", csrfToken }`, luego `mfa/enroll` y `mfa/confirm` → `full` (con sus 10 códigos de recuperación nuevos). Diferencias para una cuenta reiniciada:

- **No acepta la contraseña anterior:** `400 password_reused` ("La nueva contraseña debe ser distinta de la anterior."), sin consumir el enlace.
- Levanta `mustChangePassword` si estaba marcado (ya fija una contraseña nueva).
- Mientras el reinicio esté pendiente, `POST /auth/login` con la contraseña anterior responde el `401 invalid_credentials` genérico, sin cookie ni `mfa_pending`.
- Errores como siempre: `400 invalid_token` (enlace usado, reemplazado por un reinicio posterior o vencido), `400 weak_password`.

## 4. `GET /api/v1/access-log` (nuevo): registro de accesos

Pantalla "Registro de accesos" (pregunta 3 de 2C §6, D-88). Solo lectura.

- **Política:** sesión `full`, permiso `access_log.read` (solo Administrador de organización), **MFA reciente** (cada página: si pasaron 5 min, `reauth_required`).
- **Parámetros de consulta** (todos opcionales; cualquier otro parámetro, o uno repetido, da `400 invalid_request`):

| Parámetro | Formato | Notas |
|---|---|---|
| `limit` | Entero 1–100 | Por defecto 50 |
| `cursor` | Texto opaco | El `nextCursor` de la página anterior. No construirlo ni modificarlo. Inválido → `400 invalid_cursor` (volver a la primera página) |
| `event` | Uno o más nombres separados por coma (máx. 20) | Nombre exacto, ver tabla de eventos |
| `userId` | UUID | Eventos de ese usuario |
| `from` | Fecha ISO 8601 UTC con `Z` (p. ej. `2026-10-30T00:00:00Z`) | Desde, inclusive |
| `to` | Igual | Hasta, exclusive. Debe ser posterior a `from` |

- **Orden:** del más reciente al más antiguo.
- **Respuesta 200:**

```json
{
  "events": [
    {
      "id": "<uuid>",
      "ts": "2026-10-30T11:59:58.123Z",
      "event": "auth.account.locked",
      "userId": "<uuid o null>",
      "userEmail": "persona@ejemplo.cl",
      "ip": "198.51.100.7",
      "uaFamily": "Firefox"
    }
  ],
  "nextCursor": "<texto opaco o null>"
}
```

| Campo | Notas |
|---|---|
| `userId` / `userEmail` | `null` en intentos con un correo que no existe (no se guarda el correo intentado, solo su HMAC en la bitácora) y en eventos sin usuario. `userEmail` es el correo **actual** del usuario |
| `ip` | **IP en claro** (D-78; retención de 90 días por defecto, se purga sola). `null` en eventos del sistema (p. ej. `account.attack_suspected`) |
| `uaFamily` | `Edge`, `Firefox`, `Chrome`, `Safari`, `curl`, `otro` o `null`. Nunca el agente de usuario completo |

**Eventos que pueden aparecer** (nombres exactos, para el filtro):

| Grupo `[PROPUESTA de agrupación para la interfaz]` | Eventos |
|---|---|
| Alertas | `account.attack_suspected` (posible ataque distribuido, R-34), `auth.account.locked` (bloqueo de contraseña de un origen o de la MFA de la cuenta) |
| Intentos fallidos | `auth.login.failed`, `auth.mfa.failed`, `auth.reauth.failed`, `auth.password.change_failed` |
| Intentos durante un bloqueo (no se verifican) | `auth.login.blocked`, `auth.mfa.blocked`, `auth.reauth.blocked`, `auth.password.change_blocked` |
| Ingresos | `auth.login.password_ok`, `auth.login.succeeded`, `auth.mfa.recovery_used`, `auth.reauth.succeeded`, `auth.logout` |
| Cuenta | `auth.mfa.enabled`, `auth.password.changed`, `user.activated` |
| Administración (hechas desde la web) | `user.invited`, `user.roles.changed`, `user.deactivated`, `user.unlocked`, `user.mfa.reset`, `audit_log.exported` |

Las acciones hechas con la CLI (`auditor-admin`) no tienen IP y no aparecen aquí; sí en la bitácora.

**Efecto:** cada consulta queda en la **bitácora** como `access_log.viewed` (quién, filtros, primera o siguiente página, cantidad devuelta; la IP de quien consulta solo como HMAC). No se anota en el registro de accesos.

**Errores:** `400 invalid_request`, `400 invalid_cursor`, `403 forbidden`, `403 reauth_required`, los comunes.

## 5. `GET /api/v1/audit-log/export` (nuevo): exportar la bitácora

Pantalla "Exportar bitácora" (2C §2.4).

- **Política:** sesión `full`, permiso `audit_log.export` (solo Administrador de organización), **MFA reciente**.
- **Parámetros:** ninguno (cualquier parámetro → `400 invalid_request`).
- **Respuesta 200:** descarga en streaming.

| Cabecera | Valor |
|---|---|
| `Content-Type` | `application/x-ndjson; charset=utf-8` |
| `Content-Disposition` | `attachment; filename="bitacora-<slug>-<AAAAMMDDTHHMMSSZ>.jsonl"` |
| `Cache-Control` | `no-store` |
| `X-Audit-Chain-Id` | `<slug>` de la organización: el valor de `--chain-id` para verificar |

- **Cuerpo:** JSON Lines, una entrada por línea en forma canónica, con la cadena de hashes completa. La IP aparece solo como `ipHmac`. La **última línea** es la propia exportación (`audit_log.exported`).
- **Verificación fuera de la plataforma** (texto sugerido para la pantalla):

```
auditor-log verify --entries bitacora-<slug>-<fecha>.jsonl --chain-id <slug>
```

Resultado esperado: `RESULTADO: bitácora íntegra.` (código de salida 0). Con anclajes externos se agrega `--anchors … --public-key …` (ver `auditor-log --help`).

**Cómo descargar desde la SPA `[PROPUESTA]`:** como es un `GET` sin efectos de CSRF y la cookie es `SameSite=Strict`, basta un enlace o `window.location` en el mismo origen después de confirmar la MFA reciente (`reauthValidUntil` de `/me`). Si se usa `fetch` + `Blob`, leer el nombre desde `Content-Disposition`. Si la respuesta es `403` con JSON, mostrar el mensaje (p. ej. `reauth_required`).

**Errores (antes de empezar la descarga, en JSON):** `400 invalid_request`, `403 forbidden`, `403 reauth_required`, los comunes. Si la conexión se corta **durante** la descarga, el archivo queda incompleto y la verificación lo detecta; la interfaz debería sugerir repetir la exportación.

## 6. Resumen de permisos (matriz de 2B ampliada)

| Ruta | Etapa | Permiso | MFA reciente | CSRF |
|---|---|---|---|---|
| `GET /api/v1/auth/me` | todas | — | no | no (GET) |
| `POST /api/v1/auth/password` | `password_change`, `full` | — | no | sí |
| `POST /api/v1/auth/logout` | todas | — | no | sí |
| `POST /api/v1/auth/activate` | sin sesión | — | no | no (pública) |
| `POST /api/v1/users/:id/mfa/reset` | `full` | `users.manage` | **sí** | sí |
| `GET /api/v1/users` | `full` | `users.read` | no | no (GET) |
| `GET /api/v1/access-log` | `full` | `access_log.read` | **sí** | no (GET) |
| `GET /api/v1/audit-log/export` | `full` | `audit_log.export` | **sí** | no (GET) |

`access_log.read` y `audit_log.export` los tiene **solo** `org_admin` (prueba de la matriz en `packages/identity/test/identity.test.ts`).
