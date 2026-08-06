'use client';

/**
 * A day bound as a MASKED `dd/mm/aaaa` text field, replacing `<input type="date">`.
 *
 * The native control is three separate segments wearing one box. Typing a date
 * means filling a segment, being jumped to the next, and starting over — and
 * which segment comes first is the BROWSER's locale, not ours, so the same
 * field reads `dd/mm/aaaa` for one merchant and `mm/dd/yyyy` for the next with
 * nothing in our code saying which. There is no way to type a date as one
 * continuous run of digits, which is how people actually type dates.
 *
 * A mask gives that back: eight digits straight through, separators inserted as
 * you go, backspace walking back through them.
 *
 * Measured, driving both controls in Chromium with the same eight keystrokes
 * (`01072026`, one `keydown` at a time):
 *
 *   native  →  field ends EMPTY, no filter applied, 0 requests
 *   masked  →  field reads `01/07/2026`, filter applied, 1 request
 *
 * The native result is the whole complaint: you type a date and nothing lands.
 *
 * The second half of the fix is WHEN the bound is written. A partially-typed
 * year is itself a valid date — `2026` passes through `0002`, `0020`, `0202` on
 * the way — so committing on every keystroke would send the grid off to fetch
 * years nobody meant. A bound is written only once the text is a WHOLE, real
 * date, which is what keeps the run above at one request rather than four.
 */
import { TextField } from '@mui/material';
import React, { useEffect, useState } from 'react';

/** `AAAA-MM-DD` (the wire) → `dd/mm/aaaa` (what the merchant reads). */
export function isoToBr(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : '';
}

/**
 * `dd/mm/aaaa` → `AAAA-MM-DD`, but ONLY for a day that exists. `31/02/2026`
 * parses fine as three numbers and is not a date, and `Date` would silently
 * roll it into March rather than reject it — so the round trip through UTC is
 * the check: if the month or day comes back changed, the input was not a day.
 */
export function brToIso(text: string): string {
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!parts) return '';
  const [, dd, mm, yyyy] = parts;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  if (year < 1000) return '';
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return '';
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Digits only, capped at eight, with the separators put back as you type.
 *
 * Deriving the whole string from the digits — rather than editing the text in
 * place — is what makes backspace behave. Four digits render as `06/08`, not
 * `06/08/`, so deleting the first digit of the year removes the trailing
 * separator with it instead of leaving a dead keystroke that changes nothing.
 */
export function maskBrDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * One end of a day window. The BOUND stays `AAAA-MM-DD` — the form the backend's
 * inclusive day comparison already speaks, and the form the chip label reads —
 * so only the typing surface changes.
 */
export function DayBoundInput({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  /** The applied bound, `AAAA-MM-DD`, or undefined when this end is open. */
  value: string | undefined;
  onChange: (bound: string | undefined) => void;
  testId: string;
}): React.JSX.Element {
  const applied = value ?? '';
  const [text, setText] = useState(() => isoToBr(applied));

  // The bound is the APPLIED filter; `text` is what is being typed. Re-sync only
  // when the applied value moved somewhere the text does not already mean — a
  // "Limpar", a saved view, the other pill resetting the pair. Without that
  // guard the field's own write bounces straight back mid-edit and resets the
  // caret, which is the native control's worst habit reproduced by hand.
  useEffect(() => {
    setText((current) => (brToIso(current) === applied ? current : isoToBr(applied)));
  }, [applied]);

  return (
    <TextField
      size="small"
      type="text"
      label={label}
      // The mask IS the placeholder, so the expected order is on screen before
      // the first keystroke rather than discovered by getting it wrong.
      placeholder="dd/mm/aaaa"
      // A numeric keypad on a phone, while still accepting a paste with slashes.
      inputMode="numeric"
      value={text}
      onChange={(event) => {
        const next = maskBrDate(event.target.value);
        setText(next);
        // Emptying clears the bound. A COMPLETE day applies it. A partial one
        // does NEITHER — it leaves whatever is applied alone, so typing is never
        // fought and a half-typed year never reaches the backend.
        if (next === '') return onChange(undefined);
        const iso = brToIso(next);
        if (iso) onChange(iso);
      }}
      // Leaving a half-typed (or impossible) date on screen would show a filter
      // the list is not actually using. On blur the field snaps back to what IS
      // applied; a complete date already equals it, so this only ever tidies.
      onBlur={() => setText(isoToBr(applied))}
      // The placeholder occupies the space an un-shrunk label would render into.
      InputLabelProps={{ shrink: true }}
      inputProps={{ 'data-testid': testId, maxLength: 10 }}
      sx={{ width: 165 }}
    />
  );
}
