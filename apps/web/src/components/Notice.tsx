// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReactNode } from 'react';

/**
 * Avisos en la página. Los errores usan `role="alert"` (se anuncian de inmediato) y los
 * resultados `role="status"` (se anuncian sin interrumpir). Cada aviso lleva un prefijo de
 * texto ("Error:", "Atención:", "Listo:"), así que no depende solo del color (WCAG 1.4.1).
 */
export type NoticeTone = 'error' | 'warning' | 'success' | 'info';

const PREFIX: Record<NoticeTone, string> = {
  error: 'Error:',
  warning: 'Atención:',
  success: 'Listo:',
  info: 'Información:',
};

export function Notice({ tone, children, title }: { tone: NoticeTone; children: ReactNode; title?: string }) {
  const role = tone === 'error' ? 'alert' : 'status';
  return (
    <div className={`notice notice-${tone}`} role={role}>
      <p className="notice-title">
        <strong>{PREFIX[tone]}</strong> {title}
      </p>
      <div className="notice-body">{children}</div>
    </div>
  );
}

/** Región viva vacía que anuncia mensajes cortos (p. ej. "Copiado"). */
export function LiveMessage({ message }: { message: string }) {
  return (
    <p className="live-message" role="status" aria-live="polite">
      {message}
    </p>
  );
}
