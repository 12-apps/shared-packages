'use client';

import React, { useId } from 'react';

import { FormControl, FormLabel, FormMessage } from '../../Form';
import { ToggleGroup } from '../../ToggleGroup';
import type { ToggleOption } from '../../ToggleGroup';
import { useFormBusy } from '../../FormHold/FormHold';
import { useFormContext } from '../FormContext';
import { describedByWith } from './described-by';

/** Props for the `total-form` {@link ToggleField}. */
export interface ToggleFieldProps {
  /** Field name; also the key into the form's values/errors. */
  name: string;
  /** The mutually-exclusive options (one is always selected). */
  options: ToggleOption[];
  /** Optional visible label rendered above the toggle. */
  label?: string;
  /**
   * Ids of the caller's own description for the group (a hint, say). They
   * stay first; the error message's id is added after them while it shows.
   */
  'aria-describedby'?: string;
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
 * While it shows an error, the group carries `aria-invalid` and its
 * `aria-describedby` points at the message, by an id from `useId()`, as
 * `TextField` does: unique on the page, and not part of the contract.
 */
export function ToggleField({
  name,
  options,
  label,
  'aria-describedby': callerDescribedBy,
}: ToggleFieldProps): React.ReactElement {
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
      <ToggleGroup
        variant="exclusive"
        options={options}
        value={values[name] ?? ''}
        fullWidth
        // A `role="group"` div is not labelable, so the `<label htmlFor>`
        // above names nothing; the group carries the question itself (FUT-4157).
        aria-label={label}
        // A group has no `error` prop; the invalid state is said here, and why
        // by the message the description points at.
        aria-invalid={error ? true : undefined}
        aria-describedby={describedByWith(callerDescribedBy, messageId)}
        disabled={busy}
        dataTestId={testId}
        onChange={(_event, next) => {
          if (typeof next === 'string') setFieldValue(name, next);
        }}
      />
      {error && (
        <FormMessage error id={messageId} dataTestId={`${testId}-message`}>
          {error}
        </FormMessage>
      )}
    </FormControl>
  );
}
