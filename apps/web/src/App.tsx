// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { messageOf } from './api/http.js';
import { AppLayout, PublicLayout } from './components/Layout.js';
import { Notice } from './components/Notice.js';
import { PageHeading } from './components/PageHeading.js';
import { AccessLogPage } from './pages/AccessLogPage.js';
import { AccountPage } from './pages/AccountPage.js';
import { ActivatePage } from './pages/ActivatePage.js';
import { AuditExportPage } from './pages/AuditExportPage.js';
import { HomePage } from './pages/HomePage.js';
import { LoginPage } from './pages/LoginPage.js';
import { MfaSetupPage } from './pages/MfaSetupPage.js';
import { MfaVerifyPage } from './pages/MfaVerifyPage.js';
import { PasswordChangeRequiredPage } from './pages/PasswordChangeRequiredPage.js';
import { UsersPage } from './pages/users/UsersPage.js';
import { hasPermission, useSession } from './session/SessionProvider.js';

/** Ruta única de cada etapa previa a la sesión completa. */
const STAGE_PATH = {
  mfa_pending: '/verificacion',
  mfa_enroll: '/configurar-mfa',
  password_change: '/cambiar-contrasena',
} as const;

function NotFoundPage() {
  return (
    <>
      <PageHeading>Página no encontrada</PageHeading>
      <p>
        La dirección no corresponde a ninguna pantalla. <Link to="/">Volver al inicio</Link>.
      </p>
    </>
  );
}

/**
 * Pantalla para una opción del menú que la sesión no tiene. Es solo una ayuda: la API vuelve
 * a decidir en cada ruta y respondería `403 forbidden`.
 */
function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { me } = useSession();
  if (hasPermission(me, permission)) return children;
  return (
    <>
      <PageHeading>Sin permiso</PageHeading>
      <Notice tone="error" title="Su rol no permite usar esta pantalla.">
        <p>
          Si necesita este acceso, pídalo a la administración de la plataforma. <Link to="/">Volver al inicio</Link>.
        </p>
      </Notice>
    </>
  );
}

/**
 * Enrutamiento según la etapa de la sesión que informa `GET /me`: sin sesión, solo inicio de
 * sesión y activación; en cada etapa previa, solo su pantalla; con sesión completa, la
 * aplicación. La activación (`/activar`) se admite en cualquier etapa.
 */
export function App() {
  const { me, loadError, refresh } = useSession();
  const location = useLocation();

  if (location.pathname === '/activar') {
    return (
      <PublicLayout>
        <ActivatePage />
      </PublicLayout>
    );
  }
  if (me === undefined) {
    return (
      <PublicLayout>
        <p role="status">Cargando…</p>
      </PublicLayout>
    );
  }
  if (loadError !== null) {
    return (
      <PublicLayout>
        <PageHeading>No fue posible cargar la plataforma</PageHeading>
        <Notice tone="error">
          {messageOf(loadError)}{' '}
          <Button className="button button-small" onPress={() => void refresh()}>
            Reintentar
          </Button>
        </Notice>
      </PublicLayout>
    );
  }
  if (me === null) {
    return (
      <PublicLayout>
        <Routes>
          <Route path="/iniciar-sesion" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/iniciar-sesion" replace />} />
        </Routes>
      </PublicLayout>
    );
  }
  if (me.stage !== 'full') {
    const path = STAGE_PATH[me.stage];
    return (
      <PublicLayout>
        <Routes>
          <Route path="/verificacion" element={me.stage === 'mfa_pending' ? <MfaVerifyPage /> : <Navigate to={path} replace />} />
          <Route path="/configurar-mfa" element={me.stage === 'mfa_enroll' ? <MfaSetupPage /> : <Navigate to={path} replace />} />
          <Route path="/cambiar-contrasena" element={me.stage === 'password_change' ? <PasswordChangeRequiredPage /> : <Navigate to={path} replace />} />
          <Route path="*" element={<Navigate to={path} replace />} />
        </Routes>
      </PublicLayout>
    );
  }
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/mi-cuenta" element={<AccountPage />} />
        <Route path="/usuarios" element={<RequirePermission permission="users.read"><UsersPage /></RequirePermission>} />
        <Route path="/registro-de-accesos" element={<RequirePermission permission="access_log.read"><AccessLogPage /></RequirePermission>} />
        <Route path="/bitacora" element={<RequirePermission permission="audit_log.export"><AuditExportPage /></RequirePermission>} />
        {['/iniciar-sesion', '/verificacion', '/configurar-mfa', '/cambiar-contrasena'].map((p) => (
          <Route key={p} path={p} element={<Navigate to="/" replace />} />
        ))}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppLayout>
  );
}
