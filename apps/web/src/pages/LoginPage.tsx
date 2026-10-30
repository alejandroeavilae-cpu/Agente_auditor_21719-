// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type SyntheticEvent } from 'react';
import { Button, Form } from 'react-aria-components';
import { login } from '../api/endpoints.js';
import { isApiError, messageOf } from '../api/http.js';
import { Field } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { PageHeading } from '../components/PageHeading.js';
import { useSession } from '../session/SessionProvider.js';

/**
 * Inicio de sesión: correo y contraseña. La API responde un mensaje único ante cualquier
 * fallo (no revela si el correo existe, D-75 ajustada) y la pantalla lo muestra tal cual.
 */
export function LoginPage() {
  const { notice, clearNotice, refresh } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email: string | null; password: string | null }>({ email: null, password: null });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFailure(null);
    const next = {
      email: email.trim() === '' ? 'Escriba su correo institucional.' : null,
      password: password === '' ? 'Escriba su contraseña.' : null,
    };
    setErrors(next);
    if (next.email !== null || next.password !== null) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      clearNotice();
      await refresh();
    } catch (err) {
      setPassword('');
      setFailure(
        isApiError(err, 'invalid_credentials')
          ? `${messageOf(err)} Revise ambos datos e intente de nuevo. Si olvidó su contraseña o su cuenta está bloqueada, contacte a la administración de la plataforma.`
          : messageOf(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeading>Iniciar sesión</PageHeading>
      {notice !== null && <Notice tone="info">{notice}</Notice>}
      <Form ref={formRef} onSubmit={(e) => void submit(e)} validationBehavior="aria" className="form">
        <Field label="Correo" name="email" type="email" autoComplete="username" inputMode="email" isRequired value={email} onChange={setEmail} error={errors.email} />
        <Field label="Contraseña" name="password" type="password" autoComplete="current-password" isRequired value={password} onChange={setPassword} error={errors.password} />
        {failure !== null && <Notice tone="error">{failure}</Notice>}
        <div className="actions">
          <Button type="submit" className="button button-primary" isDisabled={busy}>
            {busy ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </div>
      </Form>
      <p className="hint">Después de la contraseña se pedirá el código de su app autenticadora (verificación en dos pasos).</p>
    </>
  );
}
