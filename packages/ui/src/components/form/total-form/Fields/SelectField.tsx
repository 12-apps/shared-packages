'use client';

import React from 'react';

import { FormControl, FormLabel, FormMessage } from '../../Form';
import { Select } from '../../Select';
import type { SelectOption } from '../../Select';
import { useFormContext } from '../FormContext';

/** Props for the `total-form` {@link SelectField}. */
export interface SelectFieldProps {
  /** Field name; also the key into the form's values/errors. */
  name: string;
  /** Selectable options. */
  options: SelectOption[];
  /** Optional visible label rendered above the select. */
  label?: string;
  /** Placeholder shown when no option is selected. */
  placeholder?: string;
}

/**
 * Select field bound to {@link useFormContext}. Composes the existing
 * `@repo/ui` `Form*` primitives and the `Select` control, reading its
 * value/error from context and writing the chosen value back through it.
 *
 * Renders its error via `total-form-field-<name>-message` and the select via
 * `total-form-field-<name>`.
 */
export function SelectField({ name, options, label, placeholder }: SelectFieldProps): React.ReactElement {
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
      <Select
        options={options}
        placeholder={placeholder}
        value={values[name] ?? ''}
        error={Boolean(error)}
        data-testid={testId}
        onChange={(event) => setFieldValue(name, String(event.target.value))}
      />
      {error && (
        <FormMessage error dataTestId={`${testId}-message`}>
          {error}
        </FormMessage>
      )}
    </FormControl>
  );
}
