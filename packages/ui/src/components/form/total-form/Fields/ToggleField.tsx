'use client';

import React from 'react';

import { FormControl, FormLabel, FormMessage } from '../../Form';
import { ToggleGroup } from '../../ToggleGroup';
import type { ToggleOption } from '../../ToggleGroup';
import { useFormContext } from '../FormContext';

/** Props for the `total-form` {@link ToggleField}. */
export interface ToggleFieldProps {
  /** Field name; also the key into the form's values/errors. */
  name: string;
  /** The mutually-exclusive options (one is always selected). */
  options: ToggleOption[];
  /** Optional visible label rendered above the toggle. */
  label?: string;
}

/**
 * Exclusive toggle (segmented control) bound to {@link useFormContext} — a
 * label-height-matched alternative to {@link SelectField} for a short, always-set
 * enum. Composes the `Form*` primitives and the `ToggleGroup` control, reading
 * its value from context and writing the chosen value back through it. Ignores a
 * deselect (clicking the active segment) so a value is always kept.
 *
 * Renders its error via `total-form-field-<name>-message` and the toggle via
 * `total-form-field-<name>` (each segment at `total-form-field-<name>-item-<value>`).
 */
export function ToggleField({ name, options, label }: ToggleFieldProps): React.ReactElement {
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
      <ToggleGroup
        variant="exclusive"
        options={options}
        value={values[name] ?? ''}
        fullWidth
        dataTestId={testId}
        // Match the input field height so the toggle lines up in a form row.
        sx={{ '& .MuiToggleButtonGroup-grouped': { height: 56 } }}
        onChange={(_event, next) => {
          if (typeof next === 'string') setFieldValue(name, next);
        }}
      />
      {error && (
        <FormMessage error dataTestId={`${testId}-message`}>
          {error}
        </FormMessage>
      )}
    </FormControl>
  );
}
