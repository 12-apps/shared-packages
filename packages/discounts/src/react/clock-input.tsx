"use client";

import { useState, type JSX } from "react";

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

/**
 * Keep four digits and put the colon after the second.
 *
 * Except while EDITING a time that already has its colon: select "09" in
 * "09:00" and type "1" and the box holds "1:00", whose digits re-masked would
 * read "10:0". So when the previous value had a separator and the new one
 * still does, each side keeps its own digits — "1:00" stays, then "15:00".
 * Any separator counts ("25/10" reads 25:10), and the result is still at most
 * two digits a side.
 */
function maskTime(raw: string, previous: string): string {
  const separator = /\D/u.exec(raw);
  if (separator !== null && previous.includes(":")) {
    const hours = raw.slice(0, separator.index).replace(/\D/gu, "").slice(0, 2);
    const minutes = raw.slice(separator.index + 1).replace(/\D/gu, "").slice(0, 2);
    return `${hours}:${minutes}`;
  }
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
  incompleteMessage,
  submitted = false,
  dataTestId,
  onChange,
}: {
  value: string;
  /** The accessible name — "Das" and "às" sit side by side. */
  label: string;
  /** Under a time that does not exist. */
  invalidMessage: string;
  /** Under a half-typed time once the box is left — never while typing. */
  incompleteMessage: string;
  /**
   * The form refused this row's times at Criar: an unfinished clock says so
   * now, left or not, and the row does not repeat it (FUT-4143).
   */
  submitted?: boolean;
  dataTestId: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const [left, setLeft] = useState(false);
  const impossible = isImpossibleTime(value);
  const whole = /^\d{2}:\d{2}$/u.test(value);
  const unfinished = !whole && ((left && value !== "") || submitted);
  const message = impossible ? invalidMessage : unfinished ? incompleteMessage : undefined;
  return (
    <Stack spacing={0.5}>
      <Input
        type="text"
        size="sm"
        placeholder="00:00"
        value={value}
        error={message !== undefined}
        aria-label={label}
        inputProps={{ inputMode: "numeric", maxLength: 5, autoComplete: "off" }}
        onBlur={() => setLeft(true)}
        onChange={(event) => {
          setLeft(false);
          onChange(maskTime(event.target.value, value));
        }}
        data-testid={dataTestId}
      />
      {message !== undefined && (
        <FormMessage error dataTestId={`${dataTestId}-message`}>
          {message}
        </FormMessage>
      )}
    </Stack>
  );
}
