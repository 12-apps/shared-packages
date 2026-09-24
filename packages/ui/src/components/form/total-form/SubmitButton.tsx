'use client';

import React from 'react';

import { fieldHeight } from '../../../tokens/field-height';
import { Button } from '../Button';
import { useFormContext } from './FormContext';

/** Props for {@link SubmitButton}. */
export interface SubmitButtonProps {
  /** Button label. */
  children: React.ReactNode;
  /** Test id; defaults to `total-form-submit`. Override when a page renders more than one form. */
  dataTestId?: string;
}

/**
 * Submit control wired to {@link useFormContext}. Wraps the existing `@12-apps/ui`
 * `Button` as a `type="submit"` button (testid `total-form-submit`) and
 * reflects the form's `submitting` state via `loading`/`disabled`.
 *
 * It matches the form field height and never wraps its label, so it aligns with
 * an adjacent input on the same row (and stays full-width when the row stacks).
 */
export function SubmitButton({
  children,
  dataTestId = 'total-form-submit',
}: SubmitButtonProps): React.ReactElement {
  const { submitting } = useFormContext();

  return (
    <Button
      type="submit"
      dataTestId={dataTestId}
      loading={submitting}
      disabled={submitting}
      // `Button` replaces (not merges) its size styles with this `sx`, so restate
      // the md padding/font here alongside the theme's field height — the height
      // every input on the form stands at — and no-wrap alignment.
      sx={{ height: fieldHeight, px: 2, fontSize: '1rem', flexShrink: 0, whiteSpace: 'nowrap' }}
    >
      {children}
    </Button>
  );
}
