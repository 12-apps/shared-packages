"use client";

import { useState, type JSX } from "react";

import { FormControl, FormLabel, FormMessage } from "@12-apps/ui/form/Form";
import { Input } from "@12-apps/ui/form/Input";
import { useFormContext } from "@12-apps/ui/form/total-form";

/**
 * A day-first `DD/MM/AAAA` box that is NOT `<input type="date">` (FUT-4156).
 *
 * The native control follows the BROWSER's language: an English Chromium shows
 * Início as `mm/dd/yyyy` on a Portuguese screen, the same trap `ClockInput`
 * avoids for the hours. This is the same family: text, masked, numeric keypad,
 * a complete day that does not exist (31/02/2026) marked as it is typed.
 *
 * **The form value stays ISO** (`YYYY-MM-DD`), exactly what the native input
 * held, so the wire and the validator's date comparison are unchanged. While
 * the box holds anything that is not a whole real day the value IS that text,
 * and `validate` refuses it at Criar — a half-typed date is never sent, and
 * never silently dropped to "no date" either.
 */

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MASKED_DAY = /^(\d{2})\/(\d{2})\/(\d{4})$/u;
const PART_LIMITS = [2, 2, 4];

/** `YYYY-MM-DD` that names a real calendar day. */
export function isIsoDay(value: string): boolean {
  const match = ISO_DAY.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** A whole `DD/MM/AAAA`, real or not. */
export function isCompleteMaskedDay(value: string): boolean {
  return MASKED_DAY.test(value);
}

/** `DD/MM/AAAA` → `YYYY-MM-DD`, or `null` when it is not a complete real day. */
function maskedToIso(masked: string): string | null {
  const match = MASKED_DAY.exec(masked);
  if (match === null) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isIsoDay(iso) ? iso : null;
}

function isoToMasked(iso: string): string {
  const match = ISO_DAY.exec(iso);
  return match === null ? iso : `${match[3]}/${match[2]}/${match[1]}`;
}

/** Up to eight digits, day first, with the slashes put in as they are typed. */
function maskDigits(raw: string): string {
  const digits = raw.replace(/\D/gu, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * The typed text, masked.
 *
 * - A pasted ISO day reads as that day, not as eight digits split day-first.
 * - Editing a date that already has its slashes keeps each part's own digits:
 *   select "25" in "25/10/2026", type "0" and the box holds "0/10/2026", then
 *   "05/10/2026" — re-masking the digits would read "01/02/026".
 * - A part typed past its length moves on to the next part ("12/032" →
 *   "12/03/2"), which is plain typing, not an edit.
 */
function maskDate(raw: string, previous: string): string {
  if (ISO_DAY.test(raw.trim())) return isoToMasked(raw.trim());
  if (previous.includes("/") && /\D/u.test(raw)) {
    const parts = raw.split(/\D/u);
    const fits =
      parts.length <= 3 && parts.every((part, index) => part.length <= (PART_LIMITS[index] ?? 0));
    if (fits) return parts.join("/");
  }
  return maskDigits(raw);
}

/** A form-bound day: the value is ISO when whole and real, the typed text otherwise. */
export function DateField({
  name,
  label,
  placeholder,
  invalidMessage,
  incompleteMessage,
}: {
  name: string;
  label: string;
  placeholder: string;
  invalidMessage: string;
  /** Under a half-typed date once the box is left — never while typing. */
  incompleteMessage: string;
}): JSX.Element {
  const { values, errors, setFieldValue } = useFormContext();
  const [left, setLeft] = useState(false);
  const value = values[name] ?? "";
  const shown = isIsoDay(value) ? isoToMasked(value) : value;
  // A complete day that no calendar has is marked while typed; anything still
  // being typed waits for Criar, like every other field.
  const impossible = MASKED_DAY.test(shown) && maskedToIso(shown) === null;
  const unfinished = left && shown !== "" && !MASKED_DAY.test(shown);
  const message =
    errors[name] ??
    (impossible ? invalidMessage : unfinished ? incompleteMessage : undefined);
  const testId = `total-form-field-${name}`;
  return (
    <FormControl fullWidth>
      <FormLabel htmlFor={name} error={message !== undefined}>
        {label}
      </FormLabel>
      <Input
        id={name}
        name={name}
        type="text"
        placeholder={placeholder}
        value={shown}
        error={message !== undefined}
        inputProps={{ inputMode: "numeric", maxLength: 10, autoComplete: "off", "data-testid": testId }}
        data-testid={testId}
        onBlur={() => setLeft(true)}
        onChange={(event) => {
          setLeft(false);
          const masked = maskDate(event.target.value, shown);
          setFieldValue(name, maskedToIso(masked) ?? masked);
        }}
      />
      {message !== undefined && (
        <FormMessage error dataTestId={`${testId}-message`}>
          {message}
        </FormMessage>
      )}
    </FormControl>
  );
}
