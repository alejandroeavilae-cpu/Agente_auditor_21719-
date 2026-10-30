// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from 'react-aria-components';
import { Notice } from '../components/Notice.js';
import { PageHeading } from '../components/PageHeading.js';
import { useSession } from '../session/SessionProvider.js';
import { ChangePasswordForm } from './ChangePasswordForm.js';

/**
 * Etapa `password_change` (D-93, mitigación de R-38): tras desbloquear una MFA bloqueada, la
 * contraseña se considera comprometida y la persona debe cambiarla antes de seguir.
 */
export function PasswordChangeRequiredPage() {
  const { refresh, logout } = useSession();
  return (
    <>
      <PageHeading>Cambie su contraseña para continuar</PageHeading>
      <Notice tone="warning" title="Por seguridad, la administración le pide cambiar su contraseña.">
        <p>
          Su cuenta registró varios códigos de verificación incorrectos. Para llegar a ese paso se necesita su contraseña, así que alguien podría
          conocerla. Elija una contraseña nueva, distinta de la actual, y no la reutilice en otros servicios.
        </p>
      </Notice>
      <ChangePasswordForm submitLabel="Cambiar contraseña y continuar" onChanged={refresh} />
      <div className="actions">
        <Button className="button" onPress={() => void logout()}>
          Cerrar sesión
        </Button>
      </div>
    </>
  );
}
