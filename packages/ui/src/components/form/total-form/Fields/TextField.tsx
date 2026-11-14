'use client';

import type { InputHTMLAttributes } from 'react';
import React, { useId } from 'react';

import { FormControl, FormLabel, FormMessage } from '../../Form';
import { Input } from '../../Input';
import { useFormBusy } from '../../FormHold/FormHold';
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
  /**
   * The `autocomplete` attribute of the `<input>`. Omitted, the browser decides
   * from the `name` — which is how a supplier's `name`/`phone`/`email` gets
   * offered the signed-in owner's own (FUT-4140). Pass `off` for somebody
   * else's data, `new-password` for a secret the password manager must not
   * fill. An `inputProps.autoComplete` wins over this one.
   */
  autoComplete?: string;
  /**
   * Attributes for the `<input>` element itself — `inputMode`, `autoCapitalize`,
   * `autoCorrect`, `spellCheck`, `maxLength`, `pattern`, `enterKeyHint`…
   *
   * They reach the `<input>`, never the wrapper `div`, where a keypad hint does
   * nothing. What the field owns — `id`, `name`, `type`, `value`, `onChange`,
   * `placeholder` and the `total-form-field-<name>` test id — is not
   * overridable here.
   */
  inputProps?: TextFieldInputProps;
}

/** The `<input>` attributes {@link TextField} lets a caller set (see `inputProps`). */
export type TextFieldInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'name' | 'type' | 'value' | 'defaultValue' | 'onChange' | 'placeholder' | 'size' | 'color'
>;

/** The keys {@link TextFieldInputProps} leaves out, also dropped at runtime. */
const FIELD_OWNED = [
  'id',
  'name',
  'type',
  'value',
  'defaultValue',
  'onChange',
  'placeholder',
  'size',
  'color',
  'data-testid',
];

/**
 * The caller's `<input>` attributes, minus what the field owns.
 *
 * The type already refuses those keys; plain JS or a cast does not, and a
 * renamed id, name or test id would silently unbind the label, the form value
 * or every spec that finds the field by it. So they are dropped here too, and
 * the field's own test id is written last.
 */
function callerInputProps(
  inputProps: TextFieldInputProps | undefined,
  testId: string,
  messageId: string | undefined,
): Record<string, unknown> {
  const kept = Object.fromEntries(
    Object.entries(inputProps ?? {}).filter(([key]) => !FIELD_OWNED.includes(key)),
  );
  const describedBy = describedByWith(kept['aria-describedby'], messageId);
  return {
    ...kept,
    ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
    'data-testid': testId,
  };
}

/**
 * The caller's own `aria-describedby` (a hint, say), with the error message's
 * id after it while the field shows one. The error is how a screen reader
 * learns WHY the field is invalid; `aria-invalid` alone only says that it is.
 */
function describedByWith(callerIds: unknown, messageId: string | undefined): string | undefined {
  const ids = [typeof callerIds === 'string' ? callerIds.trim() : '', messageId ?? ''].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/**
 * Text input field bound to {@link useFormContext}. Composes the existing
 * `@12-apps/ui` `Form*` presentational primitives and the `Input` control,
 * reading its value/error from context and writing changes back through it.
 *
 * Renders its error via `total-form-field-<name>-message` and the input via
 * `total-form-field-<name>`. While it shows an error, the input's
 * `aria-describedby` points at the message, by an id from `useId()`: unique on
 * the page, so two forms with a field of the same name never cross-link. The id
 * is not part of the contract; find the message by its test id or by the
 * input's accessible description.
 */
export function TextField({
  name,
  label,
  type = 'text',
  placeholder,
  autoComplete,
  inputProps,
}: TextFieldProps): React.ReactElement {
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
      <Input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        value={values[name] ?? ''}
        error={Boolean(error)}
        autoComplete={autoComplete}
        inputProps={callerInputProps(inputProps, testId, messageId)}
        disabled={busy}
        data-testid={testId}
        onChange={(event) => setFieldValue(name, event.target.value)}
      />
      {error && (
        <FormMessage error id={messageId} dataTestId={`${testId}-message`}>
          {error}
        </FormMessage>
      )}
    </FormControl>
  );
}
