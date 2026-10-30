// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type SyntheticEvent } from 'react';
import { Button, Form } from 'react-aria-components';
import { inviteUser } from '../../api/endpoints.js';
import { isApiError, messageOf } from '../../api/http.js';
import type { ActivationLink } from '../../api/schemas.js';
import { AppDialog } from '../../components/AppDialog.js';
import { Field } from '../../components/Field.js';
import { Notice } from '../../components/Notice.js';
import { OneTimeLink } from '../../components/OneTimeLink.js';
import { useReauth } from '../../session/ReauthProvider.js';
import { RoleCheckboxes } from './RoleCheckboxes.js';

/** Invitar usuario: muestra el enlace de activación UNA sola vez, con botón de copiar. */
export function InviteDialog({ isOpen, onClose, onInvited }: { isOpen: boolean; onClose: () => void; onInvited: () => void }) {
  const { withReauth } = useReauth();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ email: string | null; name: string | null; roles: string | null }>({ email: null, name: null, roles: null });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ value: ActivationLink; person: string } | null>(null);

  const reset = () => {
    setEmail('');
    setName('');
    setRoles([]);
    setErrors({ email: null, name: null, roles: null });
    setFailure(null);
    setLink(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFailure(null);
    const next = {
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Escriba un correo válido, por ejemplo nombre@institucion.cl.',
      name: name.trim().length >= 2 ? null : 'Escriba el nombre de la persona (al menos 2 caracteres).',
      roles: roles.length > 0 ? null : 'Elija al menos un rol.',
    };
    setErrors(next);
    if (next.email !== null || next.name !== null || next.roles !== null) return;
    setBusy(true);
    try {
      const result = await withReauth(() => inviteUser({ email: email.trim(), displayName: name.trim(), roles }));
      setLink({ value: result, person: name.trim() });
      onInvited();
    } catch (err) {
      if (isApiError(err, 'invalid_roles')) setErrors({ ...next, roles: messageOf(err) });
      if (isApiError(err, 'email_exists')) setErrors({ ...next, email: messageOf(err) });
      setFailure(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppDialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={link === null ? 'Invitar usuario' : 'Invitación creada'}
      isDismissable={link === null}
    >
      {link === null ? (
        <Form onSubmit={(e) => void submit(e)} validationBehavior="aria" className="form">
          <Field label="Correo" name="inviteEmail" type="email" autoComplete="off" inputMode="email" isRequired value={email} onChange={setEmail} error={errors.email} />
          <Field label="Nombre" name="inviteName" autoComplete="off" isRequired maxLength={200} value={name} onChange={setName} error={errors.name} spellCheck />
          <RoleCheckboxes value={roles} onChange={setRoles} error={errors.roles} />
          {failure !== null && <Notice tone="error">{failure}</Notice>}
          <div className="actions">
            <Button type="submit" className="button button-primary" isDisabled={busy}>
              {busy ? 'Invitando…' : 'Invitar'}
            </Button>
            <Button className="button" onPress={close}>
              Cancelar
            </Button>
          </div>
        </Form>
      ) : (
        <>
          <OneTimeLink token={link.value.activationToken} expiresAt={link.value.expiresAt} person={link.person} />
          <div className="actions">
            <Button className="button button-primary" onPress={close}>
              Listo, ya copié el enlace
            </Button>
          </div>
        </>
      )}
    </AppDialog>
  );
}
