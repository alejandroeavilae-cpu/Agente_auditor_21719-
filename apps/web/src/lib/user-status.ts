// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UserListItem } from '../api/schemas.js';

/**
 * Estado visible de un usuario en la lista (2C §2.2 y `2c2-api.md` §2). Cada indicador tiene
 * texto propio: el color nunca es la única señal (WCAG 1.4.1).
 */
export type StatusTone = 'ok' | 'info' | 'warning' | 'danger' | 'muted';

export interface StatusBadge {
  key: string;
  label: string;
  tone: StatusTone;
  /** Explicación adicional (se muestra como texto, no como ayuda emergente). */
  detail?: string;
}

/** "Bloqueado" = bloqueo de contraseña vigente en algún origen o MFA bloqueada (regla del contrato). */
export function isLocked(user: UserListItem): boolean {
  return user.passwordLock.lockedOrigins > 0 || user.mfaLock.locked;
}

export function statusBadges(user: UserListItem, formatDate: (iso: string) => string): StatusBadge[] {
  const badges: StatusBadge[] = [];
  if (user.status === 'invited') badges.push({ key: 'invited', label: 'Invitado', tone: 'info', detail: 'Aún no activa su cuenta con el enlace.' });
  if (user.status === 'disabled') badges.push({ key: 'disabled', label: 'Desactivado', tone: 'muted' });
  if (user.status === 'active') {
    badges.push({ key: 'active', label: 'Activo', tone: 'ok' });
    if (user.mfaResetPending) {
      badges.push({
        key: 'reset',
        label: 'Reinicio de MFA pendiente',
        tone: 'warning',
        detail: 'Solo puede entrar con el enlace de activación. Si se perdió o venció, reinicie de nuevo.',
      });
    } else if (!user.mfaEnabled) {
      badges.push({ key: 'nomfa', label: 'Sin MFA', tone: 'warning', detail: 'Deberá configurar la verificación en dos pasos al entrar.' });
    }
  }
  if (user.passwordLock.lockedOrigins > 0) {
    const n = user.passwordLock.lockedOrigins;
    const until = user.passwordLock.lockedUntil === null ? '' : ` hasta ${formatDate(user.passwordLock.lockedUntil)}`;
    badges.push({
      key: 'pwlock',
      label: `Bloqueado en ${String(n)} ${n === 1 ? 'origen' : 'orígenes'}`,
      tone: 'warning',
      detail: `Contraseña bloqueada${until} desde ${n === 1 ? 'un equipo' : 'esos equipos'}. Suele deberse a alguien que no conoce la contraseña; la persona puede seguir entrando desde su propio equipo.`,
    });
  }
  if (user.mfaLock.locked) {
    const until = user.mfaLock.lockedUntil === null ? '' : ` hasta ${formatDate(user.mfaLock.lockedUntil)}`;
    badges.push({ key: 'mfalock', label: `MFA bloqueada${until}`, tone: 'danger' });
  }
  if (user.mustChangePassword) badges.push({ key: 'mustchange', label: 'Debe cambiar su contraseña', tone: 'info' });
  if (user.passwordCompromiseSuspected) badges.push({ key: 'r38', label: 'Atención: contraseña posiblemente comprometida', tone: 'danger' });
  return badges;
}

/** Usuarios con sospecha de contraseña comprometida (aviso destacado de R-38). */
export function compromisedUsers(users: readonly UserListItem[]): UserListItem[] {
  return users.filter((u) => u.passwordCompromiseSuspected);
}

/** Acciones que tiene sentido ofrecer (la API decide igual; ocultar no es un control). */
export interface UserActions {
  editRoles: boolean;
  unlock: boolean;
  resetMfa: boolean;
  deactivate: boolean;
}

export function availableActions(user: UserListItem, selfId: string): UserActions {
  const self = user.id === selfId;
  const live = user.status !== 'disabled';
  return {
    editRoles: live,
    unlock: live && isLocked(user),
    // Nadie se reinicia a sí mismo (409 self_mfa_reset) y solo cuentas activas (409 user_not_active).
    resetMfa: !self && user.status === 'active',
    deactivate: !self && live,
  };
}
