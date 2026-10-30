// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Button, Form } from 'react-aria-components';
import { useNavigate } from 'react-router';
import { activate } from '../api/endpoints.js';
import { isApiError, messageOf } from '../api/http.js';
import { activationTokenSchema } from '../api/schemas.js';
import { Notice } from '../components/Notice.js';
import { PageHeading } from '../components/PageHeading.js';
import { PasswordFields, validateNewPassword } from '../components/PasswordFields.js';
import { useSession } from '../session/SessionProvider.js';

/**
 * Lee el token del fragmento de la URL (`/activar#<token>`). El fragmento nunca se envía al
 * servidor, ni queda en registros del proxy ni en la cabecera `Referer` (2C §2.2).
 */
function readTokenFromHash(): string | null {
  const raw = window.location.hash.replace(/^#/, '');
  const parsed = activationTokenSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Activación de cuenta desde el enlace: sirve para invitaciones y para el reinicio de MFA
 * (D-92). Pide una contraseña nueva y luego obliga a configurar la MFA.
 */
export function ActivatePage() {
  const navigate = useNavigate();
  const { refresh } = useSession();
  // Se lee una sola vez, antes de borrar el fragmento. El token queda solo en la memoria de
  // este componente: no se guarda en ningún almacenamiento del navegador.
  const [token, setToken] = useState(readTokenFromHash);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password: string | null; confirm: string | null }>({ password: null, confirm: null });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Borra el token de la barra de direcciones y del historial (history.replaceState). Si se
  // pega otro enlace en la misma pestaña, el navegador solo cambia el fragmento (sin recargar):
  // se lee el nuevo token y se borra igual.
  useEffect(() => {
    const clear = () => {
      if (window.location.hash !== '') window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    };
    const onHashChange = () => {
      const next = readTokenFromHash();
      if (next !== null) setToken(next);
      clear();
    };
    clear();
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (token === null) return;
    setFailure(null);
    const local = validateNewPassword(password, confirm);
    setErrors(local);
    if (local.password !== null || local.confirm !== null) {
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    try {
      await activate(token, password);
      await refresh();
      void navigate('/configurar-mfa', { replace: true });
    } catch (err) {
      if (isApiError(err, 'weak_password') || isApiError(err, 'password_reused')) {
        setErrors({ password: messageOf(err), confirm: null });
        requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      } else if (isApiError(err, 'invalid_token')) {
        setFailure(`${messageOf(err)} Pida a la administración de la plataforma un enlace nuevo.`);
      } else {
        setFailure(messageOf(err));
      }
    } finally {
      setBusy(false);
    }
  };

  if (token === null) {
    return (
      <>
        <PageHeading>Activar cuenta</PageHeading>
        <Notice tone="error" title="El enlace está incompleto o no es válido.">
          <p>Abra el enlace exactamente como lo recibió (incluida la parte después de #). Si el problema continúa, pida a la administración un enlace nuevo.</p>
        </Notice>
      </>
    );
  }

  return (
    <>
      <PageHeading>Activar cuenta</PageHeading>
      <p>Elija su contraseña. Después configurará la verificación en dos pasos con una app autenticadora de su teléfono.</p>
      <Form ref={formRef} onSubmit={(e) => void submit(e)} validationBehavior="aria" className="form">
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} passwordError={errors.password} confirmError={errors.confirm} label="Contraseña" />
        {failure !== null && <Notice tone="error">{failure}</Notice>}
        <div className="actions">
          <Button type="submit" className="button button-primary" isDisabled={busy}>
            {busy ? 'Activando…' : 'Activar cuenta'}
          </Button>
        </div>
      </Form>
    </>
  );
}
