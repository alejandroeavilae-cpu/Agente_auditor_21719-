// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Button } from 'react-aria-components';
import { Notice } from '../components/Notice.js';
import { PageHeading } from '../components/PageHeading.js';
import { useFullSession, useSession } from '../session/SessionProvider.js';
import { ChangePasswordForm } from './ChangePasswordForm.js';

/** Mi cuenta: datos propios, cambio de contraseña y cierre de sesión. */
export function AccountPage() {
  const me = useFullSession();
  const { refresh, logout } = useSession();
  const [done, setDone] = useState(false);
  return (
    <>
      <PageHeading>Mi cuenta</PageHeading>
      <dl className="details">
        <dt>Nombre</dt>
        <dd>{me.user.displayName}</dd>
        <dt>Correo</dt>
        <dd>{me.user.email}</dd>
        <dt>Roles</dt>
        <dd>{me.roles.map((r) => r.label).join(', ') || 'Sin roles asignados'}</dd>
        <dt>Verificación en dos pasos</dt>
        <dd>{me.user.mfaEnabled ? 'Activa' : 'No configurada'}</dd>
      </dl>
      <p className="hint">Para cambiar de teléfono o de app autenticadora, pida a un administrador que reinicie su verificación en dos pasos.</p>

      <section aria-labelledby="cambiar-contrasena">
        <h2 id="cambiar-contrasena">Cambiar contraseña</h2>
        {done && <Notice tone="success">Su contraseña se cambió. Por seguridad, se cerraron sus sesiones abiertas en otros equipos.</Notice>}
        <ChangePasswordForm
          email={me.user.email}
          submitLabel="Cambiar contraseña"
          onChanged={async () => {
            setDone(true);
            await refresh();
          }}
        />
      </section>

      <section aria-labelledby="cerrar-sesion">
        <h2 id="cerrar-sesion">Cerrar sesión</h2>
        <p>Cierre la sesión al terminar, sobre todo en equipos compartidos.</p>
        <Button className="button" onPress={() => void logout('Cerró su sesión.')}>
          Cerrar sesión
        </Button>
      </section>
    </>
  );
}
