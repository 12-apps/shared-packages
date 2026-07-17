'use client';

import { createContext, useContext } from 'react';

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
}

/** React context backing the `total-form` layer. `null` outside a container. */
export const FormContext = createContext<TotalFormContextValue | null>(null);

/**
 * Reads the nearest {@link FormContext}.
 *
 * @throws If called outside a `FormContainer`.
 * @returns The current form context value.
 */
export function useFormContext(): TotalFormContextValue {
  const context = useContext(FormContext);
  if (!context) {
    throw new Error('useFormContext must be used within a <FormContainer>');
  }
  return context;
}
