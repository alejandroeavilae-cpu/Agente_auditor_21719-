// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';
import { formatVersion, parseAbout, type About } from './about.js';

/**
 * Página mínima de la Fase 1. Muestra el estado del proyecto y el enlace al
 * código fuente exacto en ejecución (AGPL §13). La interfaz funcional se
 * construye desde la Fase 2.
 */
export function App() {
  const [about, setAbout] = useState<About | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/v1/about', { signal: controller.signal })
      .then((res) => res.json())
      .then((json: unknown) => {
        const parsed = parseAbout(json);
        if (parsed === null) setError(true);
        else setAbout(parsed);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => {
      controller.abort();
    };
  }, []);

  return (
    <main>
      <h1>Auditor 21719</h1>
      <p>
        Plataforma open source de auditoría de protección de datos personales (Ley 19.628 modificada por la Ley
        21.719).
      </p>
      <p>
        <strong>Estado:</strong> Fase 1 — infraestructura base. Aún no hay funciones de auditoría.
      </p>
      <section aria-live="polite">
        {about !== null && (
          <p>
            Versión {formatVersion(about)} · Licencia {about.license} ·{' '}
            <a href={about.sourceForThisVersionUrl} rel="noopener noreferrer">
              Código fuente de esta versión
            </a>
          </p>
        )}
        {error && <p role="alert">No fue posible obtener la información de versión desde la API.</p>}
      </section>
    </main>
  );
}
