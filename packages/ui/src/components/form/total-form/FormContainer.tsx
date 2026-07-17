'use client';

import { validateFields } from '@12-apps/shared-helpers/forms';
import type { ValidatorSchema } from '@12-apps/shared-helpers/forms';
import React, { useCallback, useMemo, useState } from 'react';

import { Form } from '../Form';

import { FormContext } from './FormContext';
import type { TotalFormContextValue } from './FormContext';

/** Imperative helpers handed to {@link FormContainerProps.onSubmit}. */
export interface FormSubmitHelpers {
  /**
   * Set (highlight) per-field error messages after a submit — e.g. mapping a
   * server failure back to the exact offending field. Pass `{}` to clear. Each
   * error auto-clears when the user edits that field.
   */
  setFieldErrors: (errors: Record<string, string | undefined>) => void;
}

/** Props for {@link FormContainer}. */
export interface FormContainerProps<T extends Record<string, string>> {
  /** Initial value for every field, keyed by field name. */
  initialValues: T;
  /** Per-field validators run on submit. Omit to skip validation. */
  schema?: ValidatorSchema<T>;
  /**
   * Called with the validated values once the form passes validation. Receives
   * {@link FormSubmitHelpers} so it can highlight fields on a server failure.
   */
  onSubmit: (values: T, helpers: FormSubmitHelpers) => void | Promise<void>;
  /** Field components, the submit button, and the error snackbar. */
  children: React.ReactNode;
  /** Test id applied to the underlying `<form>`. Defaults to `total-form`. */
  dataTestId?: string;
}

/**
 * Stateful, domain-agnostic form container ported from the gym-app
 * `total-form`. Holds values/errors/submitting in {@link FormContext}, runs the
 * field validators from `@12-apps/shared-helpers/forms` on submit, and only calls
 * `onSubmit` with the validated values when no field errors remain. Uses no
 * zod and no react-hook-form.
 *
 * @typeParam T - The form's value shape (a record of string fields).
 */
export function FormContainer<T extends Record<string, string>>({
  initialValues,
  schema,
  onSubmit,
  children,
  dataTestId = 'total-form',
}: FormContainerProps<T>): React.ReactElement {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [submitting, setSubmitting] = useState(false);

  const setFieldValue = useCallback<TotalFormContextValue['setFieldValue']>((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const nextErrors = schema ? validateFields(values, schema) : {};
      setErrors(nextErrors);
      if (Object.values(nextErrors).some(Boolean)) return;

      setSubmitting(true);
      try {
        // Replace the error map so the helper's contract holds: passing `{}`
        // clears, and a later field-less failure can't leave a stale highlight.
        // `onSubmit` only runs once client validation passes, so there are no
        // client errors here to preserve.
        await onSubmit(values, {
          setFieldErrors: (fieldErrors) => setErrors(fieldErrors),
        });
      } finally {
        setSubmitting(false);
      }
    },
    [onSubmit, schema, values],
  );

  const contextValue = useMemo<TotalFormContextValue>(
    () => ({ values, errors, submitting, setFieldValue }),
    [errors, setFieldValue, submitting, values],
  );

  return (
    <FormContext.Provider value={contextValue}>
      <Form dataTestId={dataTestId} onSubmit={handleSubmit} noValidate>
        {children}
      </Form>
    </FormContext.Provider>
  );
}
