// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchMe, logout as apiLogout, type MeResult } from '../api/endpoints.js';
import { installSessionHooks, setCsrfToken } from '../api/http.js';
import type { Me } from '../api/schemas.js';
import { clockFromMe, renewed, type SessionClock } from './session-clock.js';

/**
 * Estado de la sesión en la SPA. La fuente de verdad es la API: `GET /me` se consulta al
 * cargar, después de cada cambio de etapa y cuando la persona elige "continuar". **No** se
 * consulta periódicamente (renovaría la inactividad sin la persona, `2c2-api.md` §1).
 */

export const ME_KEY = ['me'] as const;

export interface SessionContextValue {
  /** `undefined` mientras carga; `null` sin sesión. */
  me: Me | null | undefined;
  /** Error al consultar `/me` (p. ej. servidor caído), distinto de "sin sesión". */
  loadError: unknown;
  /** Mensaje para la pantalla de inicio de sesión (p. ej. sesión expirada). */
  notice: string | null;
  clearNotice: () => void;
  /** Vuelve a consultar `/me` (renueva la inactividad: solo tras una acción de la persona). */
  refresh: () => Promise<void>;
  /** Cierra la sesión en la API y en la SPA. */
  logout: (notice?: string) => Promise<void>;
  /** Termina la sesión en la SPA sin llamar a la API (ya no existe en el servidor). */
  endLocally: (notice: string | null) => void;
  clock: SessionClock | null;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Mensajes entre pestañas del mismo navegador (no es almacenamiento: no persiste nada). */
type TabMessage = { type: 'activity'; idleDeadline: number } | { type: 'logout' };
const CHANNEL = 'auditor-21719-sesion';

const NOTICE_EXPIRED = 'Su sesión expiró. Inicie sesión nuevamente.';
const NOTICE_REQUIRED = 'Debe iniciar sesión para continuar.';
const NOTICE_OTHER_TAB = 'La sesión se cerró en otra pestaña de este navegador.';

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery<MeResult | null>({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [clock, setClock] = useState<SessionClock | null>(null);
  const clockRef = useRef<SessionClock | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  const updateClock = useCallback((next: SessionClock | null) => {
    clockRef.current = next;
    setClock(next);
  }, []);

  // El reloj se reinicia con cada respuesta de `/me` en sesión completa.
  useEffect(() => {
    const data = query.data;
    if (data !== undefined && data !== null && data.me.stage === 'full') {
      updateClock(clockFromMe(data.me.session, data.serverDate, data.receivedAt));
    } else {
      updateClock(null);
    }
  }, [query.data, updateClock]);

  const endLocally = useCallback(
    (message: string | null) => {
      setCsrfToken(null);
      updateClock(null);
      setNotice(message);
      // Se descartan los datos de las pantallas (p. ej. la lista de usuarios) de la sesión anterior.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] });
      queryClient.setQueryData<MeResult | null>(ME_KEY, null);
    },
    [queryClient, updateClock],
  );

  const refresh = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ME_KEY, exact: true });
  }, [queryClient]);

  const logout = useCallback(
    async (message?: string) => {
      try {
        await apiLogout();
      } catch {
        // Si la sesión ya no existe en el servidor, igual se cierra en la SPA.
      }
      channelRef.current?.postMessage({ type: 'logout' } satisfies TabMessage);
      endLocally(message ?? null);
    },
    [endLocally],
  );

  // Comunicación entre pestañas: comparten la misma sesión (cookie), así que comparten plazos.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined;
    const channel = new BroadcastChannel(CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const msg = event.data as Partial<TabMessage> | null;
      if (msg?.type === 'logout') {
        if (queryClient.getQueryData(ME_KEY) !== null) endLocally(NOTICE_OTHER_TAB);
      } else if (msg?.type === 'activity' && typeof msg.idleDeadline === 'number') {
        const current = clockRef.current;
        if (current !== null && msg.idleDeadline > current.idleDeadline) {
          updateClock({ ...current, idleDeadline: Math.min(msg.idleDeadline, current.absoluteDeadline) });
        }
      }
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [endLocally, queryClient, updateClock]);

  // Ganchos del cliente HTTP: expiración, cambio de etapa y actividad.
  useEffect(
    () =>
      installSessionHooks({
        onUnauthenticated: (code) => {
          endLocally(code === 'session_expired' ? NOTICE_EXPIRED : NOTICE_REQUIRED);
        },
        onStageMismatch: () => {
          // P. ej. un administrador desbloqueó la MFA y ahora debe cambiar la contraseña (D-93).
          void refresh();
        },
        onActivity: () => {
          const current = clockRef.current;
          if (current === null) return;
          const next = renewed(current, Date.now());
          if (next !== current) {
            updateClock(next);
            channelRef.current?.postMessage({ type: 'activity', idleDeadline: next.idleDeadline } satisfies TabMessage);
          }
        },
      }),
    [endLocally, refresh, updateClock],
  );

  const me = query.isPending ? undefined : (query.data?.me ?? null);
  const value = useMemo<SessionContextValue>(
    () => ({
      me: query.isError ? null : me,
      loadError: query.isError ? query.error : null,
      notice,
      clearNotice: () => {
        setNotice(null);
      },
      refresh,
      logout,
      endLocally,
      clock,
    }),
    [me, query.isError, query.error, notice, refresh, logout, endLocally, clock],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) throw new Error('useSession fuera de SessionProvider');
  return ctx;
}

/** Sesión completa (solo dentro de las rutas protegidas). */
export function useFullSession(): Extract<Me, { stage: 'full' }> {
  const { me } = useSession();
  if (me?.stage !== 'full') throw new Error('Se esperaba una sesión completa');
  return me;
}

export function hasPermission(me: Me | null | undefined, permission: string): boolean {
  return me?.stage === 'full' && me.permissions.includes(permission);
}
