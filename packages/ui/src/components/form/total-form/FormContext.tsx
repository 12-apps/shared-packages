'use client';

import { createContext, useContext, useMemo } from 'react';

/**
 * Shape of the value exposed by the `total-form` {@link FormContext}.
 *
 * Field values and errors are keyed by field name. The container owns the
 * state; fields and controls read from and write to it through
 * {@link useFormContext}.
 */
export interface TotalFormContextValue {
  /** Current value of every field, keyed by field name. */
  values: Record<string, string>;
  /** First validation error per field (absent when the field is valid). */
  errors: Record<string, string | undefined>;
  /** Whether the form's `onSubmit` handler is currently running. */
  submitting: boolean;
  /** Updates a single field's value and clears any resolved error for it. */
  setFieldValue: (name: string, value: string) => void;
  /**
   * Replaces the whole error map (the same setter `onSubmit` receives in its
   * helpers). Pass `{}` to clear. `setFieldValue` still clears the edited
   * field's error, so a caller that validates live sets the errors again after
   * each change. `useFormContext()` always returns it (a no-op under a
   * hand-built provider value that leaves it out).
   */
  setFieldErrors?: SetFieldErrors;
}

/** Replaces the whole error map; `{}` clears it. */
export type SetFieldErrors = (errors: Record<string, string | undefined>) => void;

/**
 * What {@link useFormContext} returns: the context value with `setFieldErrors`
 * always present. It is optional on {@link TotalFormContextValue} only so a
 * hand-built provider value (a test double) written before it existed keeps
 * type-checking; `FormContainer` always provides it.
 */
export type UseFormContextResult = TotalFormContextValue & { setFieldErrors: SetFieldErrors };

const NO_FIELD_ERRORS: SetFieldErrors = () => undefined;

/** React context backing the `total-form` layer. `null` outside a container. */
export const FormContext = createContext<TotalFormContextValue | null>(null);

/**
 * Reads the nearest {@link FormContext}.
 *
 * @throws If called outside a `FormContainer`.
 * @returns The current form context value.
 */
export function useFormContext(): UseFormContextResult {
  const context = useContext(FormContext);
  const result = useMemo(
    () => (context ? { ...context, setFieldErrors: context.setFieldErrors ?? NO_FIELD_ERRORS } : null),
    [context],
  );
  if (!result) {
    throw new Error('useFormContext must be used within a <FormContainer>');
  }
  return result;
}
