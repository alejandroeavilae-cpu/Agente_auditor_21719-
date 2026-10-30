// SPDX-License-Identifier: AGPL-3.0-or-later

import { FORBIDDEN_ROLE_PAIRS as API_PAIRS, ROLE_LABELS as API_LABELS, ROLES as API_ROLES, validateRoleSet } from '@auditor-21719/identity';
import { describe, expect, it } from 'vitest';
import { accessLogSearch, fileNameFromDisposition } from '../src/api/endpoints.js';
import { aboutSchema, meSchema, usersSchema, type UserListItem } from '../src/api/schemas.js';
import { EVENT_GROUPS, eventLabel } from '../src/lib/access-events.js';
import { activationUrl, localDateEndToUtcIso, localDateToUtcIso } from '../src/lib/format.js';
import { passwordStrength } from '../src/lib/password-strength.js';
import { qrPath } from '../src/lib/qr.js';
import { FORBIDDEN_ROLE_PAIRS, forbiddenCombinations, ROLE_LABELS, ROLES } from '../src/lib/roles.js';
import { availableActions, compromisedUsers, isLocked, statusBadges } from '../src/lib/user-status.js';
import { clockFromMe, formatRemaining, phaseAt, renewed, SAFETY_MARGIN_MS, WARNING_MS } from '../src/session/session-clock.js';

describe('roles (copia de packages/identity para el navegador)', () => {
  it('coincide exactamente con la matriz de la API (D-79)', () => {
    expect(ROLES).toEqual(API_ROLES);
    expect(ROLE_LABELS).toEqual(API_LABELS);
    expect(FORBIDDEN_ROLE_PAIRS).toEqual(API_PAIRS);
  });
  it('detecta las mismas combinaciones prohibidas que la API', () => {
    for (const a of ROLES) {
      for (const b of ROLES) {
        if (a === b) continue;
        const apiForbidden = validateRoleSet([a, b]).some((p) => p.startsWith('Separación de funciones'));
        expect(forbiddenCombinations([a, b]).length > 0, `${a}+${b}`).toBe(apiForbidden);
      }
    }
  });
});

const baseUser: UserListItem = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'persona@ejemplo.cl',
  displayName: 'Persona Sintética',
  status: 'active',
  roles: ['reader'],
  mfaEnabled: true,
  passwordLock: { lockedOrigins: 0, lockedUntil: null },
  mfaLock: { locked: false, lockedUntil: null, failedAttempts: 0 },
  passwordCompromiseSuspected: false,
  mustChangePassword: false,
  mfaResetPending: false,
};
const fmt = (iso: string) => iso;
const labels = (u: UserListItem) => statusBadges(u, fmt).map((b) => b.label);

describe('estado de usuarios (2c2-api.md §2)', () => {
  it('activo con MFA', () => {
    expect(labels(baseUser)).toEqual(['Activo']);
  });
  it('sin MFA, invitado, desactivado y reinicio pendiente', () => {
    expect(labels({ ...baseUser, mfaEnabled: false })).toEqual(['Activo', 'Sin MFA']);
    expect(labels({ ...baseUser, status: 'invited', mfaEnabled: false })).toEqual(['Invitado']);
    expect(labels({ ...baseUser, status: 'disabled' })).toEqual(['Desactivado']);
    expect(labels({ ...baseUser, mfaEnabled: false, mfaResetPending: true })).toEqual(['Activo', 'Reinicio de MFA pendiente']);
  });
  it('"bloqueado" = bloqueo de contraseña en algún origen o MFA bloqueada', () => {
    expect(isLocked(baseUser)).toBe(false);
    expect(isLocked({ ...baseUser, passwordLock: { lockedOrigins: 2, lockedUntil: '2026-10-30T12:00:00.000Z' } })).toBe(true);
    expect(isLocked({ ...baseUser, mfaLock: { locked: true, lockedUntil: null, failedAttempts: 5 } })).toBe(true);
    expect(labels({ ...baseUser, passwordLock: { lockedOrigins: 2, lockedUntil: 'X' } })).toContain('Bloqueado en 2 orígenes');
  });
  it('R-38: aviso con texto (no solo color) y lista de cuentas sospechosas', () => {
    const suspicious = { ...baseUser, passwordCompromiseSuspected: true, mustChangePassword: true };
    expect(labels(suspicious)).toEqual(['Activo', 'Debe cambiar su contraseña', 'Atención: contraseña posiblemente comprometida']);
    expect(compromisedUsers([baseUser, suspicious])).toEqual([suspicious]);
  });
  it('acciones ofrecidas: nadie se reinicia ni se desactiva a sí mismo', () => {
    expect(availableActions(baseUser, baseUser.id)).toEqual({ editRoles: true, unlock: false, resetMfa: false, deactivate: false });
    expect(availableActions(baseUser, 'otro')).toEqual({ editRoles: true, unlock: false, resetMfa: true, deactivate: true });
    expect(availableActions({ ...baseUser, status: 'invited' }, 'otro').resetMfa).toBe(false);
    expect(availableActions({ ...baseUser, status: 'disabled' }, 'otro')).toEqual({ editRoles: false, unlock: false, resetMfa: false, deactivate: false });
  });
});

describe('reloj de la sesión (aviso de expiración)', () => {
  const times = { expiresAt: '2026-10-30T22:00:00.000Z', idleExpiresAt: '2026-10-30T10:30:00.000Z' };
  const server = Date.parse('2026-10-30T10:00:00.000Z');

  it('usa el reloj del servidor (cabecera Date) aunque el del equipo esté desfasado', () => {
    const local = server + 3_600_000; // equipo una hora adelantado
    const clock = clockFromMe(times, server, local);
    expect(clock.idleWindowMs).toBe(30 * 60_000 - SAFETY_MARGIN_MS);
    expect(clock.idleDeadline).toBe(local + 30 * 60_000 - SAFETY_MARGIN_MS);
  });
  it('avisa 2 minutos antes y expira al vencer', () => {
    const clock = clockFromMe(times, server, 0);
    expect(phaseAt(clock, 0).kind).toBe('active');
    expect(phaseAt(clock, clock.idleDeadline - WARNING_MS - 1).kind).toBe('active');
    expect(phaseAt(clock, clock.idleDeadline - WARNING_MS)).toMatchObject({ kind: 'warning', reason: 'idle' });
    expect(phaseAt(clock, clock.idleDeadline)).toEqual({ kind: 'expired', reason: 'idle' });
  });
  it('cada petición renueva la inactividad, sin pasar del vencimiento absoluto', () => {
    const clock = clockFromMe({ expiresAt: '2026-10-30T10:40:00.000Z', idleExpiresAt: '2026-10-30T10:30:00.000Z' }, server, 0);
    const later = renewed(clock, 20 * 60_000);
    expect(later.idleDeadline).toBe(clock.absoluteDeadline);
    expect(phaseAt(later, later.idleDeadline - 1)).toMatchObject({ kind: 'warning', reason: 'absolute' });
    // Un mensaje viejo no acorta el plazo.
    expect(renewed(later, 0)).toBe(later);
  });
  it('sin cabecera Date usa el reloj local', () => {
    const local = Date.parse('2026-10-30T10:00:00.000Z');
    expect(clockFromMe(times, null, local).idleDeadline).toBe(local + 30 * 60_000 - SAFETY_MARGIN_MS);
  });
  it('texto del tiempo restante', () => {
    expect(formatRemaining(65_000)).toBe('1 minuto y 5 segundos');
    expect(formatRemaining(1_000)).toBe('1 segundo');
    expect(formatRemaining(120_000)).toBe('2 minutos y 0 segundos');
  });
});

describe('indicador de fortaleza (orientativo)', () => {
  it('exige el mínimo de 12 caracteres Unicode', () => {
    expect(passwordStrength('corta').problems).toEqual(['Use al menos 12 caracteres (lleva 5).']);
    expect(passwordStrength('ñandú-ñandú!').score).toBeGreaterThan(0);
  });
  it('rechaza el correo dentro de la contraseña (como la API)', () => {
    expect(passwordStrength('persona-segura-2026', 'persona@ejemplo.cl').problems).toEqual(['No incluya su correo en la contraseña.']);
  });
  it('sube con el largo y la variedad, y no premia repeticiones', () => {
    expect(passwordStrength('aaaaaaaaaaaaaaaaaaaaaaaa').score).toBe(1);
    expect(passwordStrength('una frase larga y propia para recordar').score).toBeGreaterThanOrEqual(3);
  });
});

describe('formato y enlaces', () => {
  it('el enlace de activación lleva el token en el fragmento', () => {
    expect(activationUrl('https://auditor.municipio.local', 'abc')).toBe('https://auditor.municipio.local/activar#abc');
  });
  it('fechas locales a ISO UTC con Z (formato del registro de accesos)', () => {
    expect(localDateToUtcIso('2026-10-30')).toMatch(/^2026-10-(29|30)T\d{2}:00:00Z$/);
    expect(localDateToUtcIso('')).toBeNull();
    expect(localDateToUtcIso('30-10-2026')).toBeNull();
    const from = localDateToUtcIso('2026-10-30') ?? '';
    const to = localDateEndToUtcIso('2026-10-30') ?? '';
    expect(Date.parse(to) - Date.parse(from)).toBeGreaterThanOrEqual(23 * 3_600_000);
  });
  it('consulta del registro de accesos sin parámetros vacíos (la API rechaza los desconocidos o repetidos)', () => {
    expect(accessLogSearch({})).toBe('');
    expect(accessLogSearch({ limit: 50, cursor: null, events: [], userId: '', from: null })).toBe('?limit=50');
    expect(accessLogSearch({ limit: 10, cursor: 'abc', events: ['a.b', 'c.d'], userId: 'u', from: 'f', to: 't' })).toBe('?limit=10&cursor=abc&event=a.b%2Cc.d&userId=u&from=f&to=t');
  });
  it('nombre de archivo de la exportación solo con caracteres seguros', () => {
    expect(fileNameFromDisposition('attachment; filename="bitacora-muni-20261030T120000Z.jsonl"', 'x')).toBe('bitacora-muni-20261030T120000Z.jsonl');
    expect(fileNameFromDisposition('attachment; filename="../../etc/passwd"', 'x')).toBe('x');
    expect(fileNameFromDisposition(null, 'x')).toBe('x');
  });
  it('todos los eventos del contrato tienen descripción en español', () => {
    for (const g of EVENT_GROUPS) for (const e of g.events) expect(eventLabel(e)).not.toBe(e);
    expect(eventLabel('evento.desconocido')).toBe('evento.desconocido');
  });
});

describe('código QR local', () => {
  it('genera una matriz cuadrada como trazado SVG (sin data: ni innerHTML)', () => {
    const { size, d } = qrPath('otpauth://totp/Auditor%2021719:persona%40ejemplo.cl?secret=JBSWY3DPEHPK3PXP&issuer=Auditor%2021719');
    expect(size).toBeGreaterThanOrEqual(21);
    expect(d).toMatch(/^(M\d+ \d+h1v1h-1z)+$/);
  });
});

describe('validación de respuestas de la API', () => {
  it('/me en sesión completa y en etapas previas', () => {
    const csrf = 'a'.repeat(64);
    expect(
      meSchema.safeParse({
        organization: { slug: 'muni', name: 'Muni' },
        stage: 'full',
        csrfToken: csrf,
        session: { expiresAt: '2026-10-31T00:00:00.000Z', idleExpiresAt: '2026-10-30T12:30:00.000Z', reauthValidUntil: null },
        user: { id: baseUser.id, email: 'a@b.cl', displayName: 'A', mfaEnabled: true },
        roles: [{ id: 'reader', label: 'Lector' }],
        permissions: ['reports.read'],
      }).success,
    ).toBe(true);
    expect(meSchema.safeParse({ organization: { slug: 'm', name: 'M' }, stage: 'password_change', csrfToken: csrf, session: { expiresAt: '2026-10-30T12:10:00.000Z' } }).success).toBe(true);
    expect(meSchema.safeParse({ organization: { slug: 'm', name: 'M' }, stage: 'full', csrfToken: csrf, session: { expiresAt: '2026-10-30T12:10:00.000Z' } }).success).toBe(false);
    expect(meSchema.safeParse({ organization: { slug: 'm', name: 'M' }, stage: 'mfa_pending', csrfToken: 'corto', session: { expiresAt: '2026-10-30T12:10:00.000Z' } }).success).toBe(false);
  });
  it('lista de usuarios con los campos de R-38 y D-92', () => {
    expect(usersSchema.safeParse({ users: [baseUser] }).success).toBe(true);
    const withoutReset: Partial<UserListItem> = { ...baseUser };
    delete withoutReset.mfaResetPending;
    expect(usersSchema.safeParse({ users: [withoutReset] }).success).toBe(false);
  });
  it('el enlace al código fuente solo acepta https (Fase 1)', () => {
    const about = { name: 'x', version: '0.1.0', commit: 'abc', license: 'AGPL-3.0-or-later', sourceUrl: 'https://x', sourceForThisVersionUrl: 'https://x/tree/abc' };
    expect(aboutSchema.safeParse(about).success).toBe(true);
    expect(aboutSchema.safeParse({ ...about, sourceForThisVersionUrl: 'javascript:alert(1)' }).success).toBe(false);
  });
});
