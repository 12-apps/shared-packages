'use client';

import React from 'react';

import { Button } from '../Button';
import { useFormContext } from './FormContext';

/** Props for {@link SubmitButton}. */
export interface SubmitButtonProps {
  /** Button label. */
  children: React.ReactNode;
}

/**
 * Submit control wired to {@link useFormContext}. Wraps the existing `@repo/ui`
 * `Button` as a `type="submit"` button (testid `total-form-submit`) and
 * reflects the form's `submitting` state via `loading`/`disabled`.
 */
export function SubmitButton({ children }: SubmitButtonProps): React.ReactElement {
  const { submitting } = useFormContext();

  return (
    <Button type="submit" dataTestId="total-form-submit" loading={submitting} disabled={submitting}>
      {children}
    </Button>
  );
}
