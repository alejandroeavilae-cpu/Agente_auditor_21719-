// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Ref } from 'react';
import { FieldError, Input, Label, Text, TextField } from 'react-aria-components';

/**
 * Campo de texto accesible (React Aria): etiqueta visible, descripción y error asociados al
 * campo con `aria-describedby`, y `aria-invalid` cuando hay error. La validación la hace el
 * formulario (mensajes propios en español), no el navegador.
 *
 * Criterio 3.3.8 (WCAG 2.2): nunca se bloquea pegar y se declara `autoComplete` para que
 * funcionen los gestores de contraseñas.
 */
export interface FieldProps {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password' | 'date';
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'email';
  description?: string;
  error?: string | null;
  isRequired?: boolean;
  maxLength?: number;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  spellCheck?: boolean;
  className?: string;
}

export function Field(props: FieldProps) {
  const invalid = props.error !== undefined && props.error !== null && props.error !== '';
  return (
    <TextField
      className={`field ${props.className ?? ''}`}
      name={props.name}
      value={props.value}
      onChange={props.onChange}
      type={props.type ?? 'text'}
      isInvalid={invalid}
      isRequired={props.isRequired ?? false}
      validationBehavior="aria"
      {...(props.autoComplete !== undefined ? { autoComplete: props.autoComplete } : {})}
      {...(props.inputMode !== undefined ? { inputMode: props.inputMode } : {})}
      {...(props.maxLength !== undefined ? { maxLength: props.maxLength } : {})}
      {...(props.autoFocus === true ? { autoFocus: true } : {})}
    >
      <Label className="field-label">
        {props.label}
        {props.isRequired === true && <span className="field-required"> (obligatorio)</span>}
      </Label>
      {props.description !== undefined && (
        <Text slot="description" className="field-description">
          {props.description}
        </Text>
      )}
      <Input className="field-input" ref={props.inputRef} spellCheck={props.spellCheck ?? false} />
      <FieldError className="field-error">{invalid ? props.error : null}</FieldError>
    </TextField>
  );
}
