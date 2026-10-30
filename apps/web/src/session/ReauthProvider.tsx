// SPDX-License-Identifier: AGPL-3.0-or-later

import { createContext, useCallback, useContext, useMemo, useRef, useState, type SyntheticEvent, type ReactNode } from 'react';
import { Button, Form } from 'react-aria-components';
import { reauth } from '../api/endpoints.js';
import { ApiError, isApiError, messageOf } from '../api/http.js';
import { AppDialog } from '../components/AppDialog.js';
import { Field } from '../components/Field.js';
import { Notice } from '../components/Notice.js';

/**
 * Reautenticación para acciones de alto riesgo (D-79, `2c2-api.md` §0): si la API responde
 * `403 reauth_required`, se pide el código MFA, se llama `POST /auth/reauth` y se repite la
 * acción una vez. Si la persona cancela, la acción no se repite.
 */
export interface ReauthContextValue {
  /** Ejecuta la acción y, si la API exige MFA reciente, pide el código y la reintenta. */
  withReauth: <T>(action: () => Promise<T>) => Promise<T>;
  /** Pide el código explícitamente (p. ej. antes de consultar el registro de accesos). */
  confirmCode: () => Promise<void>;
}

const ReauthContext = createContext<ReauthContextValue | null>(null);

export const REAUTH_CANCELLED = 'reauth_cancelled';

export function ReauthProvider({ children }: { children: ReactNode }) {
  const pending = useRef<{ resolve: () => void; reject: (e: unknown) => void } | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirmCode = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.current?.reject(new ApiError(0, REAUTH_CANCELLED, 'Se canceló la confirmación anterior.'));
        pending.current = { resolve, reject };
        setCode('');
        setError(null);
        setOpen(true);
      }),
    [],
  );

  const withReauth = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (e) {
        if (!isApiError(e, 'reauth_required')) throw e;
        await confirmCode();
        return action();
      }
    },
    [confirmCode],
  );

  const cancel = () => {
    setOpen(false);
    pending.current?.reject(new ApiError(0, REAUTH_CANCELLED, 'No se confirmó el código, así que la acción no se realizó.'));
    pending.current = null;
  };

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(value)) {
      setError('Escriba los 6 dígitos que muestra su app autenticadora.');
      return;
    }
    setBusy(true);
    try {
      await reauth(value);
      setOpen(false);
      pending.current?.resolve();
      pending.current = null;
    } catch (err) {
      setError(
        isApiError(err, 'invalid_code')
          ? 'Código incorrecto o ya usado. Espere a que su app muestre un código nuevo e inténtelo otra vez.'
          : messageOf(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const value = useMemo(() => ({ withReauth, confirmCode }), [withReauth, confirmCode]);
  return (
    <ReauthContext.Provider value={value}>
      {children}
      <AppDialog
        isOpen={open}
        onOpenChange={(next) => {
          if (!next) cancel();
        }}
        title="Confirme su código de verificación"
      >
        <p>Por seguridad, esta acción requiere confirmar que es usted. Escriba el código de 6 dígitos de su app autenticadora.</p>
        <Form onSubmit={(e) => void submit(e)} validationBehavior="aria">
          <Field
            label="Código de verificación"
            name="reauthCode"
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={7}
            isRequired
            autoFocus
            value={code}
            onChange={setCode}
            error={error}
          />
          {error !== null && <Notice tone="error">{error}</Notice>}
          <div className="actions">
            <Button type="submit" className="button button-primary" isDisabled={busy}>
              {busy ? 'Verificando…' : 'Confirmar'}
            </Button>
            <Button className="button" onPress={cancel}>
              Cancelar
            </Button>
          </div>
        </Form>
      </AppDialog>
    </ReauthContext.Provider>
  );
}

export function useReauth(): ReauthContextValue {
  const ctx = useContext(ReauthContext);
  if (ctx === null) throw new Error('useReauth fuera de ReauthProvider');
  return ctx;
}
