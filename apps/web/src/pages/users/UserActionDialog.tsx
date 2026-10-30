// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Button } from 'react-aria-components';
import { deactivateUser, resetUserMfa, unlockUser } from '../../api/endpoints.js';
import { messageOf } from '../../api/http.js';
import type { ActivationLink, UserListItem } from '../../api/schemas.js';
import { AppDialog } from '../../components/AppDialog.js';
import { Notice } from '../../components/Notice.js';
import { OneTimeLink } from '../../components/OneTimeLink.js';
import { useReauth } from '../../session/ReauthProvider.js';

export type UserActionKind = 'unlock' | 'deactivate' | 'reset';

const TITLES: Record<UserActionKind, string> = {
  unlock: 'Desbloquear cuenta',
  deactivate: 'Desactivar cuenta',
  reset: 'Reiniciar la verificación en dos pasos',
};

/**
 * Confirmación de acciones de alto riesgo sobre una cuenta. Todas exigen MFA reciente: si la
 * API responde `reauth_required`, `withReauth` pide el código y repite la acción.
 */
export function UserActionDialog({
  kind,
  user,
  onClose,
  onDone,
  onSwitch,
}: {
  kind: UserActionKind;
  user: UserListItem;
  onClose: () => void;
  onDone: (message: string) => void;
  onSwitch: (kind: UserActionKind) => void;
}) {
  const { withReauth } = useReauth();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [link, setLink] = useState<ActivationLink | null>(null);
  const who = `${user.displayName} (${user.email})`;

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      if (kind === 'unlock') {
        await withReauth(() => unlockUser(user.id));
        onDone(
          user.mfaLock.locked || user.passwordCompromiseSuspected
            ? `Se desbloqueó la cuenta de ${user.displayName}. En su próximo ingreso deberá cambiar su contraseña.`
            : `Se desbloqueó la cuenta de ${user.displayName}.`,
        );
      } else if (kind === 'deactivate') {
        await withReauth(() => deactivateUser(user.id));
        onDone(`Se desactivó la cuenta de ${user.displayName}. Sus sesiones se cerraron.`);
      } else {
        setLink(await withReauth(() => resetUserMfa(user.id)));
      }
    } catch (err) {
      setFailure(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (link !== null) {
    return (
      <AppDialog isOpen onOpenChange={() => undefined} title="Verificación en dos pasos reiniciada" isDismissable={false}>
        <p>
          La contraseña anterior de {who} ya no sirve y sus sesiones se cerraron. Solo podrá entrar con este enlace: fijará una contraseña nueva y
          configurará su verificación en dos pasos.
        </p>
        <OneTimeLink
          token={link.activationToken}
          expiresAt={link.expiresAt}
          person={user.displayName}
          {...(user.passwordCompromiseSuspected ? { extraWarning: 'Como había sospecha de contraseña comprometida, confirme la identidad de la persona por un medio distinto del correo antes de entregarle el enlace.' } : {})}
        />
        <div className="actions">
          <Button className="button button-primary" onPress={() => { onDone(`Se reinició la verificación en dos pasos de ${user.displayName}. Queda pendiente que use el enlace.`); }}>
            Listo, ya copié el enlace
          </Button>
        </div>
      </AppDialog>
    );
  }

  return (
    <AppDialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={TITLES[kind]} alert>
      <p>
        Cuenta: <strong>{who}</strong>
      </p>
      {kind === 'unlock' && (
        <>
          {user.mfaLock.locked && <p>Se levantará el bloqueo de la verificación en dos pasos. En su próximo ingreso, la persona deberá cambiar su contraseña.</p>}
          {user.passwordLock.lockedOrigins > 0 && <p>Se levantarán los bloqueos de contraseña desde todos los equipos.</p>}
          {user.passwordCompromiseSuspected && (
            <Notice tone="warning" title="Recomendación: reinicie la verificación en dos pasos en vez de solo desbloquear.">
              <p>
                Un bloqueo de la verificación en dos pasos indica que alguien conoce la contraseña de esta cuenta. Si solo desbloquea, esa persona
                podría seguir intentándolo. El reinicio invalida la contraseña y entrega un enlace de un solo uso.
              </p>
              <Button className="button button-small" onPress={() => { onSwitch('reset'); }}>
                Reiniciar con enlace (recomendado)
              </Button>
            </Notice>
          )}
        </>
      )}
      {kind === 'deactivate' && <p>La persona no podrá volver a entrar y se cerrarán sus sesiones abiertas. Sus registros en la bitácora se conservan.</p>}
      {kind === 'reset' && (
        <ul>
          <li>Su contraseña actual deja de servir y se cierran todas sus sesiones.</li>
          <li>Se borran su configuración de la app autenticadora y sus códigos de recuperación.</li>
          <li>Se genera un enlace de activación de un solo uso que vence en 24 horas. Usted lo verá una sola vez y deberá entregarlo a la persona.</li>
        </ul>
      )}
      {failure !== null && <Notice tone="error">{failure}</Notice>}
      <div className="actions">
        <Button className={`button ${kind === 'deactivate' ? 'button-danger' : 'button-primary'}`} isDisabled={busy} onPress={() => void confirm()}>
          {busy ? 'Procesando…' : kind === 'unlock' ? 'Desbloquear' : kind === 'deactivate' ? 'Desactivar' : 'Reiniciar y generar enlace'}
        </Button>
        <Button className="button" onPress={onClose}>
          Cancelar
        </Button>
      </div>
    </AppDialog>
  );
}
