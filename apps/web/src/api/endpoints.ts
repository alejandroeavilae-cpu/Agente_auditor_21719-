// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';
import { apiFetch, apiJson, apiVoid, ApiError, setCsrfToken, serverDateOf } from './http.js';
import {
  aboutSchema,
  accessLogPageSchema,
  activationLinkSchema,
  confirmSchema,
  enrollSchema,
  issuedSessionSchema,
  meSchema,
  usersSchema,
  type AccessLogPage,
  type ActivationLink,
  type Enrollment,
  type IssuedSession,
  type Me,
  type UserListItem,
} from './schemas.js';

/**
 * Funciones tipadas para cada endpoint usado por las pantallas de 2C-2. Las que emiten una
 * sesión guardan de inmediato el token anti-CSRF en memoria.
 */

const AUTH = '/api/v1/auth';

function keep(issued: IssuedSession): IssuedSession {
  setCsrfToken(issued.csrfToken);
  return issued;
}

export async function login(email: string, password: string): Promise<IssuedSession> {
  return keep(await apiJson(`${AUTH}/login`, issuedSessionSchema, { method: 'POST', body: { email, password }, isPublic: true }));
}

/** Verifica la MFA con un código TOTP de 6 dígitos o con un código de recuperación. */
export async function verifyMfa(input: { code: string } | { recoveryCode: string }): Promise<IssuedSession> {
  // Un código errado responde 401 `invalid_code`: es un resultado del formulario, no una
  // sesión perdida. La sesión vencida responde `session_expired` y sí se trata como tal.
  return keep(await apiJson(`${AUTH}/mfa/verify`, issuedSessionSchema, { method: 'POST', body: input }));
}

export async function enrollMfa(): Promise<Enrollment> {
  return apiJson(`${AUTH}/mfa/enroll`, enrollSchema, { method: 'POST', body: {} });
}

export async function confirmMfa(code: string): Promise<IssuedSession & { recoveryCodes: string[] }> {
  const res = await apiJson(`${AUTH}/mfa/confirm`, confirmSchema, { method: 'POST', body: { code } });
  setCsrfToken(res.csrfToken);
  return res;
}

export async function reauth(code: string): Promise<void> {
  await apiVoid(`${AUTH}/reauth`, { method: 'POST', body: { code } });
}

export async function activate(token: string, password: string): Promise<IssuedSession> {
  return keep(await apiJson(`${AUTH}/activate`, issuedSessionSchema, { method: 'POST', body: { token, password }, isPublic: true }));
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<IssuedSession> {
  return keep(await apiJson(`${AUTH}/password`, issuedSessionSchema, { method: 'POST', body: { currentPassword, newPassword } }));
}

export async function logout(): Promise<void> {
  try {
    await apiVoid(`${AUTH}/logout`, { method: 'POST', isPublic: true });
  } finally {
    setCsrfToken(null);
  }
}

/** Resultado de `/me` junto con la hora del servidor, para calcular la expiración sin depender del reloj local. */
export interface MeResult {
  me: Me;
  serverDate: number | null;
  receivedAt: number;
}

/**
 * Estado de la sesión. **Renueva la inactividad**: no se usa para sondear (2c2-api.md §1).
 * Devuelve `null` si no hay sesión (401).
 */
export async function fetchMe(): Promise<MeResult | null> {
  let res: Response;
  try {
    res = await apiFetch(`${AUTH}/me`, { isPublic: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
  const parsed = meSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ApiError(res.status, 'bad_response', 'El servidor respondió de forma inesperada. Intente nuevamente.');
  setCsrfToken(parsed.data.csrfToken);
  return { me: parsed.data, serverDate: serverDateOf(res), receivedAt: Date.now() };
}

export async function fetchUsers(): Promise<UserListItem[]> {
  return (await apiJson('/api/v1/users', usersSchema)).users;
}

export async function inviteUser(input: { email: string; displayName: string; roles: string[] }): Promise<ActivationLink> {
  return apiJson('/api/v1/users/invitations', activationLinkSchema, { method: 'POST', body: input });
}

export async function setUserRoles(userId: string, roles: string[]): Promise<void> {
  await apiVoid(`/api/v1/users/${encodeURIComponent(userId)}/roles`, { method: 'PATCH', body: { roles } });
}

export async function deactivateUser(userId: string): Promise<void> {
  await apiVoid(`/api/v1/users/${encodeURIComponent(userId)}/deactivate`, { method: 'POST' });
}

export async function unlockUser(userId: string): Promise<void> {
  await apiVoid(`/api/v1/users/${encodeURIComponent(userId)}/unlock`, { method: 'POST' });
}

/** Reinicio de MFA con enlace de un solo uso (D-92). */
export async function resetUserMfa(userId: string): Promise<ActivationLink> {
  return apiJson(`/api/v1/users/${encodeURIComponent(userId)}/mfa/reset`, activationLinkSchema, { method: 'POST' });
}

export interface AccessLogQuery {
  limit?: number;
  cursor?: string | null;
  events?: readonly string[];
  userId?: string | null;
  from?: string | null;
  to?: string | null;
}

/** Arma la consulta sin parámetros vacíos: la API rechaza parámetros repetidos o desconocidos. */
export function accessLogSearch(query: AccessLogQuery): string {
  const params = new URLSearchParams();
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.events !== undefined && query.events.length > 0) params.set('event', query.events.join(','));
  if (query.userId) params.set('userId', query.userId);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

export async function fetchAccessLog(query: AccessLogQuery, signal?: AbortSignal): Promise<AccessLogPage> {
  return apiJson(`/api/v1/access-log${accessLogSearch(query)}`, accessLogPageSchema, signal === undefined ? {} : { signal });
}

export interface AuditExport {
  blob: Blob;
  fileName: string;
  chainId: string;
}

/** Nombre del archivo desde `Content-Disposition` (solo caracteres seguros). */
export function fileNameFromDisposition(header: string | null, fallback: string): string {
  const match = header === null ? null : /filename="([^"]+)"/.exec(header);
  const name = match?.[1];
  return name !== undefined && /^[A-Za-z0-9._-]{1,200}$/.test(name) ? name : fallback;
}

/**
 * Descarga la bitácora completa (JSON Lines). Se usa `fetch` y no un enlace para poder
 * reaccionar a `403 reauth_required` (JSON) pidiendo el código y reintentando.
 */
export async function exportAuditLog(): Promise<AuditExport> {
  const res = await apiFetch('/api/v1/audit-log/export');
  const chainId = z.string().regex(/^[a-z0-9-]{1,30}$/).safeParse(res.headers.get('X-Audit-Chain-Id'));
  if (!chainId.success) throw new ApiError(res.status, 'bad_response', 'La exportación no indicó la cadena de la bitácora. Repita la exportación.');
  let blob: Blob;
  try {
    blob = await res.blob();
  } catch {
    throw new ApiError(0, 'export_interrupted', 'La descarga se interrumpió y el archivo quedaría incompleto. Repita la exportación.');
  }
  return { blob, chainId: chainId.data, fileName: fileNameFromDisposition(res.headers.get('Content-Disposition'), `bitacora-${chainId.data}.jsonl`) };
}

export async function fetchAbout(signal?: AbortSignal): Promise<z.infer<typeof aboutSchema>> {
  return apiJson('/api/v1/about', aboutSchema, signal === undefined ? { isPublic: true } : { isPublic: true, signal });
}
