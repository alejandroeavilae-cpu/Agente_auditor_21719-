// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router';
import { PageHeading } from '../components/PageHeading.js';
import { hasPermission, useFullSession } from '../session/SessionProvider.js';

/** Inicio según el rol. Aclara que las funciones de auditoría llegan en fases posteriores. */
export function HomePage() {
  const me = useFullSession();
  const admin = hasPermission(me, 'users.manage');
  return (
    <>
      <PageHeading title="Inicio">{`Bienvenida o bienvenido, ${me.user.displayName}`}</PageHeading>
      <p>
        Organización: <strong>{me.organization.name}</strong>. Sus roles: <strong>{me.roles.map((r) => r.label).join(', ') || 'sin roles asignados'}</strong>.
      </p>
      <section aria-labelledby="estado-plataforma" className="card">
        <h2 id="estado-plataforma">Estado de la plataforma</h2>
        <p>
          Esta versión incluye la gestión de usuarios y del acceso. Las funciones de auditoría (inventario de sistemas, ejecución de auditorías,
          hallazgos, revisión jurídica e informes) llegarán en fases posteriores del proyecto.
        </p>
      </section>
      {admin && (
        <section aria-labelledby="tareas-admin" className="card">
          <h2 id="tareas-admin">Tareas de administración</h2>
          <ul>
            <li>
              <Link to="/usuarios">Usuarios</Link>: invitar, asignar roles, desbloquear, reiniciar la verificación en dos pasos y desactivar cuentas.
            </li>
            {hasPermission(me, 'access_log.read') && (
              <li>
                <Link to="/registro-de-accesos">Registro de accesos</Link>: intentos de inicio de sesión, bloqueos y alertas.
              </li>
            )}
            {hasPermission(me, 'audit_log.export') && (
              <li>
                <Link to="/bitacora">Exportar bitácora</Link>: descargue la bitácora y verifique su integridad fuera de la plataforma.
              </li>
            )}
          </ul>
        </section>
      )}
    </>
  );
}
