import { useEffect, useState, type JSX } from 'react';

import { Button } from '@12-apps/ui/form/Button';
import { Input } from '@12-apps/ui/form/Input';

/**
 * One end of a calendar-day window: a MASKED text field, never
 * `<input type="date">`.
 *
 * Two reasons, and the first is a defect this shape exists to prevent.
 *
 * ## 1. A controlled native date input cannot survive commit latency
 *
 * A host mirrors filters into its router (that is what `onFiltersChange` is
 * for), so the value this field displays makes a round trip: keystroke →
 * `onCommit` → the host's state/URL → back as a prop. That round trip is
 * ASYNCHRONOUS — a navigation and a React commit — while the browser's own
 * segment editor is synchronous.
 *
 * A native date input reports `''` for an incomplete date and a WHOLE date the
 * moment the year has one digit, so typing `2026` walks through the valid day
 * `0002-…`. Send that back as the input's `value` a beat later and React's
 * controlled-input guard (`if (node.value !== value) node.value = value`) fires
 * mid-edit, discarding the year buffer: the next keystroke starts a fresh year.
 * Measured in headless Chromium, typing `2026` at a 150 ms commit lag commits
 * the year **0006** — a valid date, applied as a filter, with nothing on screen
 * to say it is not the one that was typed.
 *
 * So the rule is not "echo the browser's exact string" (that is what the broken
 * version did) — it is **do not write while the date is partial, and let LOCAL
 * state own what is on screen**. A commit that lands late can then only re-sync
 * a field whose text does not already mean the applied value.
 *
 * ## 2. A native date input renders in the BROWSER's locale
 *
 * Which the page cannot choose: the same field reads `dd/mm/aaaa` for one
 * merchant and `mm/dd/yyyy` for the next, and a test typing eight digits
 * validates whichever order CI happens to run. The mask makes the order the
 * surface's own — {@link resolveDayFormat} derives it from the locale the host
 * declared, and the placeholder spells it out before the first keystroke.
 *
 * The WIRE stays `YYYY-MM-DD` either way, so a saved link, a deep link and an
 * API call are unchanged by any of this.
 */

/** A calendar segment of a numeric date. */
export type DaySegment = 'day' | 'month' | 'year';

/** How one locale writes a numeric date: the segment order, and what joins it. */
export interface DayFormat {
  order: readonly [DaySegment, DaySegment, DaySegment];
  separator: string;
}

/** Digits per segment — the eight a day is made of. */
const WIDTH: Readonly<Record<DaySegment, number>> = { day: 2, month: 2, year: 4 };

/** The ISO order, used when a locale's parts cannot be read as three segments. */
const ISO_FORMAT: DayFormat = { order: ['year', 'month', 'day'], separator: '-' };

const isSegment = (type: string): type is DaySegment =>
  type === 'day' || type === 'month' || type === 'year';

/**
 * The segment order and separator for a locale, asked of `Intl` rather than
 * guessed: `pt-BR` writes `01/07/2026`, `en-US` writes `07/01/2026`, and the
 * package has no business deciding which of its adopters is which.
 *
 * `undefined` means the runtime's own locale, the same neutral default the stamp
 * formatter takes. A locale whose numeric date is not three digit segments with
 * one separator (`ja-JP` writes `2026/07/01` but `zh-CN` can interleave words)
 * falls back to the ISO order, which is at least the order of the value on the
 * wire.
 */
export function resolveDayFormat(locale?: string): DayFormat {
  const parts = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(new Date(Date.UTC(2026, 6, 1)));
  const order = parts.map((part) => part.type).filter(isSegment);
  if (order.length !== 3) return ISO_FORMAT;
  const literal = (parts.find((part) => part.type === 'literal')?.value ?? '').trim();
  return {
    order: [order[0], order[1], order[2]] as [DaySegment, DaySegment, DaySegment],
    separator: literal.length === 1 ? literal : '/',
  };
}

/** Everything that is not a digit, dropped; capped at the eight a day needs. */
const digitsIn = (raw: string): string => raw.replace(/\D/g, '').slice(0, 8);

/** Split digits into whatever segments they reach, in this format's order. */
function segmentsOf(digits: string, format: DayFormat): string[] {
  const cut: string[] = [];
  let rest = digits;
  for (const segment of format.order) {
    if (rest === '') break;
    cut.push(rest.slice(0, WIDTH[segment]));
    rest = rest.slice(WIDTH[segment]);
  }
  return cut;
}

/** Digits (already in this format's order) laid out with its separators. */
const mask = (digits: string, format: DayFormat): string =>
  segmentsOf(digits, format).join(format.separator);

/** `YYYY-MM-DD` → the eight digits in the order this format writes them. */
function displayDigits(iso: string, format: DayFormat): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return '';
  const value: Record<DaySegment, string> = {
    year: parts[1] as string,
    month: parts[2] as string,
    day: parts[3] as string,
  };
  return format.order.map((segment) => value[segment]).join('');
}

/** `YYYY-MM-DD` → what the merchant reads. */
const display = (iso: string, format: DayFormat): string =>
  mask(displayDigits(iso, format), format);

/**
 * What is typed → `YYYY-MM-DD`, but ONLY for a whole day that exists.
 *
 * `31/02/2026` is three fine numbers and is not a date; `Date` would roll it
 * silently into March and apply a window the merchant never asked for, so the
 * round trip through UTC is the check — if the month or the day comes back
 * changed, the input was not a day.
 */
export function isoOf(text: string, format: DayFormat): string {
  const digits = digitsIn(text);
  if (digits.length !== 8) return '';
  const cut = segmentsOf(digits, format);
  const value: Record<DaySegment, string> = { day: '', month: '', year: '' };
  format.order.forEach((segment, index) => {
    value[segment] = cut[index] as string;
  });
  const year = Number(value.year);
  const month = Number(value.month);
  const day = Number(value.day);
  if (year < 1000) return '';
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return '';
  return `${value.year}-${value.month}-${value.day}`;
}

export interface DayBoundProps {
  /** The APPLIED bound as `YYYY-MM-DD`, or `''` when none is applied. */
  value: string;
  label: string;
  /** `dd` / `mm` / `yyyy` in the host's words — the placeholder's segments. */
  segmentNames: Readonly<Record<DaySegment, string>>;
  /** Accessible name for this bound's own clear button. */
  clearLabel: string;
  format: DayFormat;
  /** The input's test id; its clear button is `<testId>-clear`. */
  testId: string;
  /** A WHOLE day, or `undefined` to drop the bound. Partial input commits nothing. */
  onCommit: (iso: string | undefined) => void;
}

/**
 * This bound's own ✕.
 *
 * Each bound carries one because nothing else clears it alone: the surface's
 * "clear filters" drops every pill, the search and the other bound with it — and
 * a native date picker offers no reliable cross-browser way to empty itself
 * either, which is how the affordance came to exist in the first place.
 */
function ClearBound({
  clearLabel,
  testId,
  onClear,
}: {
  clearLabel: string;
  testId: string;
  onClear: () => void;
}): JSX.Element {
  return (
    <Button
      variant="text"
      size="sm"
      aria-label={clearLabel}
      dataTestId={`${testId}-clear`}
      // Pressing an adornment button must not blur the field first: the blur
      // re-renders, MUI rebuilds the adornment, and the mouseup lands on a node
      // that has left the tree — so the click never fires and the bound is not
      // cleared. It needs React to commit BETWEEN the two events, which a fast
      // machine rarely does and CI reliably did.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClear}
    >
      ✕
    </Button>
  );
}

export function DayBound({
  value,
  label,
  segmentNames,
  clearLabel,
  format,
  testId,
  onCommit,
}: DayBoundProps): JSX.Element {
  const [text, setText] = useState(() => display(value, format));

  // `value` is the APPLIED filter; `text` is what is being typed. THE GUARD THE
  // WHOLE FILE EXISTS FOR is the first branch: a HALF-TYPED date is never
  // overwritten, whatever arrives.
  //
  // Every value reaching this field from the host is late by construction — a
  // navigation and a React commit after the keystroke that caused it — so
  // without that branch, this field's own commit echoing back, a Back button, or
  // another filter's write carrying the old bound can land between two
  // keystrokes and replace what is being typed. That is the whole of the defect,
  // and a native date input hides it by reporting a WHOLE date from the year's
  // first digit.
  //
  // A settled field (empty, or holding a complete day) still adopts what is
  // applied, so an external clear or a restored link shows up; `blur` re-syncs
  // the other case a moment later.
  useEffect(() => {
    setText((current) => {
      if (current !== '' && isoOf(current, format) === '') return current;
      return isoOf(current, format) === value ? current : display(value, format);
    });
  }, [value, format]);

  const clear = (): void => {
    setText('');
    onCommit(undefined);
  };

  /** One keystroke: mask what is on screen, commit only a whole day (or none). */
  const type = (raw: string): void => {
    const next = mask(digitsIn(raw), format);
    setText(next);
    // Emptying clears the bound. A COMPLETE day applies it. A partial one does
    // neither — it leaves whatever is applied alone, so typing is never fought
    // and a half-typed year never reaches the backend.
    if (next === '') return onCommit(undefined);
    const iso = isoOf(next, format);
    if (iso) onCommit(iso);
  };

  return (
    <Input
      type="text"
      size="sm"
      label={label}
      // The mask is the placeholder, so the expected order is on screen before
      // the first keystroke rather than discovered by getting it wrong.
      placeholder={format.order.map((segment) => segmentNames[segment]).join(format.separator)}
      inputMode="numeric"
      // A placeholder and an un-floated label would otherwise overlap at rest.
      InputLabelProps={{ shrink: true }}
      value={text}
      data-testid={testId}
      onChange={(event) => type(event.target.value)}
      // Leaving a half-typed (or impossible) date behind would show a filter the
      // list is not using. On blur the field snaps back to what IS applied; a
      // complete date already equals it, so this only ever tidies.
      onBlur={() => setText(display(value, format))}
      endAdornment={
        text ? (
          <ClearBound clearLabel={clearLabel} testId={testId} onClear={clear} />
        ) : undefined
      }
    />
  );
}
