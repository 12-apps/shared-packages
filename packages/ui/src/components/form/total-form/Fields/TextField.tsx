'use client';

import React from 'react';

import { FormControl, FormLabel, FormMessage } from '../../Form';
import { Input } from '../../Input';
import { useFormContext } from '../FormContext';

/** Props for the `total-form` {@link TextField}. */
export interface TextFieldProps {
  /** Field name; also the key into the form's values/errors. */
  name: string;
  /** Optional visible label rendered above the input. */
  label?: string;
  /** Native input type (e.g. `email`, `password`). Defaults to `text`. */
  type?: string;
  /** Placeholder shown when the field is empty. */
  placeholder?: string;
}

/**
 * Text input field bound to {@link useFormContext}. Composes the existing
 * `@repo/ui` `Form*` presentational primitives and the `Input` control,
 * reading its value/error from context and writing changes back through it.
 *
 * Renders its error via `total-form-field-<name>-message` and the input via
 * `total-form-field-<name>`.
 */
export function TextField({ name, label, type = 'text', placeholder }: TextFieldProps): React.ReactElement {
  const { values, errors, setFieldValue } = useFormContext();
  const error = errors[name];
  const testId = `total-form-field-${name}`;

  return (
    <FormControl fullWidth>
      {label && (
        <FormLabel htmlFor={name} error={Boolean(error)}>
          {label}
        </FormLabel>
      )}
      <Input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        value={values[name] ?? ''}
        error={Boolean(error)}
        data-testid={testId}
        onChange={(event) => setFieldValue(name, event.target.value)}
      />
      {error && (
        <FormMessage error dataTestId={`${testId}-message`}>
          {error}
        </FormMessage>
      )}
    </FormControl>
  );
}
