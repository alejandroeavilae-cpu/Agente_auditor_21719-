// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState } from 'react';
import { Button } from 'react-aria-components';
import { AppDialog } from '../components/AppDialog.js';
import { formatRemaining, phaseAt, type SessionPhase } from './session-clock.js';
import { useSession } from './SessionProvider.js';

/**
 * Aviso antes de que la sesión expire (2C §2.2). Revisa el reloj del cliente cada segundo;
 * nunca consulta la API para eso. "Continuar" sí llama `/me` (renueva la inactividad por
 * decisión de la persona). Al vencer, cierra la sesión en la API y vuelve al inicio de sesión.
 */
const IDLE_NOTICE = 'Su sesión se cerró por inactividad para proteger la información. Inicie sesión nuevamente.';
const ABSOLUTE_NOTICE = 'Su sesión alcanzó su duración máxima (12 horas). Inicie sesión nuevamente.';

export function IdleWatcher() {
  const { clock, refresh, logout } = useSession();
  const [phase, setPhase] = useState<SessionPhase | null>(null);
  const [busy, setBusy] = useState(false);
  const expiring = useRef(false);

  useEffect(() => {
    if (clock === null) {
      setPhase(null);
      return undefined;
    }
    expiring.current = false;
    const tick = () => {
      const next = phaseAt(clock, Date.now());
      setPhase(next);
      if (next.kind === 'expired' && !expiring.current) {
        expiring.current = true;
        void logout(next.reason === 'idle' ? IDLE_NOTICE : ABSOLUTE_NOTICE);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [clock, logout]);

  const warning = phase?.kind === 'warning' ? phase : null;
  const keepGoing = async () => {
    setBusy(true);
    try {
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppDialog isOpen={warning !== null} onOpenChange={() => undefined} title="Su sesión está por expirar" alert isDismissable={false}>
      {warning !== null && (
        <>
          {warning.reason === 'idle' ? (
            <p>
              Por inactividad, la sesión se cerrará en <strong>{formatRemaining(warning.remainingMs)}</strong>. Si sigue trabajando, elija
              &quot;Continuar con la sesión&quot;.
            </p>
          ) : (
            <p>
              La sesión llegará a su duración máxima en <strong>{formatRemaining(warning.remainingMs)}</strong> y no se puede extender. Guarde lo
              que esté haciendo; luego deberá iniciar sesión otra vez.
            </p>
          )}
          <div className="actions">
            {warning.reason === 'idle' && (
              <Button className="button button-primary" isDisabled={busy} onPress={() => void keepGoing()} autoFocus>
                Continuar con la sesión
              </Button>
            )}
            <Button className="button" onPress={() => void logout('Cerró su sesión.')}>
              Cerrar sesión ahora
            </Button>
          </div>
        </>
      )}
    </AppDialog>
  );
}
