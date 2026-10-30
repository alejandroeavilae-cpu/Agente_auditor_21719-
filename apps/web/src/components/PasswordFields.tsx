// SPDX-License-Identifier: AGPL-3.0-or-later

import { Label, Meter } from 'react-aria-components';
import { MAX_LENGTH, MIN_LENGTH, passwordStrength } from '../lib/password-strength.js';
import { Field } from './Field.js';

/**
 * Contraseña nueva + confirmación, con indicador de fortaleza orientativo. El indicador
 * expone su valor como texto ("Buena") además de la barra, y aclara que la revisión final la
 * hace el servidor (contraseñas comunes incluidas).
 */
export interface PasswordFieldsProps {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  email?: string;
  passwordError?: string | null;
  confirmError?: string | null;
  label?: string;
}

export function PasswordFields(props: PasswordFieldsProps) {
  const strength = passwordStrength(props.password, props.email);
  return (
    <>
      <Field
        label={props.label ?? 'Contraseña nueva'}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        isRequired
        value={props.password}
        onChange={props.onPassword}
        error={props.passwordError ?? null}
        description={`Entre ${String(MIN_LENGTH)} y ${String(MAX_LENGTH)} caracteres. Una frase larga y fácil de recordar es una buena opción. Puede pegarla desde su gestor de contraseñas.`}
      />
      {props.password !== '' && (
        <div className="strength">
          <Meter className="strength-meter" value={strength.score} minValue={0} maxValue={4} valueLabel={strength.label}>
            {({ percentage, valueText }) => (
              <>
                <div className="strength-head">
                  <Label>Fortaleza estimada</Label>
                  <span className="strength-value">{valueText}</span>
                </div>
                <div className="strength-bar">
                  <div className={`strength-fill strength-${String(strength.score)}`} style={{ width: `${String(percentage)}%` }} />
                </div>
              </>
            )}
          </Meter>
          {strength.problems.length > 0 && (
            <ul className="strength-problems">
              {strength.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <p className="hint">Es una estimación. El servidor rechaza además contraseñas comunes.</p>
        </div>
      )}
      <Field
        label="Repita la contraseña nueva"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        isRequired
        value={props.confirm}
        onChange={props.onConfirm}
        error={props.confirmError ?? null}
      />
    </>
  );
}

/** Validación local mínima antes de enviar (la API valida igual). */
export function validateNewPassword(password: string, confirm: string, email?: string): { password: string | null; confirm: string | null } {
  const strength = passwordStrength(password, email);
  return {
    password: password === '' ? 'Escriba la contraseña nueva.' : (strength.problems[0] ?? null),
    confirm: confirm === '' ? 'Repita la contraseña nueva.' : confirm !== password ? 'Las contraseñas no coinciden. Escríbala igual en ambos campos.' : null,
  };
}
