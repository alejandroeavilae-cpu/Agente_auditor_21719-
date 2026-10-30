// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef } from 'react';

/**
 * Título principal de cada pantalla. Actualiza el título de la pestaña (WCAG 2.4.2) y, al
 * navegar dentro de la SPA, mueve el foco al título para que el lector de pantalla anuncie
 * la pantalla nueva (en una SPA el navegador no lo hace solo). En la primera carga no se
 * mueve el foco.
 */
let navigatedOnce = false;

export function PageHeading({ children, title }: { children: string; title?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const text = title ?? children;
  useEffect(() => {
    document.title = `${text} · Auditor 21719`;
    if (navigatedOnce) ref.current?.focus();
    navigatedOnce = true;
  }, [text]);
  return (
    <h1 ref={ref} tabIndex={-1} className="page-heading">
      {children}
    </h1>
  );
}
