// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type SyntheticEvent } from 'react';
import { Button, CheckboxButton, CheckboxField, Form } from 'react-aria-components';
import { confirmMfa, enrollMfa } from '../api/endpoints.js';
import { isApiError, messageOf } from '../api/http.js';
import { Field } from '../components/Field.js';
import { LiveMessage, Notice } from '../components/Notice.js';
import { PageHeading } from '../components/PageHeading.js';
import { QrCode } from '../components/QrCode.js';
import { recoveryCodesText, saveBlob } from '../lib/download.js';
import { useSession } from '../session/SessionProvider.js';

/**
 * Configuración obligatoria de la MFA (D-86): QR generado en el navegador, clave en texto
 * para ingresarla a mano y confirmación con un código. Después muestra los códigos de
 * recuperación UNA sola vez; la sesión no avanza hasta que la persona confirma que los guardó.
 */
export function MfaSetupPage() {
  const { me, refresh, logout } = useSession();
  // `enroll` crea un secreto pendiente en el servidor: se pide una sola vez por pantalla.
  const enrollment = useQuery({ queryKey: ['mfa-enroll'], queryFn: enrollMfa, staleTime: Infinity, gcTime: 0, retry: false, refetchOnWindowFocus: false });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) {
      setError('Escriba los 6 dígitos que muestra su app autenticadora.');
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await confirmMfa(clean);
      setRecoveryCodes(result.recoveryCodes);
    } catch (err) {
      setCode('');
      setError(isApiError(err, 'invalid_code') ? 'El código no coincide. Revise que escaneó el código QR de esta pantalla y escriba el código actual de su app.' : messageOf(err));
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  if (recoveryCodes !== null) {
    return <RecoveryCodes codes={recoveryCodes} organization={me?.organization.name ?? ''} onDone={refresh} />;
  }

  const secretGroups = enrollment.data?.secret.match(/.{1,4}/g)?.join(' ') ?? '';
  return (
    <>
      <PageHeading>Configurar la verificación en dos pasos</PageHeading>
      <p>
        Para proteger la información de la institución, todas las cuentas usan un segundo factor: un código que cambia cada 30 segundos en una app
        autenticadora de su teléfono (por ejemplo, una app de código abierto como Aegis o FreeOTP).
      </p>
      {enrollment.isPending && <p role="status">Preparando la configuración…</p>}
      {enrollment.isError && (
        <Notice tone="error">
          {messageOf(enrollment.error)}{' '}
          <Button className="button button-small" onPress={() => void enrollment.refetch()}>
            Reintentar
          </Button>
        </Notice>
      )}
      {enrollment.data !== undefined && (
        <ol className="steps">
          <li>
            <h2>Agregue la cuenta en su app</h2>
            <p>Escanee este código QR con la app autenticadora.</p>
            <QrCode value={enrollment.data.otpauthUri} label="Código QR para agregar Auditor 21719 a su app autenticadora" />
            <p>Si no puede escanearlo, ingrese esta clave a mano en la app (tipo: basada en tiempo):</p>
            <p className="secret mono" data-testid="mfa-secret">
              {secretGroups}
            </p>
          </li>
          <li>
            <h2>Confirme con un código</h2>
            <Form onSubmit={(e) => void submit(e)} validationBehavior="aria" className="form">
              <Field
                label="Código de 6 dígitos de la app"
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                isRequired
                maxLength={7}
                inputRef={inputRef}
                value={code}
                onChange={setCode}
                error={error}
              />
              {error !== null && <Notice tone="error">{error}</Notice>}
              <div className="actions">
                <Button type="submit" className="button button-primary" isDisabled={busy}>
                  {busy ? 'Confirmando…' : 'Confirmar y activar'}
                </Button>
              </div>
            </Form>
          </li>
        </ol>
      )}
      <div className="actions">
        <Button className="button" onPress={() => void logout()}>
          Cerrar sesión y continuar después
        </Button>
      </div>
    </>
  );
}

function RecoveryCodes({ codes, organization, onDone }: { codes: string[]; organization: string; onDone: () => Promise<void> }) {
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const text = recoveryCodesText(codes, organization, new Date());

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setMessage('Códigos copiados al portapapeles.');
    } catch {
      setMessage('No se pudo copiar automáticamente. Descárguelos como archivo o cópielos a mano.');
    }
  };

  return (
    <>
      <PageHeading>Guarde sus códigos de recuperación</PageHeading>
      <Notice tone="warning" title="Se muestran una sola vez.">
        <p>
          Si pierde su teléfono, cada código le permite entrar una vez. Guárdelos ahora en un lugar seguro (por ejemplo, su gestor de contraseñas). No
          podrá volver a verlos; si recarga esta página se perderán.
        </p>
      </Notice>
      <ol className="recovery-codes mono" aria-label="Códigos de recuperación">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="actions">
        <Button className="button" onPress={() => { saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'codigos-recuperacion-auditor-21719.txt'); setMessage('Archivo de códigos descargado.'); }}>
          Descargar como archivo .txt
        </Button>
        <Button className="button" onPress={() => void copy()}>
          Copiar códigos
        </Button>
      </div>
      <LiveMessage message={message} />
      <CheckboxField className="checkbox-field" isSelected={saved} onChange={setSaved}>
        <CheckboxButton className="checkbox">
          <span className="checkbox-box" aria-hidden="true" />
          Guardé mis códigos de recuperación en un lugar seguro
        </CheckboxButton>
      </CheckboxField>
      <div className="actions">
        <Button
          className="button button-primary"
          isDisabled={!saved || busy}
          onPress={() => {
            setBusy(true);
            void onDone().finally(() => {
              setBusy(false);
            });
          }}
        >
          Continuar
        </Button>
      </div>
      {!saved && <p className="hint">Para continuar, marque la casilla que confirma que guardó los códigos.</p>}
    </>
  );
}
