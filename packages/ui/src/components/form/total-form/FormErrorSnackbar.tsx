'use client';

import React from 'react';

import { Toast } from '../../feedback/Toast';
import { useFormContext } from './FormContext';
import { EN_US_UI_LABELS } from '../../../en-US.labels';

/** Props for {@link FormErrorSnackbar}. */
export interface FormErrorSnackbarProps {
  /** Message shown when the form has field errors. */
  message?: string;
}

/**
 * Surfaces form-level validation failures. Thin wrapper over the existing
 * `@12-apps/ui` `Toast`: renders nothing while the form is valid and shows an
 * error toast (testid `total-form-error-snackbar`) once any field has an error.
 */
export function FormErrorSnackbar({
  message = EN_US_UI_LABELS.formErrorSnackbar.message,
}: FormErrorSnackbarProps): React.ReactElement | null {
  const { errors } = useFormContext();
  const hasErrors = Object.values(errors).some(Boolean);

  if (!hasErrors) return null;

  return (
    <Toast
      dataTestId="total-form-error-snackbar"
      variant="error"
      message={message}
      closable={false}
    />
  );
}
