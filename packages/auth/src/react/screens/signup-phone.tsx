import { useState, type JSX } from "react";

import { Input } from "@12-apps/ui/form/Input";
import { Spacer } from "@12-apps/ui/layout/Spacer";

/**
 * A phone, asked for on the form when the host needs one to serve the account
 * (a store that delivers rings the door). Off unless the host passes it.
 *
 * The host owns every rule, because a phone's shape is national and this
 * package is not: `format` is the mask applied as the person types, and
 * `problem` is the whole of the validation — it is asked about the EMPTY value
 * too, so whether the field is required is the host's answer, not a flag here.
 *
 * An empty field is never shown as an error, even when the host requires it:
 * tabbing past a field is not getting it wrong. It holds the submit all the
 * same, so a required field should carry a `hint` that says it is needed.
 */
export interface SignupPhoneField {
  label: string;
  /** Under the field until something is wrong with it. */
  hint?: string;
  /** The value as it should read after this keystroke. */
  format: (typed: string) => string;
  /** Why this value cannot be sent, in the reader's words; `null` when it can. */
  problem: (value: string) => string | null;
}

export interface PhoneState {
  value: string;
  /** What blocks the submit, whether or not it is shown yet. */
  blocking: string | null;
  /** What the field says under it: the problem once the field was left, else the hint. */
  shown: string | null;
  failed: boolean;
  change: (typed: string) => void;
  leave: () => void;
}

/**
 * The phone field's state. Judged like the password: leaving the field shows
 * what is wrong, a keystroke never does, and the submit stays shut meanwhile —
 * a button that lets an unreadable number through is the bug FUT-3546 fixed on
 * the checkout's own phone step.
 */
export function usePhone(field: SignupPhoneField | undefined): PhoneState {
  const [value, setValue] = useState("");
  const [left, setLeft] = useState(false);
  const blocking = field ? field.problem(value) : null;
  const failed = left && value !== "" && blocking !== null;
  return {
    value,
    blocking,
    shown: failed ? blocking : (field?.hint ?? null),
    failed,
    change: (typed) => {
      const next = field ? field.format(typed) : typed;
      setValue(next);
      if (field?.problem(next) === null) setLeft(false);
    },
    leave: () => setLeft(true),
  };
}

/** The phone input and the line under it, when the host asked for one. */
export function PhoneField({ field, phone }: { field: SignupPhoneField; phone: PhoneState }): JSX.Element {
  return (
    <>
      <Input
        id="signup-phone"
        name="phone"
        label={field.label}
        type="tel"
        inputMode="tel"
        value={phone.value}
        onChange={(event) => phone.change(event.target.value)}
        onBlur={phone.leave}
        autoComplete="tel"
        fullWidth
        error={phone.failed}
        {...(phone.shown ? { helperText: phone.shown } : {})}
        data-testid="signup-phone"
      />
      <Spacer size="sm" />
    </>
  );
}
