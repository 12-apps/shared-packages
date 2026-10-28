"use client";

import type { JSX } from "react";

import { FormMessage } from "@12-apps/ui/form/Form";
import { Input } from "@12-apps/ui/form/Input";
import { Stack } from "@12-apps/ui/mui/Stack";

import { toMinutes } from "../engine/schedule";

/**
 * A 24-hour `HH:MM` box that is NOT `<input type="time">` (FUT-4143).
 *
 * The native control renders itself in the BROWSER's language, not the page's:
 * on an English machine "Das 16:00" reads "04:00 PM" to a Brazilian merchant on
 * a Portuguese screen, and no attribute overrides it. The host's own hours
 * screens dropped it for the same reason (FUT-872), and this is the same field:
 * text, masked, with the phone's digit keypad.
 *
 * The mask inserts the colon as the operator types, so four digits make
 * `09:00` and "0900123" can never exist — the same rule as the host's
 * `maskTime`, restated because a package cannot import a host. A half-typed
 * `09:` is a fine intermediate state and is not shouted at; a COMPLETE time no
 * day has (25:00, 12:60) is marked on the spot, in the pack's words.
 */

/** Keep four digits and put the colon after the second. */
function maskTime(raw: string): string {
  const digits = raw.replace(/\D/gu, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** A finished `HH:MM` that names no minute of a day. */
function isImpossibleTime(value: string): boolean {
  return /^\d{2}:\d{2}$/u.test(value) && toMinutes(value) === null;
}

export function ClockInput({
  value,
  label,
  invalidMessage,
  dataTestId,
  onChange,
}: {
  value: string;
  /** The accessible name — "Das" and "às" sit side by side. */
  label: string;
  /** Under a time that does not exist. */
  invalidMessage: string;
  dataTestId: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const impossible = isImpossibleTime(value);
  return (
    <Stack spacing={0.5}>
      <Input
        type="text"
        size="sm"
        placeholder="00:00"
        value={value}
        error={impossible}
        aria-label={label}
        inputProps={{ inputMode: "numeric", maxLength: 5, autoComplete: "off" }}
        onChange={(event) => onChange(maskTime(event.target.value))}
        data-testid={dataTestId}
      />
      {impossible && (
        <FormMessage error dataTestId={`${dataTestId}-message`}>
          {invalidMessage}
        </FormMessage>
      )}
    </Stack>
  );
}
