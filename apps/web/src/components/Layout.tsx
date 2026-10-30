// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { NavLink } from 'react-router';
import { fetchAbout } from '../api/endpoints.js';
import { IdleWatcher } from '../session/IdleWatcher.js';
import { hasPermission, useSession } from '../session/SessionProvider.js';

/** Pie con versión y enlace al código fuente exacto en ejecución (AGPL-3.0 §13, desde la Fase 1). */
function Footer() {
  const about = useQuery({ queryKey: ['about'], queryFn: ({ signal }) => fetchAbout(signal), staleTime: Infinity, retry: false });
  return (
    <footer className="site-footer">
      <p>
        Auditor 21719 · Plataforma open source de auditoría de protección de datos personales (Ley 19.628 modificada por la Ley 21.719).
      </p>
      {about.data !== undefined && (
        <p>
          Versión {about.data.version} ({about.data.commit.slice(0, 7)}) · Licencia {about.data.license} ·{' '}
          <a href={about.data.sourceForThisVersionUrl} rel="noopener noreferrer">
            Código fuente de esta versión
          </a>
        </p>
      )}
    </footer>
  );
}

function SkipLink() {
  return (
    <a className="skip-link" href="#contenido">
      Saltar al contenido principal
    </a>
  );
}

/** Pantallas sin sesión completa: inicio de sesión, MFA, activación, cambio obligatorio. */
export function PublicLayout({ children }: { children: ReactNode }) {
  const { me } = useSession();
  return (
    <div className="app">
      <SkipLink />
      <header className="site-header">
        <p className="brand">Auditor 21719</p>
        {me !== null && me !== undefined && <p className="org-name">{me.organization.name}</p>}
      </header>
      <main id="contenido" className="main main-narrow" tabIndex={-1}>
        {children}
      </main>
      <Footer />
    </div>
  );
}

/**
 * Pantallas con sesión completa: menú según los permisos de `/me`. Ocultar una opción no es
 * un control de acceso; la API vuelve a decidir en cada ruta (2C §2.5).
 */
export function AppLayout({ children }: { children: ReactNode }) {
  const { me, logout } = useSession();
  if (me?.stage !== 'full') return null;
  const items = [
    { to: '/', label: 'Inicio', show: true },
    { to: '/usuarios', label: 'Usuarios', show: hasPermission(me, 'users.read') },
    { to: '/registro-de-accesos', label: 'Registro de accesos', show: hasPermission(me, 'access_log.read') },
    { to: '/bitacora', label: 'Exportar bitácora', show: hasPermission(me, 'audit_log.export') },
    { to: '/mi-cuenta', label: 'Mi cuenta', show: true },
  ].filter((i) => i.show);
  return (
    <div className="app">
      <SkipLink />
      <header className="site-header">
        <div className="header-row">
          <p className="brand">Auditor 21719</p>
          <p className="org-name">{me.organization.name}</p>
          <div className="header-user">
            <span className="user-name">{me.user.displayName}</span>
            <Button className="button button-small" onPress={() => void logout('Cerró su sesión.')}>
              Cerrar sesión
            </Button>
          </div>
        </div>
        <nav aria-label="Menú principal" className="main-nav">
          <ul>
            {items.map((i) => (
              <li key={i.to}>
                <NavLink to={i.to} end={i.to === '/'} className="nav-link">
                  {i.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="contenido" className="main" tabIndex={-1}>
        {children}
      </main>
      <Footer />
      <IdleWatcher />
    </div>
  );
}
