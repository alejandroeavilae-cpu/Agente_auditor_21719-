// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import { activationUrl, formatDateTime } from '../lib/format.js';
import { LiveMessage, Notice } from './Notice.js';

/**
 * Enlace de activación mostrado UNA sola vez (invitación y reinicio de MFA, D-92). La URL se
 * arma con el origen actual y el token en el fragmento (`#`), que no viaja al servidor ni
 * queda en registros del proxy. El token no se guarda en ningún almacenamiento del navegador.
 */
export function OneTimeLink({ token, expiresAt, person, extraWarning }: { token: string; expiresAt: string; person: string; extraWarning?: string }) {
  const url = activationUrl(window.location.origin, token);
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Enlace copiado al portapapeles.');
    } catch {
      // Sin acceso al portapapeles (p. ej. permiso denegado): se selecciona para copiar a mano.
      inputRef.current?.select();
      setMessage('No se pudo copiar automáticamente. El enlace quedó seleccionado: cópielo con Ctrl+C (o Cmd+C).');
    }
  };

  return (
    <div className="one-time-link">
      <Notice tone="warning" title="Este enlace se muestra una sola vez.">
        <p>
          Entréguelo a {person} por un canal seguro y verifique su identidad por otro medio (por ejemplo, una llamada). Sirve una sola vez y vence el{' '}
          {formatDateTime(expiresAt)}. Si se pierde o vence, deberá generar uno nuevo.
        </p>
        {extraWarning !== undefined && <p>{extraWarning}</p>}
      </Notice>
      <label className="field-label" htmlFor="activation-link">
        Enlace de activación
      </label>
      <div className="copy-row">
        <input id="activation-link" ref={inputRef} className="field-input mono" readOnly value={url} onFocus={(e) => { e.currentTarget.select(); }} />
        <Button className="button" onPress={() => void copy()}>
          Copiar enlace
        </Button>
      </div>
      <LiveMessage message={message} />
    </div>
  );
}
