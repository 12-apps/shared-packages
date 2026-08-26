'use client';

/**
 * A numeric bound typed the way Brazilians write numbers, replacing
 * `<input type="number">`.
 *
 * The native control parses in the BROWSER's locale, and it does not fail
 * loudly when the text does not match — it drops what it cannot read and keeps
 * the rest. Typing `50,00` into it, measured in Chromium:
 *
 *     digitado "50,00"  ->  campo "5000"   ->  filtro R$ 5.000
 *     digitado "17,50"  ->  campo "1750"   ->  filtro R$ 1.750
 *     digitado "50.00"  ->  campo "500"    ->  filtro R$ 500
 *
 * The comma is deleted and the digits close ranks, so the merchant asks for
 * fifty reais and gets a filter a HUNDRED times larger. The list empties, the
 * chip reads `Valor: ≥ R$ 5000`, and nothing on screen connects that to the
 * `50,00` they typed. It reads as "the value filter is broken", which is how it
 * was reported.
 *
 * So the field parses pt-BR itself: `,` is the decimal separator and `.` groups
 * thousands, which is what `R$ 1.234,56` means to the person reading it. A
 * plain `50` still works, and so does `50.00` — a dot with exactly two digits
 * after it is far more likely to be a decimal typed on a numeric keypad than a
 * thousands group, and reading it as `5000` is the very failure this replaces.
 *
 * WHICH KEYPAD, and where the request has to be made. `inputMode` goes on the
 * `<input>`, via `inputProps` — set on the `TextFieldSlim` it rides the spread onto
 * the root `FormControl` div, an element nothing types into, so the attribute
 * has no effect and a phone goes on offering letters for a field that accepts
 * none of them. It is `decimal` rather than `numeric` because the numeric pad
 * has no comma on iOS, and the comma is the separator this field exists to
 * accept — `numeric` here would reopen the bug above from the other side, with
 * `17,50` untypeable rather than misread. Autofill is off alongside it: its
 * saved-value strip covers the keypad to offer names and addresses, none of
 * which survive `ALLOWED` anyway.
 */
import { Box } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { TextFieldSlim } from '../../form/Input/text-field-slim';

/** Everything this field lets through: digits and the two separators. */
const ALLOWED = /[^\d.,]/g;

/**
 * pt-BR text → number, or `undefined` when it is not one (yet).
 *
 * `.` is a thousands group and `,` is the decimal point, EXCEPT when a lone dot
 * is followed by one or two digits and no comma is present — `50.00` and `1.5`
 * are decimals somebody typed, while `1.234` is a thousand.
 */
export function parsePtBrNumber(text: string): number | undefined {
  const cleaned = text.replace(ALLOWED, '');
  if (cleaned === '') return undefined;
  const hasComma = cleaned.includes(',');
  const dots = cleaned.split('.').length - 1;
  const lastDot = cleaned.lastIndexOf('.');
  const dotIsDecimal =
    !hasComma && dots === 1 && cleaned.length - lastDot - 1 > 0 && cleaned.length - lastDot - 1 <= 2;
  const normalized = dotIsDecimal
    ? cleaned
    : cleaned.replace(/\./g, '').replace(',', '.');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : undefined;
}

/**
 * A stored bound → the text the merchant reads, with a comma for the decimal
 * point.
 *
 * It takes a STRING too, and that is not defensive typing: a range restored
 * from the URL arrives as one (`?totalCents_gte=5000`). Narrowing to `number`
 * and dropping the rest emptied the field on every reload — and then the next
 * keystroke wrote a bound built from nothing.
 */
export function formatPtBrNumber(amount: number | string | undefined): string {
  if (amount == null || amount === '') return '';
  return String(amount).replace('.', ',');
}

/** The same, as a number — `undefined` when the bound is unset or unusable. */
function boundAsNumber(amount: number | string | undefined): number | undefined {
  if (amount == null || amount === '') return undefined;
  const parsed = typeof amount === 'number' ? amount : Number(amount);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * One end of a numeric range. The BOUND stays a plain `number` — nothing
 * downstream learns that the typing surface changed.
 */
export function NumberBoundInput({
  label,
  value,
  unit,
  onChange,
  testId,
}: {
  label: string;
  /** The applied bound. A range restored from the URL hands this over as a string. */
  value: number | string | undefined;
  /** Rendered as a start adornment ("R$"), not parsed out of the text. */
  unit?: string;
  onChange: (bound: number | undefined) => void;
  testId: string;
}): React.JSX.Element {
  const applied = boundAsNumber(value);
  const [text, setText] = useState(() => formatPtBrNumber(value));

  // Re-sync only when the applied bound moved somewhere the text does not
  // already mean — a "Limpar", a saved view. Comparing through the PARSE rather
  // than the string keeps `50,` and `50,00` from being rewritten mid-edit.
  useEffect(() => {
    setText((current) => (parsePtBrNumber(current) === applied ? current : formatPtBrNumber(applied)));
  }, [applied]);

  return (
    <TextFieldSlim
      size="small"
      type="text"
      label={label}
      value={text}
      onChange={(event) => {
        // Reject the characters rather than silently dropping them AFTER
        // parsing — a letter should not move the number.
        const next = event.target.value.replace(ALLOWED, '');
        setText(next);
        const amount = parsePtBrNumber(next);
        // A bare separator (`50,`) parses to nothing yet; leave the applied
        // bound alone rather than clearing it half-way through a decimal.
        if (next === '') return onChange(undefined);
        if (amount !== undefined) onChange(amount);
      }}
      // Blur TIDIES, it does not rewrite. Text that already means the applied
      // bound is left exactly as typed — `20`, `17,50` and `1.234,56` all stay
      // — and only something that does not (`50,,`) snaps back.
      //
      // Padding the field to the chip's precision was tried and is worse than
      // the mismatch it closed: settling `20` to `20,00` means the next edit
      // starts from text the merchant did not write, so appending a digit to
      // make it 200 produces `20,000`, which parses back to 20. The filter then
      // ignores the keystroke, which is exactly the "não funciona" this whole
      // control exists to end. An input must hold what was typed into it; the
      // CHIP is where the applied window gets written in full.
      onBlur={() =>
        setText((current) =>
          parsePtBrNumber(current) === applied ? current : formatPtBrNumber(applied),
        )
      }
      InputLabelProps={{ shrink: true }}
      // `inputMode` belongs on the `<input>`, never on the field root — see the
      // keypad note at the top of this file for what goes wrong up there.
      inputProps={{ 'data-testid': testId, inputMode: 'decimal', autoComplete: 'off' }}
      InputProps={
        unit
          ? {
              startAdornment: (
                <Box component="span" sx={{ mr: 0.5, color: 'text.secondary' }}>
                  {unit}
                </Box>
              ),
            }
          : undefined
      }
      sx={{ width: 140 }}
    />
  );
}
