// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Formato de fechas en español de Chile, en la zona horaria del equipo de quien mira (la
 * institución opera en Chile; la API entrega UTC). Se muestra la zona para no confundir.
 */
const dateTime = new Intl.DateTimeFormat('es-CL', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});

export function formatDateTime(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? iso : dateTime.format(ms);
}

/**
 * Convierte una fecha `AAAA-MM-DD` de un campo de fecha (hora local, inicio del día) al ISO
 * UTC con `Z` que exige el registro de accesos. Devuelve `null` si está vacía o es inválida.
 */
export function localDateToUtcIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Igual que `localDateToUtcIso`, pero al inicio del día siguiente (para un "hasta" inclusivo). */
export function localDateEndToUtcIso(value: string): string | null {
  const start = localDateToUtcIso(value);
  if (start === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const next = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1, 0, 0, 0, 0);
  return next.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Enlace de activación: el token va en el fragmento (`#`), que el navegador no envía al servidor. */
export function activationUrl(origin: string, token: string): string {
  return `${origin}/activar#${token}`;
}
