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
import TextField from '@mui/material/TextField/index.js';
import React, { useEffect, useId, useState } from 'react';
import { fieldTextFieldStyles } from '../../../tokens/field-height';
import { sxRem } from '../../../tokens/relative';


/**
 * THE MASK IS THE ORDER, and both halves of this file read it.
 *
 * The placeholder a host supplies (`copy.filters.dayMask` — `dd/mm/aaaa` for
 * pt-BR, `mm/dd/yyyy` for en-US) is not decoration: it tells the reader which
 * segment comes first. Everything below therefore derives the segment order
 * FROM that same string, so the shape on screen and the shape the parser
 * expects cannot disagree.
 *
 * They did disagree, and the failure was silent in the worst direction. The
 * mask/parse pair was hardcoded day-first (the `Br` in the old names was
 * accurate) while the placeholder followed the copy pack — so under `en-US` the
 * field ASKED for `mm/dd/yyyy`, and a reader who typed exactly that got a day
 * of 12 and a month of 31, which is not a date, which commits nothing. No
 * error, no filter, a full list that reads like an answer. The en-US pack's own
 * comment already said the mask "is the shape that gets a date entered
 * backwards"; nothing enforced it.
 */

/** What one segment of a mask is, and how many digits it takes. */
type DaySegment = 'year' | 'month' | 'day';
const SEGMENT_WIDTH: Readonly<Record<DaySegment, number>> = { year: 4, month: 2, day: 2 };

/**
 * The segments a mask asks for, in its own order.
 *
 * Keyed on each token's FIRST letter so one rule covers every spelling a host
 * might use — `aaaa`/`yyyy` for the year, `mm` for the month, `dd`/`tt` for the
 * day. An unreadable mask falls back to day-first rather than throwing: this
 * runs on every keystroke, and a field that renders is recoverable where one
 * that crashes the grid is not.
 */
function segmentsOf(mask: string): readonly DaySegment[] {
  const tokens = mask.split(/[^A-Za-z]+/).filter(Boolean);
  if (tokens.length !== 3) return ['day', 'month', 'year'];
  const segments = tokens.map((token): DaySegment => {
    const head = token.slice(0, 1).toLowerCase();
    if (head === 'y' || head === 'a') return 'year';
    return head === 'm' ? 'month' : 'day';
  });
  // A mask naming the same segment twice describes no date. Fall back rather
  // than build a parser that can never succeed.
  return new Set(segments).size === 3 ? segments : ['day', 'month', 'year'];
}

/** The separator the mask uses, defaulting to `/`. */
const separatorOf = (mask: string): string => mask.replace(/[A-Za-z]/g, '').slice(0, 1) || '/';

/** `AAAA-MM-DD` (the wire) → the mask's own order (what the reader sees). */
export function isoToMasked(iso: string, mask: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return '';
  const value: Record<DaySegment, string> = {
    year: parts[1] as string,
    month: parts[2] as string,
    day: parts[3] as string,
  };
  return segmentsOf(mask)
    .map((segment) => value[segment])
    .join(separatorOf(mask));
}

/**
 * The mask's order → `AAAA-MM-DD`, but ONLY for a day that exists.
 *
 * `31/02/2026` parses fine as three numbers and is not a date, and `Date` would
 * silently roll it into March rather than reject it — so the round trip through
 * UTC is the check: if the month or day comes back changed, the input was not a
 * day.
 */
export function maskedToIso(text: string, mask: string): string {
  const segments = segmentsOf(mask);
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 8) return '';
  const value = {} as Record<DaySegment, string>;
  let cursor = 0;
  for (const segment of segments) {
    value[segment] = digits.slice(cursor, cursor + SEGMENT_WIDTH[segment]);
    cursor += SEGMENT_WIDTH[segment];
  }
  const year = Number(value.year);
  const month = Number(value.month);
  const day = Number(value.day);
  if (year < 1000) return '';
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return '';
  return `${value.year}-${value.month}-${value.day}`;
}

/**
 * Digits only, capped at the mask's width, with the separators put back as you
 * type.
 *
 * Deriving the whole string from the digits — rather than editing the text in
 * place — is what makes backspace behave. Four digits of `dd/mm/aaaa` render as
 * `06/08`, not `06/08/`, so deleting the first digit of the year removes the
 * trailing separator with it instead of leaving a dead keystroke that changes
 * nothing.
 */
export function maskDate(raw: string, mask: string): string {
  const segments = segmentsOf(mask);
  const separator = separatorOf(mask);
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  const out: string[] = [];
  let cursor = 0;
  for (const segment of segments) {
    if (cursor >= digits.length) break;
    out.push(digits.slice(cursor, cursor + SEGMENT_WIDTH[segment]));
    cursor += SEGMENT_WIDTH[segment];
  }
  return out.join(separator);
}

/** A wire day on its own, as a paste or an autofill delivers it: `2026-10-01`. */
const ISO_DAY = /^\s*(\d{4}-\d{2}-\d{2})\s*$/;

/**
 * What the field shows for whatever arrived — typed, pasted, autofilled.
 *
 * A whole ISO day (`AAAA-MM-DD`) is READ AS THAT DAY and written in the mask's
 * order. Through `maskDate` alone it is eight digits taken day-first, so a
 * pasted `2026-10-01` came out as `20/26/1001` (FUT-4144). Anything else is
 * masked exactly as typing always was, so the typed and pasted forms of one day
 * land on the same text.
 */
export function readDayText(raw: string, mask: string): string {
  const iso = ISO_DAY.exec(raw)?.[1];
  const masked = iso ? isoToMasked(iso, mask) : '';
  return masked || maskDate(raw, mask);
}

/**
 * Whether `text` is a WHOLE day that does not exist — `31/02/2026`. A partial
 * entry is not impossible, only unfinished, and is never flagged.
 */
export function isImpossibleDay(text: string, mask: string): boolean {
  return text.replace(/\D/g, '').length === 8 && maskedToIso(text, mask) === '';
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
function dayInputProps(testId: string, describedBy: readonly (string | undefined)[]) {
  const ids = describedBy.filter(Boolean).join(' ');
  return {
    'data-testid': testId,
    maxLength: 10,
    inputMode: 'numeric' as const,
    autoComplete: 'off',
    ...(ids ? { 'aria-describedby': ids } : {}),
  };
}

/** Props of {@link DayBoundInput}. */
interface DayBoundInputProps {
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
  /**
   * Said under the field when its eight digits name no day (`31/02/2026`); the
   * field is then marked invalid and KEEPS the text on blur, so the reader sees
   * what was refused instead of the old value quietly coming back (FUT-4144).
   *
   * Opt-in, because the field ships no words of its own: without it an
   * impossible day is still never written, and blur still snaps back.
   */
  invalidMessage?: string;
}

/** What {@link useDayText} hands the field: its text, its verdict and its handlers. */
interface DayText {
  text: string;
  impossible: boolean;
  handleChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handlePaste: (event: React.ClipboardEvent<HTMLDivElement>) => void;
  handleBlur: () => void;
}

/** The typed text of one bound, kept apart from the APPLIED bound it may commit. */
function useDayText(
  applied: string,
  mask: string,
  onChange: (bound: string | undefined) => void,
  judgesImpossible: boolean,
): DayText {
  const [text, setText] = useState(() => isoToMasked(applied, mask));
  const impossible = judgesImpossible && isImpossibleDay(text, mask);

  // Emptying clears the bound. A COMPLETE day applies it. A partial (or an
  // impossible) one does NEITHER — it leaves whatever is applied alone, so
  // typing is never fought and a half-typed year never reaches the backend.
  const enter = (next: string) => {
    setText(next);
    if (next === '') return onChange(undefined);
    const iso = maskedToIso(next, mask);
    if (iso) onChange(iso);
  };

  // The bound is the APPLIED filter; `text` is what is being typed. Re-sync only
  // when the applied value moved somewhere the text does not already mean — a
  // "Limpar", a saved view, the other pill resetting the pair. Without that
  // guard the field's own write bounces straight back mid-edit and resets the
  // caret, which is the native control's worst habit reproduced by hand.
  //
  // "Already means" is a REAL day equal to the bound, or an empty field for an
  // open bound. An impossible day parses to `''` too, so a bare comparison let
  // a "Limpar" (applied → `''`) keep `31/02/2026` on screen, red, over a filter
  // that had just been cleared.
  useEffect(() => {
    setText((current) => {
      const iso = maskedToIso(current, mask);
      const means = (iso !== '' || current === '') && iso === applied;
      return means ? current : isoToMasked(applied, mask);
    });
  }, [applied, mask]);

  return {
    text,
    impossible,
    handleChange: (event) => enter(readDayText(event.target.value, mask)),
    // A pasted ISO day REPLACES the field whatever it held: inserted at the
    // caret into existing digits it would be read as more digits, and the
    // `maxLength` would cut a padded one before `onChange` ever saw it.
    handlePaste: (event) => {
      const pasted = event.clipboardData.getData('text');
      if (!ISO_DAY.test(pasted)) return;
      event.preventDefault();
      enter(readDayText(pasted, mask));
    },
    // Leaving a half-typed date on screen would show a filter the list is not
    // actually using. On blur the field snaps back to what IS applied; a
    // complete date already equals it, so this only ever tidies. An impossible
    // day the field is SAYING is impossible stays, with its message: snapping
    // it back is the silent forgetting FUT-4144 removed.
    handleBlur: () => {
      if (!impossible) setText(isoToMasked(applied, mask));
    },
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
  invalidMessage,
}: DayBoundInputProps): React.JSX.Element {
  const id = useId();
  const { text, impossible, handleChange, handlePaste, handleBlur } = useDayText(
    value ?? '',
    mask,
    onChange,
    invalidMessage !== undefined,
  );

  return (
    <TextField
      size="small"
      type="text"
      id={id}
      label={label}
      error={error || impossible}
      helperText={impossible ? invalidMessage : undefined}
      placeholder={mask}
      value={text}
      onChange={handleChange}
      onPaste={handlePaste}
      onBlur={handleBlur}
      // The placeholder occupies the space an un-shrunk label would render into.
      InputLabelProps={{ shrink: true }}
      inputProps={dayInputProps(testId, [impossible ? `${id}-helper-text` : undefined, describedBy])}
      sx={[{ width: sxRem(165) }, fieldTextFieldStyles]}
    />
  );
}
