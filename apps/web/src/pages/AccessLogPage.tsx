// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { useId, useState, type SyntheticEvent } from 'react';
import { Button, Form } from 'react-aria-components';
import { fetchAccessLog, fetchUsers } from '../api/endpoints.js';
import { isApiError, messageOf } from '../api/http.js';
import { Field } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { PageHeading } from '../components/PageHeading.js';
import { ALERT_EVENTS, EVENT_GROUPS, eventLabel, groupEvents } from '../lib/access-events.js';
import { formatDateTime, localDateEndToUtcIso, localDateToUtcIso } from '../lib/format.js';
import { useReauth } from '../session/ReauthProvider.js';
import { USERS_KEY } from './users/UsersPage.js';

const PAGE_SIZE = 50;

interface Filters {
  eventChoice: string;
  userId: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { eventChoice: 'all', userId: '', from: '', to: '' };

function eventsOf(choice: string): readonly string[] {
  if (choice.startsWith('group:')) return groupEvents(choice.slice('group:'.length));
  if (choice.startsWith('event:')) return [choice.slice('event:'.length)];
  return [];
}

/**
 * Registro de accesos (solo lectura, D-88): intentos de ingreso, bloqueos y alertas, con IP
 * en claro (D-78). Cada página exige MFA reciente y queda registrada en la bitácora.
 * Paginación por cursor opaco: la pantalla nunca lo construye ni lo modifica.
 */
export function AccessLogPage() {
  const { confirmCode } = useReauth();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const eventSelectId = useId();
  const userSelectId = useId();
  const cursor = cursors[cursors.length - 1] ?? null;
  const users = useQuery({ queryKey: USERS_KEY, queryFn: fetchUsers, retry: false, refetchOnWindowFocus: false });

  const from = localDateToUtcIso(applied.from);
  const to = localDateEndToUtcIso(applied.to);
  const page = useQuery({
    queryKey: ['access-log', applied, cursor],
    queryFn: ({ signal }) => fetchAccessLog({ limit: PAGE_SIZE, cursor, events: eventsOf(applied.eventChoice), userId: applied.userId || null, from, to }, signal),
    retry: false,
    refetchOnWindowFocus: false,
    // Cada consulta queda en la bitácora: no se repite sola. Y como trae IP en claro, no se
    // conserva en memoria al salir de la pantalla.
    staleTime: Infinity,
    gcTime: 0,
  });

  const apply = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = localDateToUtcIso(draft.from);
    const t = localDateEndToUtcIso(draft.to);
    let problem: string | null = null;
    if (draft.from !== '' && f === null) problem = 'La fecha "Desde" no es válida.';
    else if (draft.to !== '' && t === null) problem = 'La fecha "Hasta" no es válida.';
    else if (f !== null && t !== null && f >= t) problem = 'La fecha "Desde" debe ser anterior o igual a "Hasta".';
    setRangeError(problem);
    if (problem !== null) return;
    setApplied(draft);
    setCursors([null]);
  };

  const confirmAndRetry = async () => {
    try {
      await confirmCode();
      await page.refetch();
    } catch {
      // Cancelado: se mantiene el aviso para que la persona decida.
    }
  };

  const events = page.data?.events ?? [];
  const pageNumber = cursors.length;

  return (
    <>
      <PageHeading>Registro de accesos</PageHeading>
      <p>
        Intentos de inicio de sesión, bloqueos y alertas de la organización, del más reciente al más antiguo. Incluye la dirección IP de cada intento:
        trátela como dato personal. Se conserva 90 días por defecto. Cada consulta queda registrada en la bitácora.
      </p>

      <Form onSubmit={apply} validationBehavior="aria" className="filters" aria-label="Filtros del registro de accesos">
        <div className="field">
          <label className="field-label" htmlFor={eventSelectId}>
            Tipo de evento
          </label>
          <select id={eventSelectId} className="field-input" value={draft.eventChoice} onChange={(e) => { setDraft({ ...draft, eventChoice: e.target.value }); }}>
            <option value="all">Todos los eventos</option>
            {EVENT_GROUPS.map((g) => (
              <optgroup key={g.id} label={g.label}>
                <option value={`group:${g.id}`}>{`${g.label} (todos)`}</option>
                {g.events.map((ev) => (
                  <option key={ev} value={`event:${ev}`}>
                    {eventLabel(ev)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={userSelectId}>
            Persona
          </label>
          <select id={userSelectId} className="field-input" value={draft.userId} onChange={(e) => { setDraft({ ...draft, userId: e.target.value }); }}>
            <option value="">Todas las personas</option>
            {(users.data ?? []).map((u) => (
              <option key={u.id} value={u.id}>{`${u.displayName} (${u.email})`}</option>
            ))}
          </select>
        </div>
        <Field label="Desde (fecha local)" name="from" type="date" value={draft.from} onChange={(v) => { setDraft({ ...draft, from: v }); }} error={null} />
        <Field label="Hasta (fecha local, inclusive)" name="to" type="date" value={draft.to} onChange={(v) => { setDraft({ ...draft, to: v }); }} error={rangeError} />
        <div className="actions">
          <Button type="submit" className="button button-primary">
            Aplicar filtros
          </Button>
          <Button
            className="button"
            onPress={() => {
              setDraft(EMPTY);
              setApplied(EMPTY);
              setCursors([null]);
              setRangeError(null);
            }}
          >
            Quitar filtros
          </Button>
        </div>
      </Form>

      {page.isPending && <p role="status">Cargando registro…</p>}
      {page.isError &&
        (isApiError(page.error, 'reauth_required') ? (
          <Notice tone="warning" title="Confirme su código para ver el registro.">
            <p>El registro contiene direcciones IP y requiere una verificación reciente (de los últimos 5 minutos).</p>
            <Button className="button button-primary" onPress={() => void confirmAndRetry()}>
              Confirmar código
            </Button>
          </Notice>
        ) : isApiError(page.error, 'invalid_cursor') ? (
          <Notice tone="error">
            {messageOf(page.error)}{' '}
            <Button className="button button-small" onPress={() => { setCursors([null]); }}>
              Volver a la primera página
            </Button>
          </Notice>
        ) : isApiError(page.error, 'forbidden') ? (
          <Notice tone="error" title="No tiene permiso para ver el registro de accesos.">
            <p>Esta pantalla es solo para el Administrador de organización.</p>
          </Notice>
        ) : (
          <Notice tone="error">
            {messageOf(page.error)}{' '}
            <Button className="button button-small" onPress={() => void page.refetch()}>
              Reintentar
            </Button>
          </Notice>
        ))}

      {page.data !== undefined && (
        <>
          <p className="hint">
            &quot;Sin persona asociada&quot; aparece en intentos con un correo que no existe en la organización (por privacidad no se guarda el correo
            intentado) y en eventos del sistema.
          </p>
          <div className="table-wrap" role="region" aria-labelledby="log-caption" tabIndex={0}>
            <table className="table">
              <caption id="log-caption">{`Página ${String(pageNumber)}: ${String(events.length)} ${events.length === 1 ? 'evento' : 'eventos'}`}</caption>
              <thead>
                <tr>
                  <th scope="col">Fecha y hora</th>
                  <th scope="col">Evento</th>
                  <th scope="col">Persona</th>
                  <th scope="col">IP</th>
                  <th scope="col">Navegador</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 && (
                  <tr>
                    <td colSpan={5}>No hay eventos con estos filtros.</td>
                  </tr>
                )}
                {events.map((ev) => {
                  const alert = ALERT_EVENTS.has(ev.event);
                  return (
                    <tr key={ev.id} className={alert ? 'row-alert' : undefined}>
                      <td className="nowrap">{formatDateTime(ev.ts)}</td>
                      <td>
                        {alert && <span className="badge badge-danger">Alerta</span>} {eventLabel(ev.event)}
                        <span className="event-code mono">{ev.event}</span>
                      </td>
                      <td>{ev.userEmail ?? 'Sin persona asociada'}</td>
                      <td className="mono">{ev.ip ?? 'No aplica'}</td>
                      <td>{ev.uaFamily ?? 'Desconocido'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <nav className="pager" aria-label="Páginas del registro">
            <Button className="button" isDisabled={cursors.length <= 1} onPress={() => { setCursors(cursors.slice(0, -1)); }}>
              Página anterior
            </Button>
            <span>{`Página ${String(pageNumber)}`}</span>
            <Button
              className="button"
              isDisabled={page.data.nextCursor === null}
              onPress={() => {
                const next = page.data.nextCursor;
                if (next !== null) setCursors([...cursors, next]);
              }}
            >
              Página siguiente
            </Button>
          </nav>
        </>
      )}
    </>
  );
}
