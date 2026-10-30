// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState, type SyntheticEvent } from 'react';
import { Button, Form } from 'react-aria-components';
import { setUserRoles } from '../../api/endpoints.js';
import { isApiError, messageOf } from '../../api/http.js';
import type { UserListItem } from '../../api/schemas.js';
import { AppDialog } from '../../components/AppDialog.js';
import { Notice } from '../../components/Notice.js';
import { useReauth } from '../../session/ReauthProvider.js';
import { RoleCheckboxes } from './RoleCheckboxes.js';

/** Editar roles. Si la combinación está prohibida (D-79), muestra el mensaje de la API. */
export function RolesDialog({ user, onClose, onSaved }: { user: UserListItem; onClose: () => void; onSaved: (message: string) => void }) {
  const { withReauth } = useReauth();
  const [roles, setRoles] = useState<string[]>(user.roles);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFailure(null);
    if (roles.length === 0) {
      setError('Elija al menos un rol.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await withReauth(() => setUserRoles(user.id, roles));
      onSaved(`Se actualizaron los roles de ${user.displayName}.`);
    } catch (err) {
      if (isApiError(err, 'invalid_roles')) setError(messageOf(err));
      setFailure(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppDialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={`Editar roles de ${user.displayName}`}>
      <Form onSubmit={(e) => void submit(e)} validationBehavior="aria" className="form">
        <RoleCheckboxes value={roles} onChange={setRoles} error={error} />
        {failure !== null && <Notice tone="error" title="No se guardaron los cambios.">{failure}</Notice>}
        <div className="actions">
          <Button type="submit" className="button button-primary" isDisabled={busy}>
            {busy ? 'Guardando…' : 'Guardar roles'}
          </Button>
          <Button className="button" onPress={onClose}>
            Cancelar
          </Button>
        </div>
      </Form>
    </AppDialog>
  );
}
