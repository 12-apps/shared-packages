"use client";

import { useState, type JSX } from "react";

import { FormMessage } from "@12-apps/ui/form/Form";
import { Input } from "@12-apps/ui/form/Input";
import { Fields, type TextFieldInputProps } from "@12-apps/ui/form/total-form";
import { Stack } from "@12-apps/ui/mui/Stack";

import type { DiscountsWebCopy } from "./copy";

/**
 * The form's number boxes, and the keypad each one asks the phone for
 * (FUT-4143).
 *
 * None of them is `type="number"`. That control reads "2,5" according to the
 * BROWSER's language — as 2.5, as nothing, or (in the survey's English
 * Chromium) as 25 — and a promotion limited to 25 uses because the operator
 * typed a comma is a silent, expensive mistake. Text boxes keep what was typed;
 * the validator, which knows the pack's language, decides what it means.
 */

/** A percentage takes a separator: "12,5". */
const DECIMAL_KEYPAD: TextFieldInputProps = { inputMode: "decimal" };

/** A count of uses or units takes digits and nothing else. */
const WHOLE_NUMBER_KEYPAD: TextFieldInputProps = { inputMode: "numeric", pattern: "[0-9]*" };

/** Digits only, as typed. */
function isWholeNumber(typed: string): boolean {
  return /^\d+$/u.test(typed.trim());
}

/** "Desconto (%)", wherever the kind mounts it. */
export function PercentField({ copy }: { copy: DiscountsWebCopy }): JSX.Element {
  return (
    <Fields.TextField
      name="percentOff"
      label={copy.form.percentOff}
      placeholder={copy.form.percentPlaceholder}
      inputProps={DECIMAL_KEYPAD}
    />
  );
}

/** A form-bound count: "Limite de usos", "Limite por cliente", "Combos por pedido". */
export function WholeNumberField({ name, label }: { name: string; label: string }): JSX.Element {
  return <Fields.TextField name={name} label={label} inputProps={WHOLE_NUMBER_KEYPAD} />;
}

/** The raw-`Input` twin of {@link WholeNumberField}, for a count held as text by its caller. */
export function WholeNumberInput({
  label,
  value,
  error,
  dataTestId,
  onChange,
}: {
  label: string;
  value: string;
  error: boolean;
  dataTestId: string;
  onChange: (next: string) => void;
}): JSX.Element {
  return (
    <Input
      label={label}
      value={value}
      error={error}
      inputProps={WHOLE_NUMBER_KEYPAD}
      onChange={(event) => onChange(event.target.value)}
      data-testid={dataTestId}
    />
  );
}

/**
 * A count the caller holds as a NUMBER — a combo group's quantity, the units
 * "leve 3, pague 2" takes.
 *
 * It keeps what was typed so "2,5" stays on screen and is refused there, in
 * the pack's words, instead of becoming `NaN` in the box. What the caller gets
 * is the number, or `NaN` while the text is not one — which its own validator
 * already refuses at submit, so nothing typed with a comma is ever sent.
 */
export function CountInput({
  label,
  value,
  copy,
  dataTestId,
  onChange,
}: {
  label: string;
  value: number;
  copy: DiscountsWebCopy;
  dataTestId: string;
  onChange: (next: number) => void;
}): JSX.Element {
  const [typed, setTyped] = useState<string>(() => (Number.isFinite(value) ? String(value) : ""));
  // A value changed from outside (a group replaced, a kind switched) wins over
  // a stale draft; one this box sent back is the draft itself.
  const parsed = isWholeNumber(typed) ? Number(typed.trim()) : Number.NaN;
  const shown = Number.isNaN(value) || parsed === value ? typed : String(value);
  const refused = shown.trim() !== "" && !isWholeNumber(shown);
  return (
    <Stack spacing={0.5}>
      <WholeNumberInput
        label={label}
        value={shown}
        error={refused}
        dataTestId={dataTestId}
        onChange={(next) => {
          setTyped(next);
          onChange(isWholeNumber(next) ? Number(next.trim()) : Number.NaN);
        }}
      />
      {refused && (
        <FormMessage error dataTestId={`${dataTestId}-message`}>
          {copy.form.wholeNumberOnly}
        </FormMessage>
      )}
    </Stack>
  );
}
