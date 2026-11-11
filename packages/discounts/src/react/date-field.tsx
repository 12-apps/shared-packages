"use client";

import { useState, type JSX } from "react";

import { FormControl, FormLabel, FormMessage } from "@12-apps/ui/form/Form";
import { Input } from "@12-apps/ui/form/Input";
import { useFormContext } from "@12-apps/ui/form/total-form";
import { Box } from "@12-apps/ui/mui/Box";
import type { SxProps, Theme } from "@12-apps/ui/mui/styles";

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
export function maskedToIso(masked: string): string | null {
  const match = MASKED_DAY.exec(masked);
  if (match === null) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isIsoDay(iso) ? iso : null;
}

export function isoToMasked(iso: string): string {
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
export function maskDate(raw: string, previous: string): string {
  if (ISO_DAY.test(raw.trim())) return isoToMasked(raw.trim());
  if (previous.includes("/") && /\D/u.test(raw)) {
    const parts = raw.split(/\D/u);
    const fits =
      parts.length <= 3 && parts.every((part, index) => part.length <= (PART_LIMITS[index] ?? 0));
    if (fits) return parts.join("/");
  }
  return maskDigits(raw);
}

/**
 * What the box itself says about its text. A complete day that no calendar has
 * is marked while typed; anything still being typed waits for Criar, like every
 * other field, and is only called unfinished once the box is left.
 */
function typedMessage(
  shown: string,
  left: boolean,
  messages: { invalidMessage: string; incompleteMessage: string },
): string | undefined {
  if (MASKED_DAY.test(shown)) return maskedToIso(shown) === null ? messages.invalidMessage : undefined;
  return left && shown !== "" ? messages.incompleteMessage : undefined;
}

/**
 * A disabled box, drawn as one (review round 7): MUI's disabled fill and muted
 * edge, from the theme, so the two boxes read as dimmed like the grid beside
 * them rather than as empty fields waiting for a date. The outlined Input's own
 * edge (and its primary hover) would otherwise win over MUI's disabled one.
 */
const DISABLED_BOX: SxProps<Theme> = {
  "& .MuiOutlinedInput-root.Mui-disabled": { backgroundColor: "action.disabledBackground" },
  "& .MuiOutlinedInput-root.Mui-disabled fieldset, & .MuiOutlinedInput-root.Mui-disabled:hover fieldset": {
    borderColor: "action.disabled",
  },
};

/**
 * A box that HOLDS days it cannot change (review round 9): read-only, with the
 * locked fill and edge of a disabled one, but its value in the ordinary input
 * ink. MUI's disabled ink (`text.disabled`) put a stored date at 1.59:1, read
 * as a placeholder; the value is the one fact the box still states.
 */
const READ_ONLY_BOX: SxProps<Theme> = {
  "& .MuiOutlinedInput-root": { backgroundColor: "action.disabledBackground", cursor: "default" },
  "& .MuiOutlinedInput-root:not(.Mui-focused) fieldset, & .MuiOutlinedInput-root:not(.Mui-focused):hover fieldset": {
    borderColor: "action.disabled",
  },
  "& input": { color: "text.primary", WebkitTextFillColor: "currentColor", cursor: "default" },
};

/** The box's look: read-only holding days, disabled and empty, or live. */
const boxLook = (readOnly: boolean, disabled: boolean): SxProps<Theme> =>
  readOnly ? READ_ONLY_BOX : disabled ? DISABLED_BOX : {};

/** What the `<input>` itself carries beyond its value. */
function inputAttributes(testId: string, readOnly: boolean, describedBy: string | undefined) {
  return {
    inputMode: "numeric" as const,
    maxLength: 10,
    autoComplete: "off",
    "data-testid": testId,
    // On the <input> itself: the text field takes no root `readOnly`.
    ...(readOnly ? { readOnly: true } : {}),
    ...(describedBy === undefined ? {} : { "aria-describedby": describedBy }),
  };
}

/** A form-bound day: the value is ISO when whole and real, the typed text otherwise. */
export function DateField({
  name,
  label,
  placeholder,
  invalidMessage,
  incompleteMessage,
  disabled = false,
  readOnly = false,
  describedBy,
}: {
  name: string;
  label: string;
  placeholder: string;
  invalidMessage: string;
  /** Under a half-typed date once the box is left — never while typing. */
  incompleteMessage: string;
  /** Shown, never editable — the days cannot be placed (FUT-4482, review round 5). */
  disabled?: boolean;
  /**
   * Shown, never editable, and still READ (review round 9): the days are
   * stored but cannot change. Focusable and announced as read-only, its value
   * in the ordinary ink — never MUI's disabled grey.
   */
  readOnly?: boolean;
  /** The id of a line elsewhere that describes this box (review round 6: why it is disabled). */
  describedBy?: string;
}): JSX.Element {
  const { values, errors, setFieldValue } = useFormContext();
  const [left, setLeft] = useState(false);
  const value = values[name] ?? "";
  const shown = isIsoDay(value) ? isoToMasked(value) : value;
  const message = errors[name] ?? typedMessage(shown, left, { invalidMessage, incompleteMessage });
  const testId = `total-form-field-${name}`;
  return (
    <FormControl fullWidth>
      <FormLabel htmlFor={name} error={message !== undefined}>
        {label}
      </FormLabel>
      <Box data-testid={`${testId}-box`} sx={boxLook(readOnly, disabled)}>
        <Input
          id={name}
          name={name}
          type="text"
          placeholder={placeholder}
          disabled={disabled && !readOnly}
          value={shown}
          error={message !== undefined}
          inputProps={inputAttributes(testId, readOnly, describedBy)}
          data-testid={testId}
          onBlur={() => setLeft(true)}
          onChange={(event) => {
            // A browser types nothing into a read-only box; a script's change event is refused the same.
            if (readOnly) return;
            setLeft(false);
            const masked = maskDate(event.target.value, shown);
            setFieldValue(name, maskedToIso(masked) ?? masked);
          }}
        />
      </Box>
      {message !== undefined && (
        <FormMessage error dataTestId={`${testId}-message`}>
          {message}
        </FormMessage>
      )}
    </FormControl>
  );
}
