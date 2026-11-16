'use client';

import { validateFields } from '@12-apps/forms-core';
import type { ValidatorSchema } from '@12-apps/forms-core';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Form } from '../Form';
import { FormHoldScope, useFormHoldRoot } from '../FormHold/FormHold';

import { FormContext } from './FormContext';
import type { SetFieldErrors, TotalFormContextValue } from './FormContext';
import { focusFirstInvalid } from './focus-first-invalid';

/** Imperative helpers handed to {@link FormContainerProps.onSubmit}. */
export interface FormSubmitHelpers {
  /**
   * Set (highlight) per-field error messages after a submit — e.g. mapping a
   * server failure back to the exact offending field. Pass `{}` to clear. Each
   * error auto-clears when the user edits that field. When the map holds an
   * error, focus moves to the first invalid field, as on a refused submit.
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
 * field validators from `@12-apps/forms-core` on submit, and only calls
 * `onSubmit` with the validated values when no field errors remain. Uses no
 * zod and no react-hook-form.
 *
 * It is also a form HOLD scope (`useFormHold` / `useFormBusy`): while any field
 * holds it — a photo still uploading — the fields and the submit are held and
 * the submit handler returns without calling `onSubmit`, so neither
 * `requestSubmit()` nor a keyboard shortcut can get past it.
 *
 * A REFUSED submit takes the person to the problem: when client validation
 * fails, or `onSubmit` hands `setFieldErrors` an error, the first invalid field
 * in DOM order is focused and scrolled into view (no smooth scroll under
 * `prefers-reduced-motion`). A submit that passes moves nothing, and neither
 * does the context's own `setFieldErrors`, which a field may call while the
 * person types.
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
  const hold = useFormHoldRoot();
  const { busy } = hold;
  const formRef = useRef<HTMLFormElement | null>(null);
  // Bumped by a refused submit; the effect runs once the errors are rendered.
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest > 0) focusFirstInvalid(formRef.current);
  }, [focusRequest]);

  const setFieldValue = useCallback<TotalFormContextValue['setFieldValue']>((name, value) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const setFieldErrors = useCallback<SetFieldErrors>(
    (fieldErrors) => setErrors(fieldErrors),
    [],
  );

  const refuseWith = useCallback<SetFieldErrors>((fieldErrors) => {
    setErrors(fieldErrors);
    if (Object.values(fieldErrors).some(Boolean)) setFocusRequest((n) => n + 1);
  }, []);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;
      formRef.current = event.currentTarget;
      const nextErrors = schema ? validateFields(values, schema) : {};
      refuseWith(nextErrors);
      if (Object.values(nextErrors).some(Boolean)) return;

      setSubmitting(true);
      try {
        // Replace the error map so the helper's contract holds: passing `{}`
        // clears, and a later field-less failure can't leave a stale highlight.
        // `onSubmit` only runs once client validation passes, so there are no
        // client errors here to preserve.
        await onSubmit(values, { setFieldErrors: refuseWith });
      } finally {
        setSubmitting(false);
      }
    },
    [busy, onSubmit, refuseWith, schema, values],
  );

  const contextValue = useMemo<TotalFormContextValue>(
    () => ({ values, errors, submitting, setFieldValue, setFieldErrors }),
    [errors, setFieldErrors, setFieldValue, submitting, values],
  );

  return (
    <FormHoldScope value={hold}>
      <FormContext.Provider value={contextValue}>
        <Form dataTestId={dataTestId} onSubmit={handleSubmit} noValidate aria-busy={busy || undefined}>
          {children}
        </Form>
      </FormContext.Provider>
    </FormHoldScope>
  );
}
