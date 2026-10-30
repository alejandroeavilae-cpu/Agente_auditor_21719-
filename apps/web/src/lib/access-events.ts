// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Eventos del registro de accesos (`2c2-api.md` §4) con su descripción en español y la
 * agrupación propuesta en el contrato para el filtro.
 */

export interface EventGroup {
  id: string;
  label: string;
  events: readonly string[];
}

export const EVENT_GROUPS: readonly EventGroup[] = [
  { id: 'alerts', label: 'Alertas', events: ['account.attack_suspected', 'auth.account.locked'] },
  { id: 'failed', label: 'Intentos fallidos', events: ['auth.login.failed', 'auth.mfa.failed', 'auth.reauth.failed', 'auth.password.change_failed'] },
  { id: 'blocked', label: 'Intentos durante un bloqueo', events: ['auth.login.blocked', 'auth.mfa.blocked', 'auth.reauth.blocked', 'auth.password.change_blocked'] },
  { id: 'signin', label: 'Ingresos', events: ['auth.login.password_ok', 'auth.login.succeeded', 'auth.mfa.recovery_used', 'auth.reauth.succeeded', 'auth.logout'] },
  { id: 'account', label: 'Cuenta', events: ['auth.mfa.enabled', 'auth.password.changed', 'user.activated'] },
  { id: 'admin', label: 'Administración', events: ['user.invited', 'user.roles.changed', 'user.deactivated', 'user.unlocked', 'user.mfa.reset', 'audit_log.exported'] },
];

const LABELS: Readonly<Record<string, string>> = {
  'account.attack_suspected': 'Posible ataque distribuido contra la cuenta',
  'auth.account.locked': 'Cuenta bloqueada por intentos fallidos',
  'auth.login.failed': 'Inicio de sesión fallido',
  'auth.mfa.failed': 'Código de verificación incorrecto',
  'auth.reauth.failed': 'Reconfirmación de código fallida',
  'auth.password.change_failed': 'Cambio de contraseña fallido',
  'auth.login.blocked': 'Inicio de sesión durante un bloqueo',
  'auth.mfa.blocked': 'Código durante un bloqueo',
  'auth.reauth.blocked': 'Reconfirmación durante un bloqueo',
  'auth.password.change_blocked': 'Cambio de contraseña durante un bloqueo',
  'auth.login.password_ok': 'Contraseña correcta (falta el código)',
  'auth.login.succeeded': 'Ingreso completo',
  'auth.mfa.recovery_used': 'Ingreso con código de recuperación',
  'auth.reauth.succeeded': 'Código reconfirmado',
  'auth.logout': 'Cierre de sesión',
  'auth.mfa.enabled': 'Verificación en dos pasos configurada',
  'auth.password.changed': 'Contraseña cambiada',
  'user.activated': 'Cuenta activada',
  'user.invited': 'Usuario invitado',
  'user.roles.changed': 'Roles modificados',
  'user.deactivated': 'Usuario desactivado',
  'user.unlocked': 'Usuario desbloqueado',
  'user.mfa.reset': 'Verificación en dos pasos reiniciada',
  'audit_log.exported': 'Bitácora exportada',
};

/** Eventos que se destacan en la tabla (con texto "Alerta", no solo color). */
export const ALERT_EVENTS: ReadonlySet<string> = new Set(['account.attack_suspected', 'auth.account.locked']);

export function eventLabel(event: string): string {
  return LABELS[event] ?? event;
}

export function groupEvents(groupId: string): readonly string[] {
  return EVENT_GROUPS.find((g) => g.id === groupId)?.events ?? [];
}
