// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckboxButton, CheckboxField, CheckboxGroup, FieldError, Label, Text } from 'react-aria-components';
import { forbiddenCombinations, ROLE_HINTS, ROLE_LABELS, ROLES } from '../../lib/roles.js';
import { Notice } from '../../components/Notice.js';

/**
 * Selección de roles con la explicación de la separación de funciones (D-79). La advertencia
 * local es solo informativa: se puede enviar igual y la API responde con su propio mensaje
 * (`400 invalid_roles`), que es el que manda.
 */
export function RoleCheckboxes({ value, onChange, error }: { value: string[]; onChange: (v: string[]) => void; error: string | null }) {
  const conflicts = forbiddenCombinations(value);
  return (
    <>
      <CheckboxGroup className="checkbox-group" value={value} onChange={onChange} isInvalid={error !== null} validationBehavior="aria">
        <Label className="field-label">Roles</Label>
        <Text slot="description" className="field-description">
          Elija al menos uno. Por separación de funciones, el Administrador de organización no puede ser a la vez Responsable de auditoría, Auditor
          ni Revisor jurídico: quien gestiona los accesos no debe auditar ni decidir la conformidad legal.
        </Text>
        {ROLES.map((role) => (
          <CheckboxField key={role} value={role} className="checkbox-field">
            <CheckboxButton className="checkbox">
              <span className="checkbox-box" aria-hidden="true" />
              <span>
                {ROLE_LABELS[role]}
                <span className="checkbox-hint">{ROLE_HINTS[role]}</span>
              </span>
            </CheckboxButton>
          </CheckboxField>
        ))}
        <FieldError className="field-error">{error}</FieldError>
      </CheckboxGroup>
      {conflicts.length > 0 && (
        <Notice tone="warning" title="Esta combinación no está permitida.">
          <ul>
            {conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p>Si la envía, la plataforma la rechazará. Asigne esas funciones a personas distintas.</p>
        </Notice>
      )}
    </>
  );
}

