'use client';

import React, { useId } from 'react';

import { FormControl, FormLabel, FormMessage } from '../../Form';
import { Select } from '../../Select';
import type { SelectOption } from '../../Select';
import { useFormBusy } from '../../FormHold/FormHold';
import { useFormContext } from '../FormContext';
import { describedByWith } from './described-by';

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
  /**
   * Ids of the caller's own description for the select (a hint, say). They
   * stay first; the error message's id is added after them while it shows.
   */
  'aria-describedby'?: string;
}

/**
 * Select field bound to {@link useFormContext}. Composes the existing
 * `@12-apps/ui` `Form*` primitives and the `Select` control, reading its
 * value/error from context and writing the chosen value back through it.
 *
 * Renders its error via `total-form-field-<name>-message` and the select via
 * `total-form-field-<name>`. While it shows an error, the combobox's
 * `aria-describedby` points at the message, by an id from `useId()`, as
 * `TextField` does: unique on the page, and not part of the contract.
 */
export function SelectField({
  name,
  options,
  label,
  placeholder,
  'aria-describedby': callerDescribedBy,
}: SelectFieldProps): React.ReactElement {
  const { values, errors, setFieldValue } = useFormContext();
  // Held while the form waits on an upload (`useFormHold`), like the submit.
  const busy = useFormBusy();
  const error = errors[name];
  const testId = `total-form-field-${name}`;
  const generatedId = useId();
  const messageId = error ? `${generatedId}-message` : undefined;

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
        // The `<label htmlFor>` above names nothing: the combobox is MUI's
        // display div, not a labelable element. `Select` puts `aria-label` on
        // that div, so the question names the control (FUT-4157).
        aria-label={label}
        aria-describedby={describedByWith(callerDescribedBy, messageId)}
        disabled={busy}
        data-testid={testId}
        onChange={(event) => setFieldValue(name, String(event.target.value))}
      />
      {error && (
        <FormMessage error id={messageId} dataTestId={`${testId}-message`}>
          {error}
        </FormMessage>
      )}
    </FormControl>
  );
}
