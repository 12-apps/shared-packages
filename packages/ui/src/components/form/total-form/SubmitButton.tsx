'use client';

import React from 'react';

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
 * The height of a form input control (see `Input` — `.MuiInputBase-root`), so a
 * submit button placed inline with fields lines up with them instead of sitting
 * shorter. Kept in sync with that value by hand.
 */
const FIELD_HEIGHT = 56;

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
      // the md padding/font here alongside the field-height + no-wrap alignment.
      sx={{ height: FIELD_HEIGHT, px: 2, fontSize: '1rem', flexShrink: 0, whiteSpace: 'nowrap' }}
    >
      {children}
    </Button>
  );
}
