// SPDX-License-Identifier: AGPL-3.0-or-later

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const root = document.getElementById('root');
if (root === null) throw new Error('No se encontró el elemento raíz #root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
