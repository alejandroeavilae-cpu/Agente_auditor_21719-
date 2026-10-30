// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

// zod 4 compila validadores con `new Function` si el entorno lo permite y, para saberlo,
// prueba crear una función. La CSP (`script-src 'self'`, sin 'unsafe-eval') lo bloquea y
// el navegador informa una infracción aunque zod capture el error. El modo `jitless` evita
// la prueba y la compilación (validación interpretada, misma semántica). Hallazgo de las
// pruebas E2E de 2C-2.
z.config({ jitless: true });

/**
 * Cliente HTTP de la SPA hacia la API (`docs/fase-2/2c2-api.md`).
 *
 * Reglas de seguridad del navegador (2C §2.2):
 * - la cookie de sesión es `HttpOnly`: la SPA nunca la lee; se envía con
 *   `credentials: 'same-origin'`;
 * - el token anti-CSRF vive SOLO en memoria (esta variable de módulo). Al recargar se pierde
 *   y se recupera con `GET /auth/me`. Nunca se guarda en `localStorage` ni `sessionStorage`;
 * - toda petición con efecto (no GET/HEAD) lleva `X-CSRF-Token`.
 */

/** Error de la API con su código estable y un mensaje apto para mostrar. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Forma de los errores de la API: `{ error, message, fields? }`. */
const errorBodySchema = z.object({
  error: z.string().min(1).max(100),
  message: z.string().min(1).max(2000),
  fields: z.array(z.string().max(200)).max(100).optional(),
});

const NETWORK_MESSAGE = 'No fue posible conectar con el servidor. Revise su conexión e intente nuevamente.';
const UNEXPECTED_MESSAGE = 'El servidor respondió de forma inesperada. Intente nuevamente; si el problema continúa, avise a la administración.';

// ---------- Token anti-CSRF (solo en memoria) ----------

let csrfToken: string | null = null;

/** Guarda el token anti-CSRF recibido de la API (inicio de sesión, MFA, activación o `/me`). */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Solo para pruebas y diagnóstico: indica si hay un token en memoria (nunca lo devuelve). */
export function hasCsrfToken(): boolean {
  return csrfToken !== null;
}

// ---------- Observadores de sesión ----------

/**
 * Ganchos que instala el proveedor de sesión. Se mantienen fuera de React para que cualquier
 * llamada (consultas, mutaciones, descargas) los dispare de la misma forma.
 */
export interface SessionHooks {
  /** La API dijo que no hay sesión o que expiró (`401 unauthenticated` / `session_expired`). */
  onUnauthenticated?: (code: 'unauthenticated' | 'session_expired') => void;
  /** La sesión está en otra etapa (p. ej. el administrador obligó a cambiar la contraseña). */
  onStageMismatch?: (code: StageErrorCode) => void;
  /**
   * Una petición autenticada llegó al servidor y renovó la inactividad. `serverDate` es la
   * cabecera `Date` de la respuesta (reloj del servidor), o `null` si no vino.
   */
  onActivity?: (serverDate: number | null) => void;
}

export type StageErrorCode = 'mfa_required' | 'mfa_enrollment_required' | 'password_change_required';
const STAGE_ERRORS = new Set<string>(['mfa_required', 'mfa_enrollment_required', 'password_change_required']);

let hooks: SessionHooks = {};

export function installSessionHooks(next: SessionHooks): () => void {
  hooks = next;
  return () => {
    if (hooks === next) hooks = {};
  };
}

// ---------- Peticiones ----------

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Ruta pública (inicio de sesión, activación, versión): un 401 es un resultado del
   * formulario (p. ej. credenciales incorrectas), no una sesión perdida.
   */
  isPublic?: boolean;
}

/** Lee la cabecera `Date` (reloj del servidor) como milisegundos, o `null`. */
export function serverDateOf(res: Response): number | null {
  const header = res.headers.get('Date');
  if (header === null) return null;
  const ms = Date.parse(header);
  return Number.isNaN(ms) ? null : ms;
}

/** Convierte una respuesta de error en `ApiError` sin confiar en su forma. */
async function errorFrom(res: Response): Promise<ApiError> {
  let parsed: z.infer<typeof errorBodySchema> | null = null;
  try {
    const result = errorBodySchema.safeParse(await res.json());
    if (result.success) parsed = result.data;
  } catch {
    parsed = null;
  }
  if (parsed === null) return new ApiError(res.status, res.status === 404 ? 'not_found' : 'unexpected', UNEXPECTED_MESSAGE);
  return new ApiError(res.status, parsed.error, parsed.message, parsed.fields ?? []);
}

/**
 * Hace una petición a la API y devuelve la respuesta exitosa (2xx). Cualquier otro caso
 * termina en `ApiError`. Notifica a la sesión la actividad, la expiración y los cambios de etapa.
 */
export async function apiFetch(path: string, options: RequestOptions = {}): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken !== null) headers['X-CSRF-Token'] = csrfToken;
  const init: RequestInit = { method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error' };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal !== undefined) init.signal = options.signal;
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network', NETWORK_MESSAGE);
  }
  if (res.ok) {
    if (options.isPublic !== true) hooks.onActivity?.(serverDateOf(res));
    return res;
  }
  const error = await errorFrom(res);
  if (options.isPublic !== true) {
    if (res.status === 401 && (error.code === 'unauthenticated' || error.code === 'session_expired')) {
      hooks.onUnauthenticated?.(error.code);
    } else if (res.status === 403 && STAGE_ERRORS.has(error.code)) {
      hooks.onStageMismatch?.(error.code as StageErrorCode);
    } else if (res.status !== 429 && res.status !== 0) {
      // La API ya resolvió la sesión (y renovó la inactividad) antes de rechazar por CSRF,
      // permiso o MFA reciente (`guard.ts`): también cuenta como actividad.
      hooks.onActivity?.(serverDateOf(res));
    }
  }
  throw error;
}

/** Petición que devuelve JSON validado con zod (la interfaz no confía en la forma recibida). */
export async function apiJson<T>(path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
  const res = await apiFetch(path, options);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, 'bad_response', UNEXPECTED_MESSAGE);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiError(res.status, 'bad_response', UNEXPECTED_MESSAGE);
  return parsed.data;
}

/** Petición sin cuerpo de respuesta (204). */
export async function apiVoid(path: string, options: RequestOptions = {}): Promise<void> {
  await apiFetch(path, options);
}

/** Mensaje para mostrar a partir de cualquier error. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return UNEXPECTED_MESSAGE;
}

export function isApiError(error: unknown, code?: string): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}
