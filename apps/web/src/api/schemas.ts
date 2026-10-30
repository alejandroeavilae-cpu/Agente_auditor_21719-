// SPDX-License-Identifier: AGPL-3.0-or-later

import { z } from 'zod';

/**
 * Esquemas de las respuestas de la API (contrato en `docs/fase-2/2c2-api.md`). Se validan en
 * el cliente porque la interfaz no confía en la forma de los datos recibidos por red.
 * `z.object` (no estricto) tolera campos nuevos que la API agregue en el futuro.
 */

export const stageSchema = z.enum(['mfa_pending', 'mfa_enroll', 'password_change', 'full']);
export type Stage = z.infer<typeof stageSchema>;

const isoDate = z.iso.datetime({ offset: true });
const csrfSchema = z.string().regex(/^[0-9a-f]{64}$/);
/** Token de activación: 43 caracteres base64url (32 bytes). */
export const activationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** Respuesta de inicio de sesión, MFA, activación y cambio de contraseña. */
export const issuedSessionSchema = z.object({ stage: stageSchema, csrfToken: csrfSchema });
export type IssuedSession = z.infer<typeof issuedSessionSchema>;

const organizationSchema = z.object({ slug: z.string().min(1).max(30), name: z.string().min(1).max(200) });

export const meSchema = z.discriminatedUnion('stage', [
  z.object({
    stage: z.literal('full'),
    organization: organizationSchema,
    csrfToken: csrfSchema,
    session: z.object({ expiresAt: isoDate, idleExpiresAt: isoDate, reauthValidUntil: isoDate.nullable() }),
    user: z.object({ id: z.uuid(), email: z.string().max(254), displayName: z.string().max(200), mfaEnabled: z.boolean() }),
    roles: z.array(z.object({ id: z.string().max(40), label: z.string().max(100) })).max(10),
    permissions: z.array(z.string().max(60)).max(50),
  }),
  z.object({
    stage: z.enum(['mfa_pending', 'mfa_enroll', 'password_change']),
    organization: organizationSchema,
    csrfToken: csrfSchema,
    session: z.object({ expiresAt: isoDate }),
  }),
]);
export type Me = z.infer<typeof meSchema>;
export type FullMe = Extract<Me, { stage: 'full' }>;

export const enrollSchema = z.object({
  secret: z.string().regex(/^[A-Z2-7]{16,128}$/),
  otpauthUri: z.string().startsWith('otpauth://totp/').max(2000),
});
export type Enrollment = z.infer<typeof enrollSchema>;

export const confirmSchema = issuedSessionSchema.extend({ recoveryCodes: z.array(z.string().min(8).max(40)).min(1).max(20) });

export const userStatusSchema = z.enum(['invited', 'active', 'disabled']);

export const userListItemSchema = z.object({
  id: z.uuid(),
  email: z.string().max(254),
  displayName: z.string().max(200),
  status: userStatusSchema,
  roles: z.array(z.string().max(40)).max(10),
  mfaEnabled: z.boolean(),
  passwordLock: z.object({ lockedOrigins: z.number().int().min(0), lockedUntil: isoDate.nullable() }),
  mfaLock: z.object({ locked: z.boolean(), lockedUntil: isoDate.nullable(), failedAttempts: z.number().int().min(0) }),
  passwordCompromiseSuspected: z.boolean(),
  mustChangePassword: z.boolean(),
  mfaResetPending: z.boolean(),
});
export type UserListItem = z.infer<typeof userListItemSchema>;
export const usersSchema = z.object({ users: z.array(userListItemSchema).max(10_000) });

/** Respuesta de invitar (201) y de reiniciar la MFA (200, D-92): el token se entrega UNA vez. */
export const activationLinkSchema = z.object({ activationToken: activationTokenSchema, expiresAt: isoDate });
export type ActivationLink = z.infer<typeof activationLinkSchema>;

export const accessLogEventSchema = z.object({
  id: z.uuid(),
  ts: isoDate,
  event: z.string().max(80),
  userId: z.uuid().nullable(),
  userEmail: z.string().max(254).nullable(),
  ip: z.string().max(64).nullable(),
  uaFamily: z.string().max(40).nullable(),
});
export type AccessLogEvent = z.infer<typeof accessLogEventSchema>;
export const accessLogPageSchema = z.object({
  events: z.array(accessLogEventSchema).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type AccessLogPage = z.infer<typeof accessLogPageSchema>;

export const aboutSchema = z.object({
  name: z.string(),
  version: z.string(),
  commit: z.string(),
  license: z.string(),
  sourceUrl: z.string(),
  // Solo https: evita esquemas peligrosos (p. ej. javascript:) en el enlace.
  sourceForThisVersionUrl: z.string().startsWith('https://'),
});
