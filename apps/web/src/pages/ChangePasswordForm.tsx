// SPDX-License-Identifier: AGPL-3.0-or-later

import { useRef, useState, type SyntheticEvent } from 'react';
import { Button, Form } from 'react-aria-components';
import { changePassword } from '../api/endpoints.js';
import { isApiError, messageOf } from '../api/http.js';
import { Field } from '../components/Field.js';
import { Notice } from '../components/Notice.js';
import { PasswordFields, validateNewPassword } from '../components/PasswordFields.js';

/**
 * Cambio de contraseña (`POST /auth/password`), usado en "Mi cuenta" y en la etapa
 * obligatoria `password_change` (D-93). La API exige que la nueva sea distinta de la actual
 * (`password_reused`) y cierra las demás sesiones de la persona.
 */
export function ChangePasswordForm({ email, onChanged, submitLabel }: { email?: string; onChanged: () => Promise<void>; submitLabel: string }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ current: string | null; next: string | null; confirm: string | null }>({ current: null, next: null, confirm: null });
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const focusFirstInvalid = () => {
    requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
    });
  };

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFailure(null);
    const local = validateNewPassword(next, confirm, email);
    const nextErrors = { current: current === '' ? 'Escriba su contraseña actual.' : null, next: local.password, confirm: local.confirm };
    if (nextErrors.current === null && nextErrors.next === null && next === current) nextErrors.next = 'La nueva contraseña debe ser distinta de la actual.';
    setErrors(nextErrors);
    if (nextErrors.current !== null || nextErrors.next !== null || nextErrors.confirm !== null) {
      focusFirstInvalid();
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      await onChanged();
    } catch (err) {
      if (isApiError(err, 'invalid_credentials')) {
        setErrors({ current: 'La contraseña actual no es correcta. Revísela e intente de nuevo.', next: null, confirm: null });
        focusFirstInvalid();
      } else if (isApiError(err, 'weak_password') || isApiError(err, 'password_reused')) {
        setErrors({ current: null, next: messageOf(err), confirm: null });
        focusFirstInvalid();
      } else {
        setFailure(messageOf(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form ref={formRef} onSubmit={(e) => void submit(e)} validationBehavior="aria" className="form">
      <Field label="Contraseña actual" name="currentPassword" type="password" autoComplete="current-password" isRequired value={current} onChange={setCurrent} error={errors.current} />
      <PasswordFields
        password={next}
        confirm={confirm}
        onPassword={setNext}
        onConfirm={setConfirm}
        passwordError={errors.next}
        confirmError={errors.confirm}
        {...(email !== undefined ? { email } : {})}
      />
      {failure !== null && <Notice tone="error">{failure}</Notice>}
      <div className="actions">
        <Button type="submit" className="button button-primary" isDisabled={busy}>
          {busy ? 'Guardando…' : submitLabel}
        </Button>
      </div>
    </Form>
  );
}
