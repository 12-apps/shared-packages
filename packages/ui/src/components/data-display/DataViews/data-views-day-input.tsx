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
 * What has to land on the `<input>` itself rather than on the `TextField`.
 *
 * Anything `TextField` does not recognise is spread onto its root `FormControl`
 * div. `inputMode` went up there once: the attribute sat on a non-editable
 * wrapper, meant nothing, and the phone went on offering the letter keyboard
 * for a field that only takes digits (the `dd/mm/aaaa` hint under a QWERTY
 * layout). Only the `<input>` this reaches decides which keypad opens — and the
 * same is true of `aria-describedby`, which on the wrapper points at a
 * description no screen reader will read out for the field.
 *
 * `numeric` and not `tel`: both raise a keypad, but the phone one is a dialler
 * with `+ * #` on it — keys that cannot occur in a date. A paste carrying
 * separators still lands, because the MASK is what filters the text; the keypad
 * only narrows what a thumb can reach for.
 *
 * Autofill off for the same reason: the browser's saved-value strip covers the
 * keypad to suggest names and addresses, none of which are a date, and none of
 * which the mask would keep.
 */
function dayInputProps(testId: string, describedBy: string | undefined) {
  return {
    'data-testid': testId,
    maxLength: 10,
    inputMode: 'numeric' as const,
    autoComplete: 'off',
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  };
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
  error = false,
  describedBy,
  mask,
}: {
  label: string;
  /** The applied bound, `AAAA-MM-DD`, or undefined when this end is open. */
  value: string | undefined;
  onChange: (bound: string | undefined) => void;
  testId: string;
  /**
   * Paint the field as rejected. It only ever writes a real day by itself, so
   * this is for a caller judging the PAIR: a window whose end precedes its
   * start is two valid days and one impossible period, and the field it was
   * typed into is the only place to say which half is being complained about.
   */
  error?: boolean;
  /** Id of the element carrying that complaint, so it is read WITH the field. */
  describedBy?: string;
  /**
   * The day mask, which IS the placeholder — so the expected ORDER is on
   * screen before the first keystroke rather than discovered by getting it
   * wrong. `dd/mm/aaaa` is one locale's order and one locale's letters.
   *
   * A PROP rather than a context read: this field has two callers, and only
   * one of them is inside DataViews. `DateRangePicker` mounts it standalone
   * with its own message table, so a context read here throws for every host
   * of that picker — which is exactly what it did.
   */
  mask: string;
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
      error={error}
      placeholder={mask}
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
      inputProps={dayInputProps(testId, describedBy)}
      sx={{ width: 165 }}
    />
  );
}
