// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type SyntheticEvent } from 'react';
import { Button, Form } from 'react-aria-components';
import { verifyMfa } from '../api/endpoints.js';
import { isApiError, messageOf } from '../api/http.js';
import { Field } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { PageHeading } from '../components/PageHeading.js';
import { useSession } from '../session/SessionProvider.js';

/** Segundo paso del inicio de sesión: código de 6 dígitos o código de recuperación. */
export function MfaVerifyPage() {
  const { refresh, logout } = useSession();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clean = value.replace(/\s/g, '');
    if (!useRecovery && !/^\d{6}$/.test(clean)) {
      setError('Escriba los 6 dígitos que muestra su app autenticadora.');
      inputRef.current?.focus();
      return;
    }
    if (useRecovery && clean.replace(/-/g, '').length < 16) {
      setError('Escriba el código de recuperación completo (16 caracteres; los guiones son opcionales).');
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(useRecovery ? { recoveryCode: clean } : { code: clean });
      await refresh();
    } catch (err) {
      setValue('');
      setError(
        isApiError(err, 'invalid_code')
          ? 'Código incorrecto o ya usado. Espere a que su app muestre un código nuevo e inténtelo otra vez. Tras varios intentos fallidos la verificación se bloquea por un tiempo.'
          : messageOf(err),
      );
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeading>Verificación en dos pasos</PageHeading>
      <p>{useRecovery ? 'Escriba uno de sus códigos de recuperación. Cada código sirve una sola vez.' : 'Abra su app autenticadora y escriba el código de 6 dígitos de Auditor 21719.'}</p>
      <Form onSubmit={(e) => void submit(e)} validationBehavior="aria" className="form">
        {useRecovery ? (
          <Field key="recovery" label="Código de recuperación" name="recoveryCode" autoComplete="one-time-code" isRequired maxLength={40} inputRef={inputRef} value={value} onChange={setValue} error={error} autoFocus />
        ) : (
          <Field key="totp" label="Código de verificación" name="code" autoComplete="one-time-code" inputMode="numeric" isRequired maxLength={7} inputRef={inputRef} value={value} onChange={setValue} error={error} autoFocus />
        )}
        {error !== null && <Notice tone="error">{error}</Notice>}
        <div className="actions">
          <Button type="submit" className="button button-primary" isDisabled={busy}>
            {busy ? 'Verificando…' : 'Verificar'}
          </Button>
          <Button
            className="button button-link"
            onPress={() => {
              setUseRecovery(!useRecovery);
              setValue('');
              setError(null);
            }}
          >
            {useRecovery ? 'Usar el código de la app' : 'No tengo mi app: usar un código de recuperación'}
          </Button>
        </div>
      </Form>
      <p className="hint">Si no tiene su app ni sus códigos de recuperación, pida a la administración que reinicie su verificación en dos pasos.</p>
      <div className="actions">
        <Button className="button" onPress={() => void logout()}>
          Cancelar y volver al inicio de sesión
        </Button>
      </div>
    </>
  );
}
