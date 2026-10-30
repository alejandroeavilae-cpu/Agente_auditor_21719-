// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from 'react-aria-components';
import { fetchUsers } from '../../api/endpoints.js';
import { isApiError, messageOf } from '../../api/http.js';
import type { UserListItem } from '../../api/schemas.js';
import { Notice } from '../../components/Notice.js';
import { PageHeading } from '../../components/PageHeading.js';
import { formatDateTime } from '../../lib/format.js';
import { roleLabel } from '../../lib/roles.js';
import { availableActions, compromisedUsers, statusBadges } from '../../lib/user-status.js';
import { hasPermission, useFullSession } from '../../session/SessionProvider.js';
import { InviteDialog } from './InviteDialog.js';
import { RolesDialog } from './RolesDialog.js';
import { UserActionDialog, type UserActionKind } from './UserActionDialog.js';

export const USERS_KEY = ['users'] as const;

type Open = { kind: UserActionKind | 'roles'; user: UserListItem } | null;

/** Usuarios de la organización (solo Administrador): estado, aviso de R-38 y acciones. */
export function UsersPage() {
  const me = useFullSession();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: USERS_KEY, queryFn: fetchUsers, retry: false, refetchOnWindowFocus: false });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [open, setOpen] = useState<Open>(null);
  const [message, setMessage] = useState<string | null>(null);
  const canManage = hasPermission(me, 'users.manage');

  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: USERS_KEY });
  };
  const done = (text: string) => {
    setOpen(null);
    setMessage(text);
    reload();
  };

  const list = users.data ?? [];
  const suspicious = compromisedUsers(list);

  return (
    <>
      <PageHeading>Usuarios</PageHeading>
      {canManage && (
        <div className="actions">
          <Button className="button button-primary" onPress={() => { setMessage(null); setInviteOpen(true); }}>
            Invitar usuario
          </Button>
        </div>
      )}
      {message !== null && <Notice tone="success">{message}</Notice>}

      {users.isPending && <p role="status">Cargando usuarios…</p>}
      {users.isError &&
        (isApiError(users.error, 'forbidden') ? (
          <Notice tone="error" title="No tiene permiso para ver los usuarios.">
            <p>Esta pantalla es solo para el Administrador de organización. Si necesita acceso, pídalo a la administración.</p>
          </Notice>
        ) : (
          <Notice tone="error">
            {messageOf(users.error)}{' '}
            <Button className="button button-small" onPress={() => void users.refetch()}>
              Reintentar
            </Button>
          </Notice>
        ))}

      {suspicious.length > 0 && (
        <section className="alert-panel" aria-labelledby="r38-title">
          <h2 id="r38-title">Atención: posible contraseña comprometida</h2>
          <p>
            Alguien que conoce la contraseña de {suspicious.length === 1 ? 'esta cuenta' : 'estas cuentas'} intentó adivinar el código de verificación
            hasta bloquearlo (para llegar a ese paso se necesita la contraseña correcta). Contacte a la persona por otro medio (por ejemplo, por
            teléfono).
          </p>
          <p>
            <strong>Recomendación:</strong> reinicie su verificación en dos pasos con enlace. Eso invalida la contraseña actual y le entrega un enlace
            de un solo uso para fijar una nueva. Si solo desbloquea, la persona deberá cambiar su contraseña al entrar, pero quien la conoce podría
            volver a intentarlo antes.
          </p>
          <ul>
            {suspicious.map((u) => (
              <li key={u.id}>
                <span>
                  {u.displayName} ({u.email})
                </span>{' '}
                {canManage && availableActions(u, me.user.id).resetMfa && (
                  <Button className="button button-small button-primary" onPress={() => { setMessage(null); setOpen({ kind: 'reset', user: u }); }}>
                    {`Reiniciar MFA con enlace: ${u.displayName}`}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {users.data !== undefined && (
        <div className="table-wrap" role="region" aria-labelledby="users-caption" tabIndex={0}>
          <table className="table">
            <caption id="users-caption">
              {`${String(list.length)} ${list.length === 1 ? 'usuario' : 'usuarios'} en ${me.organization.name}`}
            </caption>
            <thead>
              <tr>
                <th scope="col">Persona</th>
                <th scope="col">Roles</th>
                <th scope="col">Estado</th>
                {canManage && <th scope="col">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((u) => {
                const actions = availableActions(u, me.user.id);
                const badges = statusBadges(u, formatDateTime);
                return (
                  <tr key={u.id} className={u.passwordCompromiseSuspected ? 'row-alert' : undefined}>
                    <th scope="row">
                      <span className="person-name">{u.displayName}</span>
                      <span className="person-email">{u.email}</span>
                      {u.id === me.user.id && <span className="person-self">(usted)</span>}
                    </th>
                    <td>{u.roles.map(roleLabel).join(', ') || 'Sin roles'}</td>
                    <td>
                      <ul className="badges">
                        {badges.map((b) => (
                          <li key={b.key} className={`badge badge-${b.tone}`}>
                            {b.label}
                            {b.detail !== undefined && <span className="badge-detail">{b.detail}</span>}
                          </li>
                        ))}
                      </ul>
                    </td>
                    {canManage && (
                      <td>
                        <div className="row-actions">
                          {actions.editRoles && (
                            <Button className="button button-small" aria-label={`Editar roles de ${u.displayName}`} onPress={() => { setMessage(null); setOpen({ kind: 'roles', user: u }); }}>
                              Editar roles
                            </Button>
                          )}
                          {actions.unlock && (
                            <Button className="button button-small" aria-label={`Desbloquear a ${u.displayName}`} onPress={() => { setMessage(null); setOpen({ kind: 'unlock', user: u }); }}>
                              Desbloquear
                            </Button>
                          )}
                          {actions.resetMfa && (
                            <Button className="button button-small" aria-label={`Reiniciar MFA de ${u.displayName}`} onPress={() => { setMessage(null); setOpen({ kind: 'reset', user: u }); }}>
                              Reiniciar MFA
                            </Button>
                          )}
                          {actions.deactivate && (
                            <Button className="button button-small button-danger" aria-label={`Desactivar a ${u.displayName}`} onPress={() => { setMessage(null); setOpen({ kind: 'deactivate', user: u }); }}>
                              Desactivar
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <InviteDialog
        isOpen={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
        }}
        onInvited={reload}
      />
      {open?.kind === 'roles' && <RolesDialog user={open.user} onClose={() => { setOpen(null); }} onSaved={done} />}
      {open !== null && open.kind !== 'roles' && (
        <UserActionDialog
          key={`${open.kind}-${open.user.id}`}
          kind={open.kind}
          user={open.user}
          onClose={() => {
            setOpen(null);
          }}
          onDone={done}
          onSwitch={(kind) => {
            setOpen({ kind, user: open.user });
          }}
        />
      )}
    </>
  );
}
