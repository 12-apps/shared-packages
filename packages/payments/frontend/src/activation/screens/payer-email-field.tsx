'use client';

import { useCallback, useState, type JSX } from 'react';

import { useCheckoutComponents } from '../../components/checkout/ui';
import { usePayerEmail } from '../use-payer-email';

import type { ActivationPayerEmailCopy } from './copy';
import { useActivationCopy } from './copy-context';

/**
 * The payer e-mail both flows ask for (FUT-4050).
 *
 * Its own component because the card form and the redirect flow render the
 * SAME field: one label, one hint, one validator. Two copies of it would be
 * two places for "the e-mail must differ from the account's" to drift.
 */

/** The `<input>`'s id — what the refusal panel's "change the e-mail" focuses. */
const PAYER_EMAIL_INPUT_ID = 'verify-charge-email';

/**
 * Local check before anything is charged: present, and shaped like an address.
 * Deliberately loose — one `@`, something either side, a dot in the domain. The
 * provider is the judge of the rest, and a stricter pattern here would refuse
 * addresses it accepts.
 */
export function validatePayerEmail(
  value: string,
  copy: Pick<ActivationPayerEmailCopy, 'required' | 'invalid'>,
): string | undefined {
  const email = value.trim();
  if (!email) return copy.required;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? undefined : copy.invalid;
}

/** Move the cursor to the field — the refusal panel's next step. */
function focusPayerEmail(): void {
  // After the form has re-rendered: the panel's button is what unmounts it.
  window.setTimeout(() => document.getElementById(PAYER_EMAIL_INPUT_ID)?.focus(), 0);
}

/** The step's validator, bound to the host's words. */
export function usePayerEmailValidator(): (value: string) => string | undefined {
  const { payerEmail } = useActivationCopy();
  return useCallback((value: string) => validatePayerEmail(value, payerEmail), [payerEmail]);
}

/**
 * The refusal panel's "change the e-mail": back to the form, the refused
 * e-mail shown as the field's own error, the cursor on it — and the card still
 * typed in, because only the e-mail was wrong.
 */
export function useChangePayerEmail(
  charge: { reset: () => void; setEmailError: (error: string | undefined) => void },
  displayName: string,
): () => void {
  const { payerEmail } = useActivationCopy();
  const { reset, setEmailError } = charge;
  return useCallback(() => {
    reset();
    setEmailError(payerEmail.refusedField(displayName));
    focusPayerEmail();
  }, [reset, setEmailError, payerEmail, displayName]);
}

/**
 * The link flow's e-mail: the field's state, and a start that judges it first.
 * Judged BEFORE the tab is claimed, so a refused field leaves no blank tab
 * behind — and the link is minted for the e-mail on screen.
 */
export function useLinkPayerEmail(
  ownerEmail: string,
  suggested: string | null,
  /** The provider judges the e-mail (FUT-4200); `null` until the endpoint says. */
  required: boolean | null,
  start: (payer?: { email: string }) => unknown,
) {
  const validate = usePayerEmailValidator();
  const { email, setEmail } = usePayerEmail(ownerEmail, suggested);
  const [error, setError] = useState<string | undefined>(undefined);
  const field = {
    value: email,
    error,
    onChange: (value: string) => {
      setEmail(value);
      if (error) setError(undefined);
    },
    onBlur: () => {
      if (email) setError(validate(email));
    },
  };
  const startWithEmail = () => {
    if (required === null) return;
    if (!required) {
      void start();
      return;
    }
    const refused = validate(email);
    setError(refused);
    if (!refused) void start({ email });
  };
  return { field, startWithEmail, required };
}

/** The link flow's field, drawn only where the provider requires it (FUT-4200). */
export function LinkPayerEmail({
  payer,
  displayName,
}: {
  payer: ReturnType<typeof useLinkPayerEmail>;
  displayName: string;
}): JSX.Element | null {
  return payer.required === true ? <PayerEmailField {...payer.field} displayName={displayName} /> : null;
}

export function PayerEmailField({
  value,
  error,
  displayName,
  onChange,
  onBlur,
}: {
  value: string;
  error: string | undefined;
  /** The provider being activated, as the owner knows it. */
  displayName: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}): JSX.Element {
  const { payerEmail } = useActivationCopy();
  const { Input } = useCheckoutComponents();
  return (
    <Input
      id={PAYER_EMAIL_INPUT_ID}
      name="payer-email"
      label={payerEmail.label}
      type="email"
      autoComplete="email"
      variant="outlined"
      size="md"
      fullWidth
      required
      placeholder={payerEmail.placeholder}
      value={value}
      error={Boolean(error)}
      helperText={error ?? payerEmail.hint(displayName)}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      inputProps={{ autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false }}
      data-testid="verify-charge-email"
    />
  );
}
