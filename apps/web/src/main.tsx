// SPDX-License-Identifier: AGPL-3.0-or-later

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from 'react-aria-components';
import { BrowserRouter } from 'react-router';
import { App } from './App.js';
import { ReauthProvider } from './session/ReauthProvider.js';
import { SessionProvider } from './session/SessionProvider.js';
import './styles/app.css';

// Sin reintentos automáticos ni recargas al volver a la pestaña: varias rutas exigen MFA
// reciente o registran cada consulta en la bitácora, y `/me` renueva la inactividad.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
    mutations: { retry: false },
  },
});

const root = document.getElementById('root');
if (root === null) throw new Error('No se encontró el elemento raíz #root');
createRoot(root).render(
  <StrictMode>
    <I18nProvider locale="es-CL">
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SessionProvider>
            <ReauthProvider>
              <App />
            </ReauthProvider>
          </SessionProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
